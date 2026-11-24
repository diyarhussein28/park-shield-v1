import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  API_URL,
  appDevice,
  appOwner,
  expectAccessible,
  expectNoAlertMail,
  ownerWithActiveDecal,
  smsCodeFor,
  sql,
  uniqueEmail,
  uniqueMobile,
  waitForAppPush,
} from './helpers';
const latestAlert = async (email: string) =>
  (
    await sql(
      `SELECT a.id FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id JOIN users u ON u.id = v.owner_user_id
        WHERE u.email = $1 ORDER BY a.created_at DESC LIMIT 1`,
      [email],
    )
  )[0]!.id as string;

/** A paying owner with „Der Blaue“ whose decal test is used up (helpers.ts, through the app's API). */
async function ownerWithVehicle(page: Page, request: APIRequestContext, email: string) {
  return (await ownerWithActiveDecal(page, request, email)).url;
}

async function scanner(
  browser: Browser,
  url: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: 'de-DE' });
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

test('friendly limit message, then guidance with the right numbers after expiry (US-17, US-18)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('limits');
  const url = await ownerWithVehicle(page, request, email);

  const { ctx, page: scan } = await scanner(browser, url);
  await scan.getByRole('button', { name: 'Licht brennt noch' }).click();
  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  const id = await latestAlert(email);

  // Same person (same network and browser) tries again from new tabs: two alerts per hour
  // (sliding window, `alert.scanner_vehicle`), then a friendly wait.
  const second = await scanner(browser, url);
  await second.page.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await second.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(second.page.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  await second.ctx.close();
  const again = await scanner(browser, url);
  await again.page.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await again.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(again.page.getByRole('alert')).toHaveText(
    /Sie haben das Limit für Benachrichtigungen überschritten\. Bitte versuchen Sie es später erneut \(in ca\. \d+ Min\.\)\./,
  );
  await again.ctx.close();

  // The first alert expires unanswered; the scanner was in Austria.
  await sql(
    `UPDATE alerts SET scanner_country = 'AT', expires_at = now() - interval '1 minute' WHERE id = $1`,
    [id],
  );
  const guide = scan.getByRole('heading', { name: 'Was Sie jetzt tun können' });
  await expect(guide).toBeVisible({ timeout: 10_000 });
  await expect(scan.getByText('Leider keine Antwort vom Fahrer.')).toBeVisible();
  await expect(scan.getByText(/Magistrat \/ Gemeindeamt$/)).toBeVisible();
  await expect(scan.getByRole('link', { name: '133' }).first()).toHaveAttribute('href', 'tel:133');
  await expect(scan.getByRole('link', { name: '112' })).toHaveAttribute('href', 'tel:112');
  const osm = scan.getByRole('link', { name: /in der Nähe suchen/ });
  expect(await osm.getAttribute('href')).toBe(
    'https://www.openstreetmap.org/search?query=Magistrat',
  );
  await expectAccessible(scan);
  await ctx.close();
});

test('"Ich warte noch" reminds the owner once (US-18, SC-14)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('waiting');
  const url = await ownerWithVehicle(page, request, email);
  const app = await appDevice(request, email);
  const { ctx, page: scan } = await scanner(browser, url);
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(scan.getByRole('button', { name: 'Ich warte noch' })).toBeHidden();

  // The owner acknowledged 16 minutes ago and has not arrived.
  const id = await latestAlert(email);
  await sql(
    `UPDATE alerts SET status = 'acknowledged', acknowledged_at = now() - interval '16 minutes' WHERE id = $1`,
    [id],
  );
  const wait = scan.getByRole('button', { name: 'Ich warte noch' });
  await expect(wait).toBeVisible({ timeout: 10_000 });
  await expectAccessible(scan);
  await wait.click();
  await expect(scan.getByText(/Wir haben den Fahrer erinnert\./)).toBeVisible({ timeout: 10_000 });
  await expect(wait).toBeHidden();
  // The reminder goes to the owner's app (push only, generic payload), never by e-mail.
  const push = await waitForAppPush(request, app.fcmToken, 'followup', id);
  expect(push.body.message.data).toEqual({ alertId: id, kind: 'followup' });
  await expectNoAlertMail(request, email);
  await ctx.close();
});

