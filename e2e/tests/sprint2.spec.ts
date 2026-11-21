import { expect, test } from '@playwright/test';
import { expectAccessible, linkIn, signUp, sql, uniqueEmail, waitForMail } from './helpers';

test.describe('landing and legal pages (US-04)', () => {
  test('shows the single plan (20 € / year incl. VAT, one vehicle), no Plus or Premium, and is accessible', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Ihre Handynummer gehört nicht hinter die Windschutzscheibe.',
    );
    const pricing = page.locator('#preise');
    await expect(pricing.getByRole('heading', { name: 'ParkShield', exact: true })).toBeVisible();
    await expect(pricing.getByText(/^20\s?€\s?\/ Jahr inkl\. 19 % MwSt\.$/)).toBeVisible();
    await expect(pricing.getByText('Für 1 Fahrzeug')).toBeVisible();
    // One plan (owner decision 2026-11-21): no plan comparison, no upgrade, no other prices.
    await expect(pricing.getByRole('heading', { level: 3 })).toHaveCount(1);
    const body = (await page.locator('body').innerText()).replace(/Plus Jakarta Sans/g, '');
    expect(body).not.toMatch(/\bPlus\b|Premium|Business|10 €|15 €/);
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
  test('full journey: magic link → single plan checkout → active → cancel with receipt', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('jonas');
    await signUp(page, request, email);
    await expectAccessible(page);

    // Immediate-start request is mandatory before paying: the button stays off until it is ticked.
    const order = page.getByRole('button', { name: 'Zahlungspflichtig bestellen – 20 € / Jahr' });
    await expect(order).toBeDisabled();
    await expect(page.getByText('Bitte bestätigen Sie den sofortigen Beginn')).toBeVisible();
    await page.getByLabel(/Ich verlange ausdrücklich/).check();
    await order.click();

    await expect(page).toHaveURL(/\/dev\/checkout\?session=cs_fake_/);
    await expect(page.getByText(/Betrag: 20,00/)).toBeVisible();
    await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();

    await expect(page).toHaveURL(/\/konto\?checkout=success/);
    await expect(page.getByText(/^ParkShield · 20\s?€ \/ Jahr$/)).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByText(/Premium|Upgrade/)).toHaveCount(0);
    // One card „Vertrag“: during the withdrawal period (§ 356a BGB) the withdrawal button comes first.
    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: 'Vertrag', exact: true }) });
    await expect(
      card.getByText(/Sie können bis .* ohne Angabe von Gründen widerrufen\./),
    ).toBeVisible();
    await expect(card.getByRole('link', { name: 'Vertrag widerrufen' })).toHaveAttribute(
      'href',
      '/widerrufen',
    );
    await expect(card.getByRole('link', { name: 'Vertrag hier kündigen' })).toBeVisible();
    await expectAccessible(page);
    const welcome = await waitForMail(request, email, 'contract_confirmation');
    expect(welcome.text).toContain(contract);

    // After the withdrawal period only the cancel part remains.
    await sql(
      `UPDATE subscriptions SET created_at = now() - interval '20 days'
        WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    await page.reload();
    await expect(card.getByRole('link', { name: 'Vertrag hier kündigen' })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Vertrag widerrufen' })).toHaveCount(0);
    await expect(card.getByText(/ohne Angabe von Gründen widerrufen/)).toHaveCount(0);

    await card.getByRole('link', { name: 'Vertrag hier kündigen' }).click();
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
    await page.getByRole('button', { name: /Zahlungspflichtig bestellen/ }).click();
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
