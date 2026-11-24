import { expect, test } from '@playwright/test';
import {
  API_URL,
  appOwner,
  expectAccessible,
  ownerWithActiveDecal,
  sql,
  staffBrowser,
  uniqueEmail,
  waitForMail,
} from './helpers';

const unique = () => `${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;

test('withdrawal: finance refunds a fresh subscription, the customer gets the credit note (US-40)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('refund');
  const owner = await ownerWithActiveDecal(page, request, email);
  const url = owner.url;
  const [u] = await sql('SELECT id FROM users WHERE email = $1', [email]);

  const finance = await staffBrowser(browser, 'finanz', ['finance']);
  await finance.goto(`/kunden/${u.id}`);
  await finance.waitForLoadState('networkidle');
  await finance
    .getByRole('link', { name: /^Erstattung/ })
    .first()
    .click();
  await expect(
    finance.getByRole('heading', { level: 1, name: 'Widerruf und Erstattung' }),
  ).toBeVisible();
  await finance.waitForLoadState('networkidle');
  await expect(finance.getByLabel(/^Widerruf/)).toBeChecked();
  await finance.getByRole('button', { name: 'Berechnen' }).click();
  // B4 (2026-11-22): whole days used; a same-day withdrawal of an unprinted decal refunds all 20 €.
  const quote = finance
    .getByRole('definition')
    .filter({ hasText: /^20,00\s€$/ })
    .last();
  await expect(quote).toBeVisible();
  await expect(finance.getByText(/Das Abo endet mit der Erstattung sofort/)).toBeVisible();
  await expectAccessible(finance);
  await finance.getByLabel('Begründung').fill('Widerruf per E-Mail am selben Tag');
  await finance.getByRole('button', { name: /erstatten$/ }).click();
  await expect(
    finance.getByText(/erstattet\. Gutschrift GS-\d{4}-\d{6} ist ausgestellt/),
  ).toBeVisible();
  await expect(finance.getByRole('list', { name: 'Bisherige Erstattungen' })).toContainText(
    'Widerruf',
  );

  const mail = await waitForMail(request, email, 'refund_issued');
  expect(mail.text).toMatch(/20,00\s€/);
  // The contract has ended, so the decal no longer works.
  const scan = await browser.newContext({ locale: 'de-DE' });
  expect((await (await scan.newPage()).goto(url))!.status()).toBe(404);
  await scan.close();

  // „Tarif und Rechnungen“ in the app lists the credit note.
  const notes = await request.get(`${API_URL}/v1/billing/credit-notes`, { headers: owner.headers });
  const { creditNotes } = (await notes.json()) as { creditNotes: { number: string }[] };
  expect(creditNotes.map((n) => n.number)).toEqual([expect.stringMatching(/^GS-\d{4}-\d{6}$/)]);
});

test('promo code from ops is valid at checkout at once (US-40, AD-13)', async ({
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const code = `E2E${unique()}`;
  const finance = await staffBrowser(browser, 'finanz', ['finance']);
  await finance.goto('/gutscheine');
  await finance.waitForLoadState('networkidle');
  await finance.getByLabel('Code').fill(code);
  await finance.getByLabel('Rabatt in %').fill('50');
  await finance.getByLabel(/Preisgarantie in Monaten/).fill('24');
  await finance.getByRole('button', { name: 'Gutschein anlegen' }).click();
  const row = finance
    .getByRole('list', { name: 'Gutscheine' })
    .getByRole('listitem')
    .filter({ hasText: code });
  await expect(row).toContainText('50 % Rabatt');
  await expect(row).toContainText('Preisgarantie 24 Monate');
  await expectAccessible(finance);

  const owner = await appOwner(request, uniqueEmail('promo'), { pay: false });
  const checkout = await request.post(`${API_URL}/v1/billing/checkout`, {
    headers: owner.headers,
    data: {
      plan: 'standard',
      promoCode: code.toLowerCase(),
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
    },
  });
  expect(checkout.status(), await checkout.text()).toBe(200);
  const sessionId = new URL(((await checkout.json()) as { url: string }).url).searchParams.get(
    'session',
  );
  // 50 % off the single plan's 20 €.
  const session = await request.get(`${API_URL}/v1/dev/payments/sessions/${sessionId}`);
  expect(((await session.json()) as { amountCents: number }).amountCents).toBe(1000);
});

test('partner batch: the scanner offers set-up and the owner claims the decal (US-39, AD-07)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const name = `HV Süd ${unique()}`;
  const admin = await staffBrowser(browser, 'admin', ['admin']);
  await admin.goto('/partner');
  await admin.waitForLoadState('networkidle');
  const partnerForm = admin.getByRole('form', { name: 'Neuer Partner' });
  await partnerForm.getByLabel('Name').fill(name);
  await partnerForm.getByRole('button', { name: 'Partner anlegen' }).click();
  await expect(admin.getByRole('list', { name: 'Partner' })).toContainText(name);
  const batchForm = admin.getByRole('form', { name: 'Neue Charge' });
  await batchForm.getByLabel('Partner').selectOption({ label: name });
  await batchForm.getByLabel('Anzahl Aufkleber (höchstens 1000)').fill('2');
  await batchForm.getByRole('button', { name: 'Charge erzeugen' }).click();
  await expect(admin.getByText('Charge mit 2 Codes erzeugt.')).toBeVisible();
  const batch = admin
    .getByRole('list', { name: 'Chargen' })
    .getByRole('listitem')
    .filter({ hasText: name });
  await expect(batch).toContainText('2 Aufkleber · 0 eingerichtet');
  await expectAccessible(admin);

  const [b] = await sql(
    `SELECT b.id FROM token_batches b JOIN partners p ON p.id = b.partner_id WHERE p.name = $1`,
    [name],
  );
  const { codes } = (await (
    await request.get(`${API_URL}/v1/dev/batches/${b.id}/codes`)
  ).json()) as {
    codes: string[];
  };

  const owner = await ownerWithActiveDecal(page, request, uniqueEmail('mieter'));
  // The owner scans the new decal with their phone: the scanner page offers the set-up.
  await page.goto(`/s/${codes[0]}`);
  await expect(
    page.getByRole('heading', { name: 'Dieser Aufkleber ist noch nicht eingerichtet' }),
  ).toBeVisible();
  // „Aufkleber einrichten“ opens the app (2026-11-24); without it the page offers the app link.
  await page.getByRole('link', { name: 'Aufkleber einrichten' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/aktivieren#c=${codes[0]}$`));
  await expect(page.getByRole('link', { name: 'In der App öffnen' })).toHaveAttribute(
    'href',
    `parkshield://aktivieren#c=${codes[0]}`,
  );
  await expectAccessible(page);
  // The app's set-up screen (`/aktivieren`) then calls the owner API's claim.
  const claimed = await request.post(`${API_URL}/v1/vehicles/${owner.vehicleId}/claim`, {
    headers: owner.headers,
    data: { code: codes[0] },
  });
  expect(claimed.status(), await claimed.text()).toBe(200);

  const stranger = await browser.newContext({ locale: 'de-DE' });
  const s = await stranger.newPage();
  await s.goto(`/s/${codes[0]}`);
  await expect(s.getByText('„Der Blaue“')).toBeVisible();
  await stranger.close();

  await admin.reload();
  await expect(batch).toContainText('2 Aufkleber · 1 eingerichtet');
});

