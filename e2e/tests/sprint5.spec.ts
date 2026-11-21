import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  appDevice,
  expectAccessible,
  expectNoAlertMail,
  signUp,
  sql,
  uniqueEmail,
  verifyPhone,
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

async function ownerWithVehicle(page: Page, request: APIRequestContext, email: string) {
  await signUp(page, request, email);
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: /Zahlungspflichtig bestellen/ }).click();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page.getByText(/^Vertragsnummer: PS-/)).toBeVisible({ timeout: 15_000 });
  await page.goto('/konto/fahrzeuge');
  await page.getByLabel('Spitzname').fill('Der Blaue');
  await page.getByLabel('Kennzeichen').fill('K-AB 1234');
  await page.getByRole('button', { name: 'Fahrzeug hinzufügen' }).click();
  await page.getByRole('link', { name: /Aufkleber und Details/ }).click();
  await page.getByRole('button', { name: 'Aufkleber testen' }).click();
  const link = page.getByRole('link', { name: 'Scan-Seite auf diesem Gerät öffnen' });
  const url = (await link.getAttribute('href'))!;
  // Use up the test window, so the next scans are real alerts.
  const own = await scanner(page.context().browser()!, url);
  await own.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await own.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(own.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  await own.ctx.close();
  return url;
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
  await ownerWithVehicle(page, request, email);
  await page.goto('/konto');
  await page.getByRole('link', { name: 'Benachrichtigungen einstellen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Benachrichtigungen' })).toBeVisible();

  // No app yet: a persistent warning; alerts would reach the owner only by the SMS after 30 minutes.
  const warning = page.getByText(
    'Mitteilungen sind aus. Sie erfahren von Warnungen erst nach 30 Minuten per SMS.',
  );
  await expect(warning).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ihre Handynummer' })).toBeVisible();
  await expect(page.getByText(/^Ihre Nummer: \+49/)).toBeVisible();
  await expect(page.getByText('Bestätigt', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Ruhezeiten/ })).toBeVisible();
  // Removed on 2026-11-21: alert e-mails, browser push, the channel order and WhatsApp.
  await expect(page.getByRole('button', { name: /Push auf diesem Gerät/ })).toHaveCount(0);
  await expect(page.getByText(/Reihenfolge|WhatsApp|Warnungen gehen immer an/)).toHaveCount(0);
  await expectAccessible(page);

  // The number can be changed, never removed: the API refuses to delete it.
  const csrf = (await page.context().cookies()).find((c) => c.name === 'ps_csrf')!.value;
  const removed = await page.request.delete('/v1/channels/sms', {
    headers: { 'x-csrf-token': csrf },
  });
  expect(removed.status()).toBe(409);
  expect(await removed.json()).toMatchObject({ error: 'phone_required' });

  // The app signs in and registers its device: the page shows it, the warning is gone.
  await appDevice(request, email);
  await page.reload();
  await expect(page.getByText(/^Android · zuletzt aktiv/)).toBeVisible();
  await expect(page.getByText('Aktiv', { exact: true })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await expectAccessible(page);
});

test('mobile number: required, changed only with a new SMS code; no WhatsApp anywhere (NT-07)', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const email = uniqueEmail('phone');
  await signUp(page, request, email);
  // Before paying, the section is closed and points to the subscription.
  await page.goto('/konto/benachrichtigungen');
  await expect(
    page.getByRole('heading', { name: 'Erst das Abo, dann geht es hier weiter' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Zum Abo' }).click();
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: /Zahlungspflichtig bestellen/ }).click();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page.getByText('Zahlung erhalten. Willkommen bei ParkShield!')).toBeVisible({
    timeout: 15_000,
  });
  await page.goto('/konto/benachrichtigungen');
  await page.waitForLoadState('networkidle');
  const card = page.getByRole('region', { name: 'Ihre Handynummer' });
  const before = await card.getByText(/^Ihre Nummer: /).textContent();
  await expect(card.getByRole('button', { name: /abschalten|entfernen/ })).toHaveCount(0);

  await card.getByRole('button', { name: 'Nummer ändern' }).click();
  await expect(
    card.getByText('Die neue Nummer gilt erst, wenn Sie sie mit dem SMS-Code bestätigt haben.'),
  ).toBeVisible();
  await expectAccessible(page);
  await verifyPhone(page, { checkout: false });
  await expect(card.getByText('Bestätigt', { exact: true })).toBeVisible();
  const after = await card.getByText(/^Ihre Nummer: /).textContent();
  expect(after).toMatch(/^Ihre Nummer: \+49 ••• \d{4}$/);
  expect(after).not.toBe(before);

  await expect(page.getByText(/WhatsApp/)).toHaveCount(0);
  await expectAccessible(page);
});
