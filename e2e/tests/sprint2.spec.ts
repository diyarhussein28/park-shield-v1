import { expect, test } from '@playwright/test';
import { expectAccessible, linkIn, signUp, uniqueEmail, waitForMail } from './helpers';

test.describe('landing and legal pages (US-04)', () => {
  test('shows prices incl. VAT and the Premium date (only Plus and Premium), and is accessible', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Ihre Handynummer gehört nicht hinter die Windschutzscheibe.',
    );
    const pricing = page.locator('#preise');
    await expect(pricing.getByText('10 € / Jahr inkl. 19 % MwSt.')).toBeVisible();
    await expect(pricing.getByText('15 € / Jahr inkl. 19 % MwSt.')).toBeVisible();
    await expect(pricing.getByText('Verfügbar ab 9. November 2027')).toBeVisible();
    // The Business plan was removed.
    await expect(pricing.getByText('Business')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Verträge hier kündigen' })).toBeVisible();
    await expectAccessible(page);
  });

  for (const [path, footerLabel, title] of [
    ['/impressum', 'Impressum', 'Impressum'],
    ['/datenschutz', 'Datenschutz', 'Datenschutzerklärung'],
    ['/agb', 'AGB', 'Allgemeine Geschäftsbedingungen'],
    ['/widerruf', 'Widerruf', 'Widerrufsbelehrung'],
    ['/barrierefreiheit', 'Barrierefreiheit', 'Erklärung zur Barrierefreiheit'],
  ] as const) {
    test(`${path} is linked in the footer and accessible`, async ({ page }) => {
      await page.goto('/');
      await page.locator('footer').getByRole('link', { name: footerLabel, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expectAccessible(page);
    });
  }
});

test.describe('sign-up, annual checkout, cancellation (US-05, US-06, US-07)', () => {
  test('full journey: magic link → Plus checkout → active → cancel with receipt', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('jonas');
    await signUp(page, request, email);
    await expectAccessible(page);

    // Immediate-start request is mandatory before paying: the button stays off until it is ticked.
    await expect(page.getByRole('button', { name: 'Zahlungspflichtig bestellen' })).toBeDisabled();
    await expect(page.getByText('Bitte bestätigen Sie den sofortigen Beginn')).toBeVisible();
    await page.getByLabel(/Ich verlange ausdrücklich/).check();
    await page.getByRole('button', { name: 'Zahlungspflichtig bestellen' }).click();

    await expect(page).toHaveURL(/\/dev\/checkout\?session=cs_fake_/);
    await expect(page.getByText(/Betrag: 10,00/)).toBeVisible();
    await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();

    await expect(page).toHaveURL(/\/konto\?checkout=success/);
    await expect(page.getByText('ParkShield Plus')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Aktiv', { exact: true })).toBeVisible();
    const contract = (await page.getByText(/^Vertragsnummer: PS-/).textContent())!.replace(
      'Vertragsnummer: ',
      '',
    );
    // Invoices, cancellation and sign-in settings live on "Abo & Konto".
    await page.getByRole('link', { name: 'Abo und Rechnungen verwalten' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Abo & Konto' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Rechnung DEV-\d{4}-\d+ vom .* \(PDF\)/ }),
    ).toBeVisible();
    await expectAccessible(page);
    const welcome = await waitForMail(request, email, 'contract_confirmation');
    expect(welcome.text).toContain(contract);

    await page.getByRole('main').getByRole('link', { name: 'Verträge hier kündigen' }).click();
    await expect(page.getByText(`Gekündigt wird Ihr Vertrag ${contract}`)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Jetzt kündigen' }).click();
    await expect(
      page.getByRole('heading', { name: 'Ihre Kündigung ist eingegangen' }),
    ).toBeVisible();
    await expect(page.getByText(/Eingegangen am .* um \d{1,2}:\d{2}/)).toBeVisible();
    await waitForMail(request, email, 'cancel_received');

    await page.goto('/konto');
    await expect(page.getByText(/^Gekündigt, endet am/)).toBeVisible();
  });

  test('cancellation without login with e-mail + contract number', async ({
    page,
    request,
    browser,
  }) => {
    const email = uniqueEmail('ohnelogin');
    await signUp(page, request, email);
    await page.getByLabel(/Ich verlange ausdrücklich/).check();
    await page.getByRole('button', { name: 'Zahlungspflichtig bestellen' }).click();
    await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
    await expect(page.getByText(/^Vertragsnummer: PS-/)).toBeVisible({ timeout: 15_000 });
    const contract = (await page.getByText(/^Vertragsnummer: PS-/).textContent())!.replace(
      'Vertragsnummer: ',
      '',
    );

    const anonymous = await (await browser.newContext({ locale: 'de-DE' })).newPage();
    await anonymous.goto('/');
    await anonymous.getByRole('link', { name: 'Verträge hier kündigen' }).click();
    await anonymous.getByLabel('Ihr Name').fill('Jonas Beispiel');
    await anonymous.getByLabel('E-Mail-Adresse Ihres Kontos').fill(email);
    await anonymous.getByLabel('Vertragsnummer').fill(contract);
    await expectAccessible(anonymous);
    await anonymous.getByRole('button', { name: 'Jetzt kündigen' }).click();
    await expect(
      anonymous.getByRole('heading', { name: 'Ihre Kündigung ist eingegangen' }),
    ).toBeVisible();
    const mail = await waitForMail(request, email, 'cancel_received');
    expect(mail.text).toContain(contract);
  });

  test('a used magic link cannot be used again', async ({ page, request, browser }) => {
    const email = uniqueEmail('einmal');
    await signUp(page, request, email);
    const mail = await waitForMail(request, email, 'magic_link');
    const other = await (await browser.newContext({ locale: 'de-DE' })).newPage();
    await other.goto(linkIn(mail));
    await expect(other).toHaveURL(/\/anmelden\/link$/); // token removed from the address bar
    await other.getByRole('button', { name: 'Anmelden' }).click();
    await expect(
      other.getByText('Dieser Link ist abgelaufen oder wurde schon verwendet.'),
    ).toBeVisible();
  });
});
