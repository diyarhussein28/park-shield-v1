import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import {
  alertIdOf,
  appDevice,
  expectAccessible,
  expectNoAlertMail,
  API_URL,
  signUp,
  sql,
  uniqueEmail,
  waitForAppPush,
} from './helpers';

async function ownerWithVehicle(page: Page, request: APIRequestContext, email: string) {
  await signUp(page, request, email);
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: /Zahlungspflichtig bestellen/ }).click();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page.getByText(/^Vertragsnummer: PS-/)).toBeVisible({ timeout: 15_000 });
  await page.goto('/konto/fahrzeuge');
  await page.getByLabel('Spitzname').fill('Der Blaue');
  await page.getByLabel('Kennzeichen').fill('K-AB 1234');
  await page.getByLabel('Farbe').fill('Blau');
  await page.getByRole('button', { name: 'Fahrzeug hinzufügen' }).click();
  await page.getByRole('link', { name: /Aufkleber und Details/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Der Blaue' })).toBeVisible();
}

/** Opens the test window in the portal and returns the decal's scan URL. */
async function testWindowUrl(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Aufkleber testen' }).click();
  const link = page.getByRole('link', { name: 'Scan-Seite auf diesem Gerät öffnen' });
  await expect(link).toBeVisible();
  return (await link.getAttribute('href'))!;
}

/** A stranger's phone: fresh context, no cookies, German. */
async function scannerPage(browser: Browser, url: string, locale = 'de-DE') {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  const res = await page.goto(url);
  return { ctx, page, res: res! };
}

test('owner test scan activates the decal, then a stranger scans (US-12, US-14, US-16)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('scan');
  await ownerWithVehicle(page, request, email);
  const app = await appDevice(request, email);
  const url = await testWindowUrl(page);
  expect(url).toMatch(/\/s\/[0-9A-HJKMNP-TV-Z]{10}$/);

  // Owner's own test scan.
  const test1 = await scannerPage(browser, url);
  await expect(test1.page.getByText(/Testmodus/)).toBeVisible();
  await test1.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await test1.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(test1.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  // The test reaches the owner's app like a real alert (push only, no e-mail).
  await waitForAppPush(request, app.fcmToken, 'test', await alertIdOf(test1.page));
  await page.reload();
  await expect(page.getByText(/Zuletzt erfolgreich getestet am/)).toBeVisible();
  await test1.ctx.close();

  // A stranger: no cookies, strict CSP, small page, accessible in light and dark.
  const { ctx, page: scan, res } = await scannerPage(browser, url);
  expect(res.status()).toBe(200);
  const csp = res.headers()['content-security-policy']!;
  expect(csp).toContain("default-src 'none'");
  expect(csp).toMatch(/script-src 'sha256-[^']+'/);
  expect(res.headers()['set-cookie']).toBeUndefined();
  // Whole page incl. inline JS, CSS, SVG icons and both languages' texts (~21 KB compressed). Raised
  // from 55 KB for the redesign (2026-11-21); the hard budget is 90 KB (AGENTS.md §7).
  expect((await res.body()).length).toBeLessThan(80_000);
  await expect(scan.getByRole('heading', { level: 1 })).toHaveText('Was ist los?');
  await expect(scan.getByText('„Der Blaue“')).toBeVisible();
  await expect(scan.getByText('Blau', { exact: true })).toBeVisible();
  await expect(scan.getByText('Nur echt auf park-shield.de')).toBeVisible();
  await expect(scan.getByText('ParkShield verlangt nie eine Zahlung.')).toBeVisible();
  await expect(scan.getByText(/K-AB|1234/)).toHaveCount(0);
  await expectAccessible(scan);
  await scan.emulateMedia({ colorScheme: 'dark' });
  await expectAccessible(scan);
  for (const b of await scan.locator('.type').all())
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);

  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();

  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  // App push only, generic: the alert id and the kind, never the problem, plate or nickname.
  const push = await waitForAppPush(request, app.fcmToken, 'alert', await alertIdOf(scan));
  expect(push.body.message.data).toEqual({ alertId: await alertIdOf(scan), kind: 'alert' });
  expect(JSON.stringify(push.body)).not.toMatch(/versperrt|Der Blaue|K-AB|1234/);
  await expectNoAlertMail(request, email);

  // Survives a reload in the same session; language switches in place; no cookies were ever set.
  await scan.reload();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible();
  await scan.getByRole('button', { name: /EN/ }).click();
  await expect(scan.getByText('The vehicle owner has been notified.')).toBeVisible();
  await expect(scan.locator('html')).toHaveAttribute('lang', 'en');
  expect(await ctx.cookies()).toEqual([]);
  await ctx.close();
});

