import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { API_URL, expectAccessible, signUp, sql, uniqueEmail, waitForMail } from './helpers';

async function subscribeViaUi(page: Page, request: APIRequestContext, email: string) {
  await signUp(page, request, email);
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: /Zahlungspflichtig bestellen/ }).click();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page.getByText(/^Vertragsnummer: PS-/)).toBeVisible({ timeout: 15_000 });
}

async function fillAddress(scope: Locator) {
  await scope.getByLabel('Name', { exact: true }).fill('Jonas Beispiel');
  await scope.getByLabel('Straße und Hausnummer').fill('Domstraße 1');
  await scope.getByLabel('Postleitzahl').fill('50667');
  await scope.getByLabel('Ort').fill('Köln');
}

async function addVehicle(page: Page, nickname: string, plate: string) {
  await page.getByLabel('Spitzname').fill(nickname);
  await page.getByLabel('Kennzeichen').fill(plate);
  await page.getByRole('button', { name: 'Fahrzeug hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: nickname })).toBeVisible();
}

test('vehicle, decal design, print options: self-print free, first shipped print free, then 3 € (US-09–US-11)', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
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

  // „Selbst drucken – kostenlos“: PDF (80 × 80 mm with cut marks), PNG and SVG, always free.
  const print = page.locator('#drucken');
  const self = print.getByRole('listitem').filter({ hasText: 'Selbst drucken – kostenlos' });
  await expect(self.getByText(/wetterfeste Polyester-Etiketten/)).toBeVisible();
  const download = page.waitForEvent('download');
  await self.getByRole('link', { name: 'PDF herunterladen' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  for (const [name, type] of [
    ['PNG herunterladen', 'image/png'],
    ['SVG herunterladen', 'image/svg+xml'],
  ] as const) {
    const href = (await self.getByRole('link', { name }).getAttribute('href'))!;
    const res = await page.request.get(href);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain(type);
  }

  // „Drucken und zusenden lassen“: the first one is the free welcome print.
  const shipped = print.getByRole('listitem').filter({ hasText: 'Drucken und zusenden lassen' });
  await expect(shipped.getByText('kostenlos (Willkommensdruck)')).toBeVisible();
  // Part B: one confirmation step (preview, label, address, no-withdrawal notice) before the order.
  await shipped.getByRole('button', { name: 'Weiter: Aufkleber prüfen' }).click();
  await expect(shipped.getByText(/individuell gedruckt/)).toBeVisible();
  await expect(shipped.getByRole('link', { name: 'Design ändern' })).toBeVisible();
  await fillAddress(shipped);
  await shipped.getByRole('button', { name: 'Jetzt drucken und zusenden' }).click();
  await expect(page.getByText(/^Bestellt!/)).toBeVisible();
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
  const [welcome] = await sql<{ total_gross_cents: number; included_in_plan: boolean }>(
    'SELECT total_gross_cents, included_in_plan FROM decal_orders WHERE id = $1',
    [orderId],
  );
  expect(welcome).toEqual({ total_gross_cents: 0, included_in_plan: true });

  const shippedRes = await request.post(`${API_URL}/v1/dev/print/${orderId}/ship`, {
    data: { trackingNumber: '00340434161234567890' },
  });
  expect(shippedRes.ok()).toBe(true);
  const mail = await waitForMail(request, email, 'decal_shipped');
  expect(mail.text).toContain('00340434161234567890');
  await page.reload();
  await expect(page.getByText('Sendungsnummer: 00340434161234567890')).toBeVisible();

  // The next shipped print costs 3 € (one-time payment); self-printing stays free.
  await expect(shipped.getByText('kostenlos (Willkommensdruck)')).toHaveCount(0);
  await expect(shipped.getByText(/^3\s?€ einmalig inkl\. MwSt\.$/)).toBeVisible();
  await expect(self.getByRole('heading', { name: 'Selbst drucken – kostenlos' })).toBeVisible();
  await expectAccessible(page);
  await shipped.getByRole('button', { name: 'Weiter: Aufkleber prüfen' }).click();
  await fillAddress(shipped);
  await shipped.getByRole('button', { name: /^3\s?€ bezahlen und zusenden$/ }).click();
  await expect(page).toHaveURL(/\/dev\/checkout\?session=cs_fake_/);
  await expect(page.getByText(/Betrag: 3,00/)).toBeVisible();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page).toHaveURL(/\/konto\/fahrzeuge\/[0-9a-f-]+\?order=paid/);
  await expect(
    page.getByText('Danke! Ihre Zahlung ist eingegangen', { exact: false }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          await sql<{ status: string }>(
            `SELECT status FROM decal_orders
              WHERE user_id = (SELECT id FROM users WHERE email = $1)
                AND paid_print AND total_gross_cents = 300`,
            [email],
          )
        ).map((r) => r.status),
      { timeout: 20_000, message: 'the paid print order is paid and goes to the printer' },
    )
    .toEqual([expect.stringMatching(/^(paid|in_production)$/)]);
});

test('one vehicle per account: the add form disappears, the API refuses a second (US-09)', async ({
  page,
  request,
}) => {
  await subscribeViaUi(page, request, uniqueEmail('limit'));
  await page.goto('/konto/fahrzeuge');
  await page.waitForLoadState('networkidle');
  await addVehicle(page, 'Erstes', 'K-A 1');
  await expect(page.getByRole('button', { name: 'Fahrzeug hinzufügen' })).toHaveCount(0);
  await expect(page.getByText(/Ihr Tarif gilt für 1 Fahrzeug\./)).toBeVisible();
  await expect(page.getByText(/Premium|Upgrade/)).toHaveCount(0);
  await expectAccessible(page);
  const csrf = (await page.context().cookies()).find((c) => c.name === 'ps_csrf')!.value;
  const second = await page.request.post('/v1/vehicles', {
    headers: { 'x-csrf-token': csrf },
    data: { nickname: 'Zweites', plate: 'K-A 2' },
  });
  expect(second.status()).toBe(409);
  expect(await second.json()).toMatchObject({ error: 'vehicle_limit', limit: 1 });
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
