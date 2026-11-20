import { expect, test } from '@playwright/test';
import { expectAccessible, sql, staffBrowser, uniqueEmail, waitForMail } from './helpers';

test('admin lists all customers, creates, suspends and deletes an account', async ({
  browser,
  request,
}) => {
  const email = uniqueEmail('ops-created');
  const admin = await staffBrowser(browser, 'admin', ['admin']);
  await admin.goto('/kunden');
  await admin.waitForLoadState('networkidle');
  await expect(admin.getByRole('heading', { name: 'Alle Kunden' })).toBeVisible();
  await expect(admin.getByRole('table', { name: 'Alle Kunden' })).toBeVisible();
  await expectAccessible(admin);

  // Create: the customer gets a sign-in link by e-mail, staff land on the new Customer 360.
  await admin.getByRole('button', { name: 'Kunden anlegen' }).click();
  await admin.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await admin.getByRole('button', { name: 'Konto anlegen und Link senden' }).click();
  await expect(admin.getByRole('heading', { level: 1, name: email })).toBeVisible();
  await waitForMail(request, email, 'magic_link');
  await admin.waitForLoadState('networkidle');
  await expectAccessible(admin);

  // Suspend with a reason.
  await admin.getByLabel('Kontostatus').selectOption('suspended');
  await admin.getByLabel('Begründung (mind. 5 Zeichen)').fill('Test: Konto sperren');
  // Saving reloads the page; wait for it, or the reload wipes the deletion form filled below.
  const reloaded = admin.waitForEvent('load');
  await admin.getByRole('button', { name: 'Änderungen speichern' }).click();
  await reloaded;
  await expect
    .poll(async () => (await sql('SELECT status FROM users WHERE email = $1', [email]))[0]?.status)
    .toBe('suspended');

  // Delete: confirmation required, then the normal erasure with 24 h grace period.
  await admin.waitForLoadState('networkidle');
  const start = admin.getByRole('button', { name: 'Löschung starten' });
  await expect(start).toBeDisabled();
  await admin
    .getByLabel(/Begründung: Wer hat die Löschung/)
    .fill('Kunde hat per E-Mail die Löschung verlangt, Identität über Absender geprüft');
  await admin.getByLabel('Ich habe die Identität geprüft, und die Löschung ist gewünscht.').check();
  await start.click();
  await expect
    .poll(async () => (await sql('SELECT status FROM users WHERE email = $1', [email]))[0]?.status)
    .toBe('pending_deletion');
  await waitForMail(request, email, 'deletion_requested');
});

test('support sees the list but cannot create accounts; the panel switches to English', async ({
  browser,
}) => {
  const support = await staffBrowser(browser, 'support', ['support']);
  await support.goto('/kunden');
  await support.waitForLoadState('networkidle');
  await expect(support.getByRole('heading', { name: 'Alle Kunden' })).toBeVisible();
  await expect(support.getByRole('button', { name: 'Kunden anlegen' })).toHaveCount(0);

  // On phones the sidebar (with the language switch) sits behind the menu button.
  const menu = support.getByRole('button', { name: /^Menü/ });
  if (await menu.isVisible()) await menu.click();
  await support.getByRole('button', { name: 'EN – English' }).first().click();
  await expect(support.getByRole('heading', { name: 'All customers' })).toBeVisible();
  await support.reload();
  await expect(support.getByRole('heading', { name: 'All customers' })).toBeVisible();
  await expect(support.locator('html')).toHaveAttribute('lang', 'en');
});
