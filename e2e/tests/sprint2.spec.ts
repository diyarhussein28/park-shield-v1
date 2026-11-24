import { expect, test } from '@playwright/test';
import {
  API_URL,
  appOwner,
  expectAccessible,
  payPlan,
  sql,
  uniqueEmail,
  waitForMail,
} from './helpers';

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
    ['/barrierefreiheit', 'Barrierefreiheit', 'Erklärung zur Barrierefreiheit'],
    ['/kuendigen', 'Verträge hier kündigen', 'Verträge hier kündigen'],
    ['/widerrufen', 'Vertrag widerrufen', 'Vertrag widerrufen'],
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

test.describe('site footer (design 2026-11-22)', () => {
  test('2 × 2 groups on phones, one row of four from 768 px, exact § 312k / § 356a labels, no overflow', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const footer = page.locator('footer');
    await expect(footer.getByRole('heading', { level: 2 })).toHaveText([
      'Produkt',
      'Support',
      'Rechtliches',
      'Vertrag',
    ]);
    await expect(
      footer.getByRole('link', { name: 'Verträge hier kündigen', exact: true }),
    ).toHaveAttribute('href', '/kuendigen');
    await expect(
      footer.getByRole('link', { name: 'Vertrag widerrufen', exact: true }),
    ).toHaveAttribute('href', '/widerrufen');
    await expect(footer.getByText('Hosted in Germany', { exact: true })).toBeVisible();
    for (const [width, columns] of [
      [320, 2],
      [375, 2],
      [768, 4],
      [1280, 4],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        columns: getComputedStyle(
          document.querySelector('footer .grid')!,
        ).gridTemplateColumns.split(' ').length,
      }));
      expect(layout, `width ${width}`).toEqual({ overflow: false, columns });
    }
    await expectAccessible(page);
  });
});

test.describe('app first (2026-11-24)', () => {
  test('the website has no sign-in or portal: old links and the call to action lead to /app', async ({
    page,
  }) => {
    for (const path of [
      '/anmelden',
      '/anmelden/link',
      '/konto',
      '/konto/fahrzeuge/123',
      '/konto/abo',
      '/aktivieren',
      '/antwort',
    ]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/app$/);
    }
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ihr ParkShield-Konto ist in der App' }),
    ).toBeVisible();
    // Without store links configured the page says the app is coming.
    await expect(
      page.getByText('Die App erscheint in Kürze im App Store und bei Google Play.'),
    ).toBeVisible();
    // Cancelling and withdrawing stay possible on the website without signing in.
    await expect(
      page.locator('#main').getByRole('link', { name: 'Verträge hier kündigen' }),
    ).toHaveAttribute('href', '/kuendigen');
    await expect(
      page.locator('#main').getByRole('link', { name: 'Vertrag widerrufen' }),
    ).toHaveAttribute('href', '/widerrufen');
    await expectAccessible(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page
      .locator('#main')
      .getByRole('link', { name: /ParkShield für 20 € im Jahr/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/app$/);
  });
});

test.describe('sign-up, annual checkout, cancellation (US-05, US-06, US-07)', () => {
  test('full journey: app sign-up → single plan checkout → active → cancel with receipt', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail('jonas');
    const owner = await appOwner(request, email, { pay: false });

    // Immediate-start request is mandatory before paying (§ 356 Abs. 4 BGB).
    const withoutConsent = await request.post(`${API_URL}/v1/billing/checkout`, {
      headers: owner.headers,
      data: { plan: 'standard', immediateStartVersion: 1, termsVersion: 1 },
    });
    expect(withoutConsent.status()).toBe(400);
    const checkout = await request.post(`${API_URL}/v1/billing/checkout`, {
      headers: owner.headers,
      data: { plan: 'standard', immediateStart: true, immediateStartVersion: 1, termsVersion: 1 },
    });
    expect(checkout.status(), await checkout.text()).toBe(200);
    const sessionId = new URL(((await checkout.json()) as { url: string }).url).searchParams.get(
      'session',
    );
    const session = await request.get(`${API_URL}/v1/dev/payments/sessions/${sessionId}`);
    expect(((await session.json()) as { amountCents: number }).amountCents).toBe(2000);
    await payPlan(request, owner);

    const summary = async () =>
      (
        (await (
          await request.get(`${API_URL}/v1/billing/subscription`, { headers: owner.headers })
        ).json()) as {
          subscription: {
            status: string;
            contractNo: string;
            cancelAtPeriodEnd: boolean;
            withdrawalOpenUntil: string | null;
          };
        }
      ).subscription;
    const sub = await summary();
    expect(sub).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
    expect(sub.contractNo).toMatch(/^PS-/);
    // During the withdrawal period (§ 356a BGB) the app offers „Vertrag widerrufen“ first.
    expect(sub.withdrawalOpenUntil).not.toBeNull();
    const invoices = await request.get(`${API_URL}/v1/billing/invoices`, {
      headers: owner.headers,
    });
    expect(((await invoices.json()) as { invoices: unknown[] }).invoices.length).toBeGreaterThan(0);
    const welcome = await waitForMail(request, email, 'contract_confirmation');
    expect(welcome.text).toContain(sub.contractNo);

    // After the withdrawal period only the cancel part remains.
    await sql(
      `UPDATE subscriptions SET created_at = now() - interval '20 days'
        WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    expect((await summary()).withdrawalOpenUntil).toBeNull();

    // „Verträge hier kündigen“ on the website, without signing in (§ 312k BGB).
    await page.goto('/kuendigen');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Ihr Name').fill('Jonas Beispiel');
    await page.getByLabel('E-Mail-Adresse Ihres Kontos').fill(email);
    await page.getByLabel('Vertragsnummer').fill(sub.contractNo);
    await expectAccessible(page);
    await page.getByRole('button', { name: 'Jetzt kündigen' }).click();
    await expect(
      page.getByRole('heading', { name: 'Ihre Kündigung ist eingegangen' }),
    ).toBeVisible();
    await expect(page.getByText(/Eingegangen am .* um \d{1,2}:\d{2}/)).toBeVisible();
    const mail = await waitForMail(request, email, 'cancel_received');
    expect(mail.text).toContain(sub.contractNo);
    await expect.poll(async () => (await summary()).cancelAtPeriodEnd).toBe(true);
  });

  test('a used sign-in link cannot be used again', async ({ request }) => {
    const email = uniqueEmail('einmal');
    const r = await request.post(`${API_URL}/v1/app/auth/magic-link`, {
      data: { email, locale: 'de' },
    });
    expect(r.status()).toBe(202);
    const mail = await waitForMail(request, email, 'magic_link');
    const token = /\/app\/anmelden#t=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const first = await request.post(`${API_URL}/v1/app/auth/consume`, {
      data: { token, platform: 'android' },
    });
    expect(first.status()).toBe(200);
    const again = await request.post(`${API_URL}/v1/app/auth/consume`, {
      data: { token, platform: 'android' },
    });
    expect(again.status()).toBeGreaterThanOrEqual(400);
  });
});