test('a suspicious decal can be reported (US-19, SC-15)', async ({ page, request, browser }) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('fake');
  const url = await ownerWithVehicle(page, request, email);
  const { ctx, page: scan } = await scanner(browser, url);
  const open = scan.getByRole('button', { name: 'Aufkleber sieht verdächtig aus?' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(scan.getByText(/führen immer zu park-shield\.de/)).toBeVisible();
  await scan.getByLabel('Was ist Ihnen aufgefallen? (freiwillig)').fill('Aufkleber überklebt');
  await expectAccessible(scan);
  await scan.getByRole('button', { name: 'Meldung senden' }).click();
  await expect(scan.getByText('Danke! Unser Team prüft den Aufkleber.')).toBeVisible();
  const rows = await sql(
    `SELECT r.kind, r.note FROM abuse_reports r JOIN qr_tokens t ON t.id = r.qr_token_id
       JOIN vehicles v ON v.id = t.vehicle_id JOIN users u ON u.id = v.owner_user_id WHERE u.email = $1`,
    [email],
  );
  expect(rows).toEqual([{ kind: 'fake_decal', note: 'Aufkleber überklebt' }]);
  await ctx.close();
});

test('notification settings: app status, verified number, quiet hours; no e-mail, browser push or channel order (NT-07)', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('push');
  const owner = await ownerWithActiveDecal(page, request, email);
  const channels = async () => {
    const r = await request.get(`${API_URL}/v1/channels`, { headers: owner.headers });
    expect(r.status()).toBe(200);
    return (await r.json()) as {
      app: { devices: { platform: string }[] };
      sms: { phone?: string; verified?: boolean } | null;
    };
  };
  // No app yet (the app warns: alerts only by the SMS after 30 minutes); the number is verified.
  const before = await channels();
  expect(before.app.devices).toEqual([]);
  expect(before.sms).toBeTruthy();

  // The number can be changed, never removed: the API refuses to delete it.
  const removed = await request.delete(`${API_URL}/v1/channels/sms`, { headers: owner.headers });
  expect(removed.status()).toBe(409);
  expect(await removed.json()).toMatchObject({ error: 'phone_required' });

  // The app signs in and registers its device.
  await appDevice(request, email);
  expect((await channels()).app.devices).toMatchObject([{ platform: 'android' }]);
});

test('mobile number: required, changed only with a new SMS code; no WhatsApp anywhere (NT-07)', async ({
  request,
}) => {
  test.setTimeout(60_000);
  const owner = await appOwner(request, uniqueEmail('phone'));
  const profile = async () =>
    (await (await request.get(`${API_URL}/v1/me/profile`, { headers: owner.headers })).json()) as {
      phone: string | null;
      phoneVerified: boolean;
    };
  const before = await profile();
  expect(before).toMatchObject({ phoneVerified: true });
  expect(before.phone).toMatch(/\d{4}$/);

  // A new number replaces the old one only after its SMS code.
  const next = uniqueMobile();
  const start = await request.post(`${API_URL}/v1/channels/phone`, {
    headers: owner.headers,
    data: { phone: next, channels: ['sms'], consent: true },
  });
  expect(start.status(), await start.text()).toBe(200);
  expect((await profile()).phone).toBe(before.phone);
  const verify = await request.post(`${API_URL}/v1/channels/phone/verify`, {
    headers: owner.headers,
    data: { code: await smsCodeFor(request, next) },
  });
  expect(verify.status(), await verify.text()).toBe(200);
  const after = await profile();
  expect(after.phoneVerified).toBe(true);
  expect(after.phone).not.toBe(before.phone);
  expect(after.phone!.slice(-4)).toBe(next.slice(-4));
});
