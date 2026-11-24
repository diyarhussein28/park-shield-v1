import { expect, test, type Browser } from '@playwright/test';
import {
  alertIdOf,
  API_URL,
  appDevice,
  escalationDue,
  ownerWithActiveDecal,
  smsDeliveries,
  sql,
  uniqueEmail,
  waitForAppPush,
} from './helpers';

const deliveries = (email: string) =>
  sql<{ alert_type: string; channel: string; status: string; suppressed_reason: string | null }>(
    `SELECT a.alert_type, d.channel, d.status, d.suppressed_reason
       FROM alert_deliveries d JOIN alerts a ON a.id = d.alert_id
       JOIN vehicles v ON v.id = a.vehicle_id JOIN users u ON u.id = v.owner_user_id
      WHERE u.email = $1 AND NOT a.is_test AND d.recipient = 'owner' ORDER BY d.queued_at`,
    [email],
  );

/** Each "scanner" gets its own browser identity, so the per-scanner limit does not interfere. */
async function scanAs(browser: Browser, url: string, n: number) {
  const ctx = await browser.newContext({
    locale: 'de-DE',
    userAgent: `Mozilla/5.0 (Linux; Android 15; E2E-${n}) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36`,
  });
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

test('quiet hours mute the push of normal alerts; urgent pushes pass; never an SMS (US-26)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail('quiet');
  const owner = await ownerWithActiveDecal(page, request, email);
  const url = owner.url;
  const app = await appDevice(request, email);
  // Konto → Benachrichtigungen → Ruhezeiten in the app: daily 00:00–00:00, urgent alerts still by push.
  const empty = await request.get(`${API_URL}/v1/quiet-hours`, { headers: owner.headers });
  expect(((await empty.json()) as { rules: unknown[] }).rules).toEqual([]);
  const added = await request.post(`${API_URL}/v1/quiet-hours`, {
    headers: owner.headers,
    data: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00', urgentBypass: true },
  });
  expect(added.status(), await added.text()).toBe(201);
  const { rules } = (await added.json()) as {
    rules: { id: string; start: string; end: string; urgentBypass: boolean }[];
  };
  expect(rules).toMatchObject([{ start: '00:00', end: '00:00', urgentBypass: true }]);

  const one = await scanAs(browser, url, 1);
  await one.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await one.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(one.page.getByText('Ihre Warnung wurde gesendet.')).toBeVisible();
  const two = await scanAs(browser, url, 2);
  await two.page.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await two.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(two.page.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  const urgent = await alertIdOf(two.page);
  await waitForAppPush(request, app.fcmToken, 'alert', urgent);
  const show = async () =>
    (await deliveries(email)).map(
      (d) => `${d.alert_type}:${d.channel}:${d.status}:${d.suppressed_reason ?? ''}`,
    );
  await expect
    .poll(show)
    .toEqual(
      expect.arrayContaining([
        'lights_on:native_push:suppressed:quiet_hours',
        'blocking:native_push:sent:',
      ]),
    );
  // The muted alert stays "sent", never "delivered": the scanner is not told about quiet hours.
  await expect(one.page.getByText('Ihre Warnung wurde gesendet.')).toBeVisible();

  // 30 minutes without a reaction: no SMS during quiet hours, not even for the urgent alert.
  const muted = await alertIdOf(one.page);
  await escalationDue(muted, 'sms');
  await escalationDue(urgent, 'sms');
  for (const id of [muted, urgent])
    await expect
      .poll(
        async () => (await smsDeliveries(id)).map((d) => `${d.status}:${d.suppressed_reason}`),
        {
          timeout: 20_000,
        },
      )
      .toEqual(['suppressed:quiet_hours']);
  await one.ctx.close();
  await two.ctx.close();

  const removed = await request.delete(`${API_URL}/v1/quiet-hours/${rules[0]!.id}`, {
    headers: owner.headers,
  });
  expect(removed.status()).toBe(200);
});

test('"Kurzer Halt" shows scanners when the driver is back (US-26, OW-17)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const owner = await ownerWithActiveDecal(page, request, uniqueEmail('stop'));
  const url = owner.url;
  // „Vorübergehender Modus“ → „Kurzer Halt“ for one hour on the app's vehicle screen.
  const started = await request.post(`${API_URL}/v1/vehicles/${owner.vehicleId}/mode`, {
    headers: owner.headers,
    data: { mode: 'short_stop', minutes: 60 },
  });
  expect(started.status(), await started.text()).toBe(200);
  const { mode } = (await started.json()) as { mode: { mode: string; endsAt: string } };
  expect(mode.mode).toBe('short_stop');
  // The scanner page shows the time in the scanner's own time zone (the same machine here).
  const until = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(mode.endsAt),
  );

  const scan = await scanAs(browser, url, 3);
  await expect(scan.page.getByText(`Fahrer ist gegen ${until} zurück`)).toBeVisible();
  await scan.ctx.close();

  const ended = await request.delete(`${API_URL}/v1/vehicles/${owner.vehicleId}/mode`, {
    headers: owner.headers,
  });
  expect(await ended.json()).toEqual({ mode: null });
  const after = await scanAs(browser, url, 4);
  await expect(after.page.getByText(/Fahrer ist gegen/)).toHaveCount(0);
  await after.ctx.close();
});

test('protection score (e-mail, app, mobile number, decal) and summary setting (US-28, US-30)', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('score');
  const owner = await ownerWithActiveDecal(page, request, email);
  const protection = async () => {
    const r = await request.get(`${API_URL}/v1/me/protection`, { headers: owner.headers });
    return (await r.json()) as { percent: number; steps: Record<string, boolean> };
  };
  // E-mail confirmed, mobile number verified, decal tested; the app is missing: 3 of 4 steps.
  expect(await protection()).toEqual({
    percent: 75,
    steps: { email: true, channel: false, phone: true, decal: true },
  });

  // The app is connected: fully protected.
  await appDevice(request, email);
  expect((await protection()).percent).toBe(100);

  // The e-mail summary setting (Konto in the app).
  const me = async () =>
    (
      (await (await request.get(`${API_URL}/v1/me`, { headers: owner.headers })).json()) as {
        summaryFrequency: string;
      }
    ).summaryFrequency;
  expect(await me()).toBe('monthly');
  const saved = await request.patch(`${API_URL}/v1/me`, {
    headers: owner.headers,
    data: { summaryFrequency: 'weekly' },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  expect(await me()).toBe('weekly');
});
