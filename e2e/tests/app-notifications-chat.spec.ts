import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import {
  API_URL,
  expectAccessible,
  ownerWithActiveDecal,
  scannerPage,
  sql,
  uniqueEmail,
  waitForMail,
} from './helpers';

interface Mail {
  to: string;
  tag: string;
  text: string;
}

/** The native app's sign-in (magic link with app=true → bearer token), as the app does it. */
async function appSession(request: APIRequestContext, email: string) {
  const r = await request.post(`${API_URL}/v1/app/auth/magic-link`, {
    data: { email, locale: 'de' },
  });
  expect(r.status()).toBe(202);
  let token: string | undefined;
  await expect
    .poll(
      async () => {
        const { mails } = (await (await request.get(`${API_URL}/v1/dev/mailbox`)).json()) as {
          mails: Mail[];
        };
        const m = mails.find(
          (x) => x.to === email && x.tag === 'magic_link' && x.text.includes('/app/anmelden#t='),
        );
        token = m ? /\/app\/anmelden#t=([A-Za-z0-9_-]+)/.exec(m.text)?.[1] : undefined;
        return Boolean(token);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const consumed = await request.post(`${API_URL}/v1/app/auth/consume`, {
    data: { token, platform: 'android' },
  });
  expect(consumed.status()).toBe(200);
  const session = ((await consumed.json()) as { token: string }).token;
  return { session, headers: { authorization: `Bearer ${session}` } };
}

/** The alert id from the scanner page's fragment (#a=<id>.<status token>.<chat token>). */
async function alertIdOf(scan: Page): Promise<string> {
  await expect.poll(() => scan.evaluate(() => location.hash)).toMatch(/^#a=[0-9a-f-]{36}\./);
  return /^#a=([0-9a-f-]{36})\./.exec(await scan.evaluate(() => location.hash))![1]!;
}

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
  const url = await ownerWithActiveDecal(page, request, email);
  const app = await appSession(request, email);

  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    scan.getByText(
      'Bitte lassen Sie diese Seite geöffnet. Der Fahrzeughalter kann Ihnen hier antworten.',
    ),
  ).toBeVisible();
  const alertId = await alertIdOf(scan);

  // Locked until the owner opens it; "seen" is shown, but is not an answer.
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

  await scan.getByLabel('Ihre Antwort').fill('Danke, ich warte hier.');
  await scan.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect.poll(() => owner.received.some((m) => m.from === 'scanner')).toBe(true);
  expect(owner.received.find((m) => m.from === 'scanner')?.text).toBe('Danke, ich warte hier.');

  // The text filter: no phone numbers from the scanner.
  await scan.getByLabel('Ihre Antwort').fill('Ruf mich an: 0151 23456789');
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
  await expect(scan.getByText('Der Chat wurde beendet. Vielen Dank für Ihre Hilfe!')).toBeVisible({
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

test('PREMIUM escalation: the trusted contact gets one SMS, taps „Ich komme" on /k/…, the scanner sees it', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(150_000);
  const email = uniqueEmail('trusted');
  const contactEmail = uniqueEmail('kim');
  const url = await ownerWithActiveDecal(page, request, email);

  // PLUS first: no trusted contacts.
  await page.goto('/konto/notfallkontakte');
  await expect(
    page.getByText(/Vertrauenspersonen und die Eskalation gibt es im Premium-Tarif/),
  ).toBeVisible();

  // The upgrade itself is tested in billing; here the subscription is switched in the database.
  await sql(
    `UPDATE subscriptions SET plan = 'premium' WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [email],
  );
  await page.reload();
  const phone = `0151 ${String(Date.now()).slice(-8)}`;
  await page.getByLabel('Name des Kontakts').fill('Kim');
  await page.getByLabel('Handynummer des Kontakts').fill(phone);
  await page.getByLabel('E-Mail-Adresse des Kontakts').fill(contactEmail);
  await page.getByLabel('Ihr Name').fill('Jonas');
  await page.getByRole('button', { name: 'Einladung senden' }).click();
  await expect(page.getByText(/Einladung gesendet/)).toBeVisible();

  const invite = await waitForMail(request, contactEmail, 'ec_invite');
  const link = /(https?:\/\/\S+\/notfallkontakt#t=[A-Za-z0-9_-]+)/.exec(invite.text)![1]!;
  const kimCtx = await browser.newContext({ locale: 'de-DE' });
  const kim = await kimCtx.newPage();
  await kim.goto(link);
  await kim.getByRole('button', { name: 'Zustimmen' }).click();
  await expect(kim.getByText(/Danke!/)).toBeVisible();

  // Escalation is off until the owner switches it on (the page suggests it now).
  await page.reload();
  await expect(page.getByText(/Eine Vertrauensperson hat zugestimmt/)).toBeVisible();
  await page.getByRole('button', { name: 'Eskalation einschalten' }).click();
  await expect(page.getByRole('button', { name: 'Eskalation ausschalten' })).toBeVisible();

  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  const alertId = await alertIdOf(scan);
  // Instead of waiting 7 minutes: the step is due now; the worker's sweeper picks it up within seconds.
  await sql(`UPDATE alerts SET escalate_at = now() WHERE id = $1`, [alertId]);
  await expect(scan.getByText('Eine Vertrauensperson wurde benachrichtigt.')).toBeVisible({
    timeout: 20_000,
  });

  const e164 = `+49${phone.replace(/\D/g, '').slice(1)}`;
  let sms: { to: string; body: string; tag: string } | undefined;
  await expect
    .poll(
      async () => {
        const { messages } = (await (await request.get(`${API_URL}/v1/dev/sms`)).json()) as {
          messages: { to: string; body: string; tag: string }[];
        };
        sms = messages.find((m) => m.to === e164 && m.tag === 'sms_escalation');
        return Boolean(sms);
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  expect(sms!.body.length).toBeLessThanOrEqual(160);
  expect(sms!.body).not.toMatch(/K-AB/);
  const k = /(\S+\/k\/[A-Za-z0-9_-]{43})/.exec(sms!.body)![1]!;

  await kim.goto(k.startsWith('http') ? k : `http://${k}`);
  await expect(
    kim.getByText(/Fahrzeug versperrt Ausfahrt beim Fahrzeug „Der Blaue“/),
  ).toBeVisible();
  await expectAccessible(kim);
  await kim.getByRole('button', { name: 'Ich komme' }).click();
  await expect(
    kim.getByText(/Danke! Der Fahrer und die Person am Fahrzeug sehen jetzt/),
  ).toBeVisible();
  await expect(scan.getByText('Eine Vertrauensperson ist unterwegs.')).toBeVisible({
    timeout: 10_000,
  });

  await kimCtx.close();
  await ctx.close();
});
