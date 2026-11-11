import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { expectAccessible, signUp, uniqueEmail, waitForMail } from './helpers';

async function ownerWithVehicle(page: Page, request: APIRequestContext, email: string) {
  await signUp(page, request, email);
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: 'Zahlungspflichtig bestellen' }).click();
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
  const url = await testWindowUrl(page);
  expect(url).toMatch(/\/s\/[0-9A-HJKMNP-TV-Z]{10}$/);

  // Owner's own test scan.
  const test1 = await scannerPage(browser, url);
  await expect(test1.page.getByText(/Testmodus/)).toBeVisible();
  await test1.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(test1.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  await waitForMail(request, email, 'alert_test');
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
  expect((await res.body()).length).toBeLessThan(40_000); // whole page incl. inline JS and CSS
  await expect(scan.getByRole('heading', { level: 1 })).toHaveText('Was ist los?');
  await expect(scan.getByText('„Der Blaue“')).toBeVisible();
  await expect(scan.getByText('Blau', { exact: true })).toBeVisible();
  await expect(scan.getByText('Echte Seite: pkshd.de')).toBeVisible();
  await expect(scan.getByText('ParkShield verlangt nie eine Zahlung')).toBeVisible();
  await expect(scan.getByText(/K-AB|1234/)).toHaveCount(0);
  await expectAccessible(scan);
  await scan.emulateMedia({ colorScheme: 'dark' });
  await expectAccessible(scan);
  for (const b of await scan.locator('.type').all())
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);

  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  await expect(scan.getByText('Die Warnung ist beim Fahrer angekommen.')).toBeVisible({
    timeout: 15_000,
  });
  const mail = await waitForMail(request, email, 'alert_received');
  expect(mail.text).toContain('Fahrzeug versperrt Ausfahrt');

  // Survives a reload in the same session; language switches in place; no cookies were ever set.
  await scan.reload();
  await expect(scan.getByText('Die Warnung ist beim Fahrer angekommen.')).toBeVisible();
  await scan.getByRole('button', { name: /EN/ }).click();
  await expect(scan.getByText('The alert has reached the driver.')).toBeVisible();
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
  const url = await testWindowUrl(page);
  const owner = await scannerPage(browser, url); // use up the test window first
  await owner.page.getByRole('button', { name: 'Licht brennt noch' }).click();
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
  const mail = await waitForMail(request, email, 'alert_received');
  expect(mail.text).toContain('Ihr Kofferraum steht offen');
  expect(mail.text).not.toContain('0171');
  await ctx.close();
});

test('revoking a code makes the old decal inactive; replacement is paid (US-13, SC-07)', async ({
  page,
  request,
  browser,
}) => {
  await ownerWithVehicle(page, request, uniqueEmail('revoke'));
  const oldUrl = await testWindowUrl(page);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Code sperren und neuen ausstellen' }).click();
  await expect(page.getByText(/Neuer Code ausgestellt/)).toBeVisible();

  const { ctx, page: scan, res } = await scannerPage(browser, oldUrl);
  expect(res.status()).toBe(404);
  await expect(scan.getByRole('heading', { level: 1 })).toHaveText(
    'Dieser Aufkleber ist nicht aktiv',
  );
  await expectAccessible(scan);
  await ctx.close();

  const replacement = page.locator('form').filter({ hasText: 'Ersatzaufkleber bestellen' });
  await replacement.getByLabel('Name', { exact: true }).fill('Jonas Beispiel');
  await replacement.getByLabel('Straße und Hausnummer').fill('Domstraße 1');
  await replacement.getByLabel('Postleitzahl').fill('50667');
  await replacement.getByLabel('Ort').fill('Köln');
  await replacement.getByRole('button', { name: /Ersatzaufkleber bestellen/ }).click();
  await expect(page.getByText(/Betrag: 5,90/)).toBeVisible();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page.getByText('Danke! Ihr Ersatzaufkleber wird gedruckt.')).toBeVisible();
});
