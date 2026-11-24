import { expect, test } from '@playwright/test';
import { expectAccessible, ownerWithActiveDecal, uniqueEmail, waitForMail } from './helpers';

/**
 * Konto → „E-Mail-Adresse ändern“ on the website (2026-11-24, the same flow as the app): the code goes
 * to the new address, the account keeps the old one until it is confirmed, the old one gets a notice.
 */
test('the owner changes the e-mail address on /konto/abo with a code sent to the new address', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('mailwechsel');
  const next = uniqueEmail('neue-adresse');
  await ownerWithActiveDecal(page, request, email);

  await page.goto('/konto/abo');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('account-email')).toHaveText(`Ihre Adresse: ${email}`);
  await page.getByRole('button', { name: 'E-Mail-Adresse ändern' }).click();
  await page.getByLabel('Neue E-Mail-Adresse').fill(email);
  await page.getByRole('button', { name: 'Code an neue Adresse senden' }).click();
  await expect(page.getByText('Das ist bereits Ihre E-Mail-Adresse.')).toBeVisible();

  await page.getByLabel('Neue E-Mail-Adresse').fill(next);
  await page.getByRole('button', { name: 'Code an neue Adresse senden' }).click();
  await expect(
    page.getByText(`Wir haben einen 6-stelligen Code an ${next} geschickt.`),
  ).toBeVisible();
  await expectAccessible(page);
  const mail = await waitForMail(request, next, 'email_change_code');
  const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
  await page.getByLabel('Code aus der E-Mail').fill(code);
  await page.getByRole('button', { name: 'Neue Adresse bestätigen' }).click();

  await expect(page.getByText(`Ihre E-Mail-Adresse ist jetzt ${next}.`)).toBeVisible();
  await expect(page.getByTestId('account-email')).toHaveText(`Ihre Adresse: ${next}`);
  await waitForMail(request, email, 'email_changed');
});

/** The danger line „In echter Gefahr: 110 … 112 …“ has both numbers as tap-to-call links. */
test('the scanner page links 110 and 112 for calling', async ({ page }) => {
  await page.goto('/s/0000000000');
  const danger = page.locator('.danger');
  await expect(danger).toContainText('In echter Gefahr');
  await expect(danger.locator('a[href="tel:110"]')).toHaveText('110');
  await expect(danger.locator('a[href="tel:112"]')).toHaveText('112');
  await expectAccessible(page);
});