test('settings: a switch is versioned with its reason; provider status and orders render (US-39, US-41)', async ({
  browser,
}, info) => {
  // Settings are global state; one project is enough. The switch-off lasts about two seconds; the
  // tests that send SMS (escalation, alert photos) do so at one moment each, so an overlap is unlikely.
  test.skip(info.project.name !== 'desktop-chrome', 'global settings: one project only');
  test.setTimeout(120_000);
  const admin = await staffBrowser(browser, 'admin', ['admin']);
  await admin.goto('/einstellungen');
  await admin.waitForLoadState('networkidle');
  const sms = admin
    .getByRole('list', { name: 'Notschalter für Kanäle' })
    .getByRole('listitem')
    .filter({ hasText: 'SMS' });
  await expect(sms).toContainText('an');
  await sms.getByLabel('Begründung für „SMS“').fill('E2E: Kanal kurz prüfen');
  await sms.getByRole('button', { name: /^Abschalten\s?: SMS$/ }).click();
  await expect(admin.getByText('„SMS“ gespeichert.')).toBeVisible();
  await expect(sms).toContainText('aus');
  await sms.getByLabel('Begründung für „SMS“').fill('E2E: wieder an');
  await sms.getByRole('button', { name: /^Einschalten\s?: SMS$/ }).click();
  await expect(sms).toContainText('an');
  await expectAccessible(admin);
  const [{ n }] = await sql(
    `SELECT count(*)::int AS n FROM audit_logs WHERE action = 'settings.kill_switch'
       AND meta->>'key' = 'channels.sms.enabled' AND meta->>'reason' LIKE 'E2E:%'
       AND created_at > now() - interval '5 minutes'`,
  );
  expect(n).toBeGreaterThanOrEqual(2);

  await admin.getByRole('link', { name: 'Zum Anbieter-Status' }).click();
  await expect(admin.getByRole('heading', { level: 1, name: 'Anbieter-Status' })).toBeVisible();
  await expect(
    admin.getByRole('list', { name: 'Anbieter-Status' }).getByRole('listitem'),
  ).toHaveCount(7); // SMS, app push, e-mail, browser push, Stripe, print, kill switches
  await expectAccessible(admin);

  await admin.goto('/bestellungen?filter=all');
  await expect(admin.getByRole('heading', { level: 1, name: 'Bestellungen' })).toBeVisible();
  await expectAccessible(admin);
});

