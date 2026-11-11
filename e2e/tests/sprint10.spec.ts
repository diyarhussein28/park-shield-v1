import { expect, test } from '@playwright/test';
import {
  API_URL,
  expectAccessible,
  ownerWithActiveDecal,
  signUp,
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
  const url = await ownerWithActiveDecal(page, request, email);
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
  const quote = finance.getByRole('definition').filter({ hasText: /9,97/ });
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
  expect(mail.text).toMatch(/9,97\s€/);
  // The contract has ended, so the decal no longer works.
  const scan = await browser.newContext({ locale: 'de-DE' });
  expect((await (await scan.newPage()).goto(url))!.status()).toBe(404);
  await scan.close();

  await page.goto('/konto');
  await expect(page.getByRole('list', { name: 'Gutschriften' }).getByRole('link')).toContainText(
    /Gutschrift GS-/,
  );
  await expectAccessible(page);
});

test('promo code from ops is valid at checkout at once (US-40, AD-13)', async ({
  page,
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

  await signUp(page, request, uniqueEmail('promo'));
  await page.getByLabel(/Gutscheincode/).fill(code.toLowerCase());
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: 'Zahlungspflichtig bestellen' }).click();
  await expect(page.getByText(/Betrag: 5,00/)).toBeVisible();
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

  await ownerWithActiveDecal(page, request, uniqueEmail('mieter'));
  // The owner scans the new decal with their own phone (here: the same signed-in browser).
  await page.goto(`/s/${codes[0]}`);
  await expect(
    page.getByRole('heading', { name: 'Dieser Aufkleber ist noch nicht eingerichtet' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Aufkleber einrichten' }).click();
  await expect(page.getByText(`Diesen Aufkleber hat ${name} ausgegeben.`)).toBeVisible();
  await expect(page.getByLabel('An welchem Fahrzeug klebt der Aufkleber?')).toHaveValue(/.+/);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Aufkleber einrichten' }).click();
  await expect(page.getByText(/Fertig! Testen Sie den Aufkleber jetzt einmal/)).toBeVisible();

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
  // Settings are global state; one project is enough. SMS is unused, so switching it disturbs nobody.
  test.skip(info.project.name !== 'desktop-chrome', 'global settings: one project only');
  test.setTimeout(120_000);
  const admin = await staffBrowser(browser, 'admin', ['admin']);
  await admin.goto('/einstellungen');
  await admin.waitForLoadState('networkidle');
  const sms = admin
    .getByRole('list', { name: 'Kill Switches' })
    .getByRole('listitem')
    .filter({ hasText: 'SMS' });
  await expect(sms).toContainText('aus');
  await sms.getByLabel('Begründung für „SMS“').fill('E2E: Kanal kurz prüfen');
  await sms.getByRole('button', { name: /^Einschalten\s?: SMS$/ }).click();
  await expect(admin.getByText('„SMS“ gespeichert.')).toBeVisible();
  await expect(sms).toContainText('an');
  await sms.getByLabel('Begründung für „SMS“').fill('E2E: wieder aus');
  await sms.getByRole('button', { name: /^Abschalten\s?: SMS$/ }).click();
  await expect(sms).toContainText('aus');
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
  ).toHaveCount(8);
  await expectAccessible(admin);

  await admin.goto('/bestellungen?filter=all');
  await expect(admin.getByRole('heading', { level: 1, name: 'Bestellungen' })).toBeVisible();
  await expectAccessible(admin);
});

test('audit log verifies its chain; the Zammad link shows the masked customer (US-42, AD-20)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(150_000);
  const email = uniqueEmail('ticket');
  await signUp(page, request, email);

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
  await page.getByRole('link', { name: 'Push-Benachrichtigungen auf dem iPhone' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Push-Benachrichtigungen auf dem iPhone' }),
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
