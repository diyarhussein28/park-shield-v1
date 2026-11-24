import { io, type Socket } from 'socket.io-client';
import { expect, test, type Browser } from '@playwright/test';
import {
  alertIdOf,
  API_URL,
  appDevice,
  appPushesTo,
  escalationDue,
  expectAccessible,
  expectNoAlertMail,
  ownerWithActiveDecal,
  scannerPage,
  smsDeliveries,
  sql,
  uniqueEmail,
  waitForAppPush,
  waitForEscalationSms,
} from './helpers';

function ownerSocket(alertId: string, session: string) {
  const socket: Socket = io(`${API_URL}/chat`, {
    path: '/v1/socket.io',
    addTrailingSlash: false,
    auth: { role: 'owner', alertId, session },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  const received: { from: string; text: string }[] = [];
  socket.on('chat:message', (m: { from: string; text: string }) => received.push(m));
  return { socket, received };
}

test('live chat: the owner opens it from the app, both write, the owner closes it; the scanner page stores nothing', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(150_000);
  const email = uniqueEmail('chat');
  const { url } = await ownerWithActiveDecal(page, request, email);
  const app = await appDevice(request, email);

  const { ctx, page: scan } = await scannerPage(browser, url);
  // The chat socket goes through this route, so the test can hold back the server's
  // acknowledgement of one scanner message (Socket.io ACK frame `43/chat,<id>[…]`).
  let holdNextAck = false;
  let releaseAck: (() => void) | undefined;
  await ctx.routeWebSocket(/\/v1\/socket\.io/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => {
      if (holdNextAck && typeof m === 'string' && m.startsWith('43/chat,')) {
        holdNextAck = false;
        releaseAck = () => ws.send(m);
        return;
      }
      ws.send(m);
    });
  });
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    scan.getByText(
      'Bitte lassen Sie diese Seite geöffnet. Der Fahrzeughalter kann Ihnen hier antworten.',
    ),
  ).toBeVisible();
  const alertId = await alertIdOf(scan);

  // Locked until the owner opens it; "seen" is shown (and, since 2026-11-22, stops the escalation).
  await expect(scan.getByRole('heading', { name: 'Chat mit dem Fahrzeughalter' })).toBeHidden();
  const seen = await request.post(`${API_URL}/v1/app/alerts/${alertId}/seen`, {
    headers: app.headers,
  });
  expect(seen.status()).toBe(200);
  await expect(scan.getByText('Fahrzeughalter hat die Nachricht gesehen.')).toBeVisible({
    timeout: 10_000,
  });

  // The owner's app shows the scanner as online and opens the chat.
  const detail = await (
    await request.get(`${API_URL}/v1/app/alerts/${alertId}`, { headers: app.headers })
  ).json();
  expect(detail.chat).toMatchObject({ status: 'locked', canOpen: true });
  await expect
    .poll(async () => {
      const d = await (
        await request.get(`${API_URL}/v1/app/alerts/${alertId}`, { headers: app.headers })
      ).json();
      return d.chat.scanner.online;
    })
    .toBe(true);
  const opened = await request.post(`${API_URL}/v1/app/alerts/${alertId}/chat/open`, {
    headers: app.headers,
  });
  expect(opened.status()).toBe(200);
  // Opening the alert was already a reaction: no reminder push, no SMS any more.
  const [stopped] = await sql(
    `SELECT escalation_stop_reason AS reason, remind_at, sms_due_at FROM alerts WHERE id = $1`,
    [alertId],
  );
  expect(stopped).toEqual({ reason: 'seen', remind_at: null, sms_due_at: null });
  await expect(scan.getByRole('heading', { name: 'Chat mit dem Fahrzeughalter' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    scan.getByText('Der Fahrzeughalter möchte Ihnen eine Rückfrage stellen.'),
  ).toBeVisible();
  await expectAccessible(scan);

  // Owner → scanner (a quick reply), scanner → owner.
  const owner = ownerSocket(alertId, app.session);
  await new Promise<void>((resolve, reject) => {
    owner.socket.once('chat:state', () => resolve());
    owner.socket.once('connect_error', reject);
  });
  const ack = await owner.socket
    .timeout(5_000)
    .emitWithAck('chat:message', { text: 'Ich bin in 2 Minuten am Fahrzeug.' });
  expect(ack).toMatchObject({ ok: true });
  await expect(scan.getByText('Ich bin in 2 Minuten am Fahrzeug.')).toBeVisible();

  holdNextAck = true;
  await scan.getByLabel('Ihre Antwort').fill('Danke, ich warte hier.');
  await scan.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect.poll(() => owner.received.some((m) => m.from === 'scanner')).toBe(true);
  expect(owner.received.find((m) => m.from === 'scanner')?.text).toBe('Danke, ich warte hier.');

  // The text filter: no phone numbers from the scanner. Typed while the first message's
  // acknowledgement is still on its way: the late acknowledgement must not wipe the new text.
  await expect.poll(() => releaseAck !== undefined).toBe(true);
  await scan.getByLabel('Ihre Antwort').fill('Ruf mich an: 0151 23456789');
  releaseAck!();
  await expect(scan.getByRole('button', { name: 'Senden', exact: true })).toBeEnabled();
  await expect(scan.getByLabel('Ihre Antwort')).toHaveValue('Ruf mich an: 0151 23456789');
  await scan.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(scan.getByText(/Diese Nachricht kann nicht gesendet werden/)).toBeVisible();
  expect(owner.received.filter((m) => m.from === 'scanner')).toHaveLength(1);

  // § 25 TDDDG: the scanner page touches no cookie and no storage, before and during the chat.
  expect(await ctx.cookies()).toEqual([]);
  const storage = await scan.evaluate(async () => ({
    cookie: document.cookie,
    local: localStorage.length,
    session: sessionStorage.length,
    idb: (await indexedDB.databases()).length,
  }));
  expect(storage).toEqual({ cookie: '', local: 0, session: 0, idb: 0 });

  // „Erledigt / Chat schließen".
  const closed = await request.post(`${API_URL}/v1/app/alerts/${alertId}/chat/close`, {
    headers: app.headers,
  });
  expect((await closed.json()).status).toBe('closed');
  await expect(scan.getByText('Der Chat wurde beendet.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(scan.getByLabel('Ihre Antwort')).toBeHidden();

  // „Ich komme" from the app: the scanner sees the owner is on the way.
  const r = await request.post(`${API_URL}/v1/app/alerts/${alertId}/ack`, {
    headers: app.headers,
    data: {},
  });
  expect(r.status()).toBe(200);
  await expect(scan.getByText('Der Fahrzeughalter ist unterwegs.')).toBeVisible({
    timeout: 10_000,
  });

  owner.socket.disconnect();
  await ctx.close();
});

/** Each "scanner" gets its own browser identity, so the per-scanner limit does not interfere. */
async function scanAs(browser: Browser, url: string, n: number) {
  const ctx = await browser.newContext({
    locale: 'de-DE',
    userAgent: `Mozilla/5.0 (Linux; Android 15; E2E-chat-${n}) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36`,
  });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(page.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  return { ctx, page, alertId: await alertIdOf(page) };
}

test('escalation: seeing is no reaction (reminder, then exactly one SMS); „Erledigt“ stops it; tests never send an SMS', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(150_000);
  const email = uniqueEmail('escal');
  const { url } = await ownerWithActiveDecal(page, request, email);
  const app = await appDevice(request, email);

  // The decal test of ownerWithActiveDecal: a reminder is planned, an SMS never.
  const [testAlert] = await sql(
    `SELECT a.remind_at IS NOT NULL AS remind, a.sms_due_at IS NULL AS no_sms
       FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id JOIN users u ON u.id = v.owner_user_id
      WHERE u.email = $1 AND a.is_test`,
    [email],
  );
  expect(testAlert).toEqual({ remind: true, no_sms: true });

  // Alert 1: the owner does not react (does not even open it): reminder, then the one SMS.
  const one = await scanAs(browser, url, 1);
  await waitForAppPush(request, app.fcmToken, 'alert', one.alertId);
  await escalationDue(one.alertId, 'reminder');
  await waitForAppPush(request, app.fcmToken, 'reminder', one.alertId);
  await escalationDue(one.alertId, 'sms');
  await waitForEscalationSms(request, one.alertId);
  const [stage] = await sql(`SELECT escalation_stage::text AS stage FROM alerts WHERE id = $1`, [
    one.alertId,
  ]);
  expect(stage.stage).toBe('sms_sent');
  // At-least-once delivery: a replayed outbox event and a due time set again send no second SMS.
  await sql(
    `INSERT INTO outbox_events (topic, payload) VALUES ('alert.sms_escalate', jsonb_build_object('alertId', $1::text))`,
    [one.alertId],
  );
  await escalationDue(one.alertId, 'sms');
  await expect
    .poll(
      async () =>
        (
          await sql(
            `SELECT count(*)::int AS n FROM outbox_events
              WHERE topic = 'alert.sms_escalate' AND payload->>'alertId' = $1 AND processed_at IS NULL`,
            [one.alertId],
          )
        )[0].n,
      { timeout: 20_000, message: 'the worker handled the replayed event' },
    )
    .toBe(0);
  await new Promise((r) => setTimeout(r, 6_000)); // one more sweep
  expect((await smsDeliveries(one.alertId)).map((d) => d.status)).toEqual(['sent']);

  // Alert 2: „Erledigt“ in the app stops every pending step.
  const two = await scanAs(browser, url, 2);
  await waitForAppPush(request, app.fcmToken, 'alert', two.alertId);
  const resolved = await request.post(`${API_URL}/v1/app/alerts/${two.alertId}/resolve`, {
    headers: app.headers,
  });
  expect(resolved.status()).toBe(200);
  const [row] = await sql(
    `SELECT escalation_stop_reason AS reason, remind_at, sms_due_at FROM alerts WHERE id = $1`,
    [two.alertId],
  );
  expect(row).toEqual({ reason: 'resolved', remind_at: null, sms_due_at: null });
  // Even if the due times came back, the sweepers skip a stopped alert.
  await escalationDue(two.alertId, 'reminder');
  await escalationDue(two.alertId, 'sms');
  await new Promise((r) => setTimeout(r, 12_000)); // two sweeps
  const late = (await appPushesTo(request, app.fcmToken)).filter(
    (m) => m.body.message.data.alertId === two.alertId && m.body.message.data.kind !== 'alert',
  );
  expect(late).toEqual([]);
  expect(await smsDeliveries(two.alertId)).toEqual([]);
  await expectNoAlertMail(request, email);

  await one.ctx.close();
  await two.ctx.close();
});
