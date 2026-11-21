import { expect, test } from '@playwright/test';
import { expectAccessible, linkIn, uniqueEmail, verifyPhone, waitForMail } from './helpers';

/**
 * Sign-up before payment (docs/app-redesign.md §6/§7, single plan 2026-11-21): a new account gives
 * name and postal address, then verifies a mobile number, before the checkout appears; the API
 * refuses the checkout without them.
 */
test('a new account completes name, address and a verified mobile number before the checkout', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('profil');
  await page.goto('/anmelden');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByRole('button', { name: 'Link senden' }).click();
  const mail = await waitForMail(request, email, 'magic_link');
  await page.goto(linkIn(mail));
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/konto$/, { timeout: 30_000 });

  await expect(page.getByRole('heading', { name: 'Konto vervollständigen' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Zahlungspflichtig bestellen' })).toHaveCount(0);
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Speichern und weiter' }).click();
  await expect(page.getByText('Bitte ausfüllen.').first()).toBeVisible();

  await page.getByLabel('Vorname', { exact: true }).fill('Erika');
  await page.getByLabel('Nachname', { exact: true }).fill('Mustermann');
  await page.getByLabel('Straße und Hausnummer').fill('Musterstraße 12');
  await page.getByLabel('Postleitzahl').fill('5066');
  await page.getByLabel('Ort', { exact: true }).fill('Köln');
  await page.getByRole('button', { name: 'Speichern und weiter' }).click();
  await expect(page.getByText('Bitte eine Postleitzahl mit 5 Ziffern eingeben.')).toBeVisible();

  await page.getByLabel('Postleitzahl').fill('50667');
  await page.getByRole('button', { name: 'Speichern und weiter' }).click();

  // The mobile number is required (escalation SMS): no checkout until it is verified.
  const phone = page.getByLabel('Handynummer', { exact: true });
  await expect(phone).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Zahlungspflichtig bestellen/ })).toHaveCount(0);
  await expectAccessible(page);
  const { immediateStart, terms } = (await (
    await page.request.get('/v1/legal/checkout-texts?locale=de')
  ).json()) as { immediateStart: { version: number }; terms: { version: number } };
  const csrf = (await page.context().cookies()).find((c) => c.name === 'ps_csrf')!.value;
  const refused = await page.request.post('/v1/billing/checkout', {
    headers: { 'x-csrf-token': csrf },
    data: {
      immediateStart: true,
      immediateStartVersion: immediateStart.version,
      termsVersion: terms.version,
    },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toMatchObject({ error: 'phone_required' });

  // A landline cannot receive the SMS.
  await phone.fill('0221 1234567');
  await page.getByRole('button', { name: 'Code per SMS senden' }).click();
  await expect(
    page.getByText('Festnetz- und Internetnummern können keine SMS empfangen', { exact: false }),
  ).toBeVisible();

  await verifyPhone(page);
  await expect(page.getByRole('button', { name: /Zahlungspflichtig bestellen – 20 €/ })).toBeVisible();
  await expectAccessible(page);
});
