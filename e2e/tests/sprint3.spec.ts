import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, expectAccessible, signUp, uniqueEmail, waitForMail } from './helpers';

async function subscribeViaUi(page: Page, request: APIRequestContext, email: string) {
  await signUp(page, request, email);
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: 'Zahlungspflichtig bestellen' }).click();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page.getByText(/^Vertragsnummer: PS-/)).toBeVisible({ timeout: 15_000 });
}

async function addVehicle(page: Page, nickname: string, plate: string) {
  await page.getByLabel('Spitzname').fill(nickname);
  await page.getByLabel('Kennzeichen').fill(plate);
  await page.getByRole('button', { name: 'Fahrzeug hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: nickname })).toBeVisible();
}

test('vehicle, decal design, home PDF, included order, printing and tracking (US-09–US-11)', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('fahrzeug');
  await subscribeViaUi(page, request, email);

  await page.getByRole('link', { name: 'Fahrzeuge verwalten' }).click();
  await expectAccessible(page);
  await addVehicle(page, 'Der Blaue', 'K-AB 1234');
  await expect(page.getByText('K-AB 1234')).toBeVisible();
  await page.getByRole('link', { name: /Aufkleber und Details/ }).click();

  // Designer: template + suggestion, live preview, filtered custom text.
  await page.getByRole('radio', { name: 'Signal' }).check();
  await page.getByRole('radio', { name: 'Blockiere ich Sie? Bitte scannen' }).check();
  const preview = page.getByRole('img', { name: /Blockiere ich Sie\? Bitte scannen/ });
  await expect(preview).toBeVisible();
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expectAccessible(page);

  await page.getByRole('radio', { name: 'Eigener Text' }).check();
  await page.getByLabel(/Eigene Überschrift/).fill('Ruf an 0171 2345678');
  await page.getByRole('button', { name: 'Gestaltung speichern' }).click();
  await expect(page.getByText(/Diese Überschrift ist nicht erlaubt/).first()).toBeVisible();
  await page.getByLabel(/Eigene Überschrift/).fill('Bitte kurz scannen');
  await page.getByRole('button', { name: 'Gestaltung speichern' }).click();
  await expect(page.getByText('Gespeichert.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'PDF zum Selbstausdrucken' }).click();
  expect((await download).suggestedFilename()).toBe('parkshield-aufkleber.pdf');

  // Included decal: one order, printed by the worker, shipped with tracking.
  const included = page.locator('form').filter({ hasText: 'Inklusive Aufkleber bestellen' });
  await included.getByLabel('Name', { exact: true }).fill('Jonas Beispiel');
  await included.getByLabel('Straße und Hausnummer').fill('Domstraße 1');
  await included.getByLabel('Postleitzahl').fill('50667');
  await included.getByLabel('Ort').fill('Köln');
  await included.getByRole('button', { name: 'Inklusive Aufkleber bestellen' }).click();
  await expect(page.getByText('Bestellt!')).toBeVisible();
  await waitForMail(request, email, 'order_received');

  const orderId = await expect
    .poll(
      async () => {
        await page.reload();
        return (await page.getByText(/: im Druck$/).count()) > 0;
      },
      { timeout: 20_000, message: 'worker submits the print job' },
    )
    .toBe(true)
    .then(async () => {
      const res = await page.request.get('/v1/orders');
      return ((await res.json()) as { orders: { id: string }[] }).orders[0]!.id;
    });

  const shipped = await request.post(`${API_URL}/v1/dev/print/${orderId}/ship`, {
    data: { trackingNumber: '00340434161234567890' },
  });
  expect(shipped.ok()).toBe(true);
  const mail = await waitForMail(request, email, 'decal_shipped');
  expect(mail.text).toContain('00340434161234567890');
  await page.reload();
  await expect(page.getByText('Sendungsnummer: 00340434161234567890')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inklusive Aufkleber bestellen' })).toHaveCount(0);
});

test('plan limit shows the upgrade hint (US-09)', async ({ page, request }) => {
  await subscribeViaUi(page, request, uniqueEmail('limit'));
  await page.goto('/konto/fahrzeuge');
  await addVehicle(page, 'Erstes', 'K-A 1');
  await addVehicle(page, 'Zweites', 'K-A 2');
  await page.getByLabel('Spitzname').fill('Drittes');
  await page.getByLabel('Kennzeichen').fill('K-A 3');
  await page.getByRole('button', { name: 'Fahrzeug hinzufügen' }).click();
  await expect(
    page.getByText('Ihr Tarif Plus erlaubt 2 Fahrzeuge.', { exact: false }),
  ).toBeVisible();
});

test('failed renewal shows the past-due notice (US-08)', async ({ page, request }) => {
  const email = uniqueEmail('dunning');
  await subscribeViaUi(page, request, email);
  const res = await request.post(`${API_URL}/v1/dev/payments/fail`, { data: { email } });
  expect(res.ok()).toBe(true);
  await waitForMail(request, email, 'payment_failed');
  await page.reload();
  await expect(page.getByText('Zahlung offen', { exact: true })).toBeVisible();
  await expect(page.getByText(/Die letzte Abbuchung hat nicht geklappt/)).toBeVisible();
  await page.getByRole('button', { name: 'Zahlungsmethode ändern' }).click();
  await expect(page).toHaveURL(/\/konto\?portal=dev/);
});
