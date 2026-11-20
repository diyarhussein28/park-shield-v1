import { expect, test } from '@playwright/test';
import { expectAccessible, linkIn, uniqueEmail, waitForMail } from './helpers';

/**
 * Sign-up before payment (docs/app-redesign.md §6/§7): a new account gives name and postal address
 * on /konto before the checkout appears; the API refuses the checkout without them.
 */
test('a new account completes name and address before the checkout', async ({ page, request }) => {
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
  await expect(page.getByRole('button', { name: 'Zahlungspflichtig bestellen' })).toBeVisible({
    timeout: 15_000,
  });
  await expectAccessible(page);
});