test('custom messages are filtered before they are sent (US-15)', async ({
  page,
  request,
  browser,
}) => {
  const email = uniqueEmail('text');
  await ownerWithVehicle(page, request, email);
  const app = await appDevice(request, email);
  const url = await testWindowUrl(page);
  const owner = await scannerPage(browser, url); // use up the test window first
  await owner.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await owner.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(owner.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  await owner.ctx.close();

  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Eigene Nachricht' }).click();
  await scan.getByLabel('Ihre Nachricht').fill('Ruf mich an: 0171 2345678');
  await expect(scan.getByText(/von 280 Zeichen/)).toBeVisible();
  await scan.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(scan.getByRole('alert')).toContainText('Diese Nachricht können wir nicht senden');
  await scan.getByLabel('Ihre Nachricht').fill('Ihr Kofferraum steht offen');
  await scan.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  // The text reaches the owner only inside the app (never in the push payload, never by e-mail).
  const alertId = await alertIdOf(scan);
  const push = await waitForAppPush(request, app.fcmToken, 'alert', alertId);
  expect(JSON.stringify(push.body)).not.toContain('Kofferraum');
  const detail = (await (
    await request.get(`${API_URL}/v1/app/alerts/${alertId}`, { headers: app.headers })
  ).json()) as { message: string | null };
  expect(detail.message).toBe('Ihr Kofferraum steht offen');
  await expectNoAlertMail(request, email);
  await ctx.close();
});

test('„Sperren“ makes the old decal inactive and creates no new code; a new code is free (US-13, SC-07)', async ({
  page,
  request,
  browser,
}) => {
  const email = uniqueEmail('revoke');
  await ownerWithVehicle(page, request, email);
  const oldUrl = await testWindowUrl(page);
  const tokens = () =>
    sql<{ status: string }>(
      `SELECT t.status FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
        WHERE v.owner_user_id = (SELECT id FROM users WHERE email = $1) ORDER BY t.created_at`,
      [email],
    );
  expect((await tokens()).map((t) => t.status)).toEqual(['assigned']);

  // The dialog says exactly what happens before anything is locked.
  await page.getByRole('button', { name: 'Sperren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Code wirklich sperren?' });
  await expect(dialog).toBeVisible();
  for (const line of [
    'Der alte Aufkleber funktioniert sofort nicht mehr.',
    'Es wird nicht automatisch ein neuer Code erstellt.',
    'Einen neuen Code erstellen Sie danach selbst, kostenlos.',
    /^Drucken und Zusenden lassen kostet 3\s?€ einmalig, selbst drucken ist kostenlos\.$/,
  ])
    await expect(dialog.getByText(line)).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole('button', { name: 'Ja, Code jetzt sperren' }).click();
  await expect(page.getByText('Der Code ist gesperrt.', { exact: false })).toBeVisible();

  // No replacement: the vehicle has no active code and says so, in the detail and the overview.
  expect((await tokens()).map((t) => t.status)).toEqual(['revoked']);
  await expect(
    page.getByText('Kein aktiver Code – Ihr Fahrzeug ist nicht geschützt').first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aufkleber testen' })).toHaveCount(0);
  await expect(
    page.getByText('Erstellen Sie zuerst einen neuen Code', { exact: false }),
  ).toBeVisible();
  await expectAccessible(page);

  const { ctx, page: scan, res } = await scannerPage(browser, oldUrl);
  expect(res.status()).toBe(404);
  await expect(scan.getByRole('heading', { level: 1 })).toHaveText(
    'Dieser Aufkleber ist nicht aktiv',
  );
  await expectAccessible(scan);
  await ctx.close();

  await page.goto('/konto/fahrzeuge');
  await expect(
    page.getByText('Kein aktiver Code – Ihr Fahrzeug ist nicht geschützt').first(),
  ).toBeVisible();
  await page.goto('/konto');
  await expect(
    page.getByText('Kein aktiver Code – Ihr Fahrzeug ist nicht geschützt').first(),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');

  // „Neuen Code erstellen“ is an explicit, free action; it never needs a payment.
  await page.getByRole('button', { name: 'Neuen Code erstellen' }).first().click();
  await expect(page.getByText('Kein aktiver Code – Ihr Fahrzeug ist nicht geschützt')).toHaveCount(
    0,
  );
  await expect(page).not.toHaveURL(/checkout/);
  expect((await tokens()).map((t) => t.status)).toEqual(['revoked', 'assigned']);
  await expectAccessible(page);
});