test('audit log verifies its chain; the Zammad link shows the masked customer (US-42, AD-20)', async ({
  request,
  browser,
}) => {
  test.setTimeout(150_000);
  const email = uniqueEmail('ticket');
  await appOwner(request, email, { pay: false });

  const support = await staffBrowser(browser, 'support', ['support']);
  await support.goto(`/zammad?email=${encodeURIComponent(email)}`);
  await expect(support).toHaveURL(/\/kunden\/zammad\?email=/);
  await expect(support.getByRole('heading', { level: 1, name: 'Kunde zum Ticket' })).toBeVisible();
  await expect(support.getByText(`${email.slice(0, 1)}•••@example.de`)).toBeVisible();
  await expectAccessible(support);
  await support.getByRole('link', { name: 'Customer 360 öffnen' }).click();
  await expect(support.getByRole('heading', { level: 1, name: email })).toBeVisible();

  const admin = await staffBrowser(browser, 'admin', ['superadmin']);
  await admin.goto('/audit?action=customer.summary');
  await admin.waitForLoadState('networkidle');
  await expect(admin.getByRole('list', { name: 'Einträge' })).toContainText('customer.summary');
  await admin.getByRole('button', { name: 'Kette prüfen' }).click();
  await expect(admin.getByText(/Kette intakt: \d+ Dateien, \d+ Einträge\./)).toBeVisible({
    timeout: 30_000,
  });
  await expectAccessible(admin);
});

test('help centre: search, article, contact form opens a ticket (US-44, SP-01)', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.goto('/hilfe');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Hilfe' })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Hilfe durchsuchen').fill('iPhone');
  await page.getByRole('link', { name: 'Mitteilungen auf dem iPhone' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mitteilungen auf dem iPhone' }),
  ).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Kontaktformular' }).click();
  await page.waitForLoadState('networkidle');
  const email = uniqueEmail('frage');
  await page.getByLabel('Ihre E-Mail-Adresse').fill(email);
  await page.getByLabel('Worum geht es?').selectOption({ label: 'Aufkleber und Versand' });
  await page.getByLabel('Ihre Nachricht').fill('Bekomme ich den Aufkleber auch in Schwarz?');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(page.getByText(/Ihre Ticketnummer: DEV-/)).toBeVisible();
  const { tickets } = (await (await request.get(`${API_URL}/v1/dev/zammad/tickets`)).json()) as {
    tickets: { email: string; tags: string[] }[];
  };
  expect(tickets.find((x) => x.email === email)?.tags).toEqual(['topic_decal', 'lang_de']);
});
