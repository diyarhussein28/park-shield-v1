import { expect, test } from '@playwright/test';
import { expectAccessible, ownerWithActiveDecal, sql, staffBrowser, uniqueEmail } from './helpers';

test('welcome letter: created by the worker, printed, marked sent; QR download', async ({
  page,
  browser,
  request,
}, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'changes global letter state; desktop only');
  const email = uniqueEmail('letter');
  await ownerWithActiveDecal(page, request, email);
  const [user] = await sql('SELECT id, customer_no FROM users WHERE email = $1', [email]);
  // Paid + first vehicle: the worker creates version 1 on its own.
  await expect
    .poll(
      async () =>
        (
          await sql('SELECT count(*)::int AS n FROM welcome_letters WHERE user_id = $1', [user.id])
        )[0].n,
      {
        timeout: 20_000,
      },
    )
    .toBe(1);

  const admin = await staffBrowser(browser, 'admin', ['admin']);
  await admin.goto(`/kunden/${user.id}`);
  await admin.waitForLoadState('networkidle');
  await expect(admin.getByText(user.customer_no, { exact: true })).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Willkommensbrief', exact: true })).toBeVisible();
  await expect(admin.getByText('Neu', { exact: true }).first()).toBeVisible();
  await expectAccessible(admin);

  const letter = admin.waitForEvent('download');
  await admin.getByRole('link', { name: 'Willkommensbrief herunterladen' }).click();
  expect((await letter).suggestedFilename()).toBe(`${user.customer_no}_Willkommensbrief_v1.pdf`);
  await expect
    .poll(
      async () =>
        (await sql('SELECT status FROM welcome_letters WHERE user_id = $1', [user.id]))[0].status,
    )
    .toBe('downloaded');

  const qr = admin.waitForEvent('download');
  await admin.getByRole('link', { name: 'QR-Code herunterladen' }).click();
  expect((await qr).suggestedFilename()).toBe(`${user.customer_no}_01_QR.svg`);

  await admin.reload();
  await admin.waitForLoadState('networkidle');
  await admin.getByRole('button', { name: 'Als versendet markieren' }).click();
  await expect(admin.getByText('Als versendet markiert.')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await sql('SELECT status FROM welcome_letters WHERE user_id = $1', [user.id]))[0].status,
    )
    .toBe('sent');

  await admin.goto('/willkommensbriefe?status=sent');
  await admin.waitForLoadState('networkidle');
  await expect(admin.getByRole('heading', { level: 1, name: 'Willkommensbriefe' })).toBeVisible();
  await expect(admin.getByText(user.customer_no, { exact: true })).toBeVisible();
  await expectAccessible(admin);

  await admin.goto('/einstellungen/unternehmen');
  await admin.waitForLoadState('networkidle');
  await expect(admin.getByRole('heading', { level: 1, name: 'Unternehmen' })).toBeVisible();
  await expect(admin.getByLabel('USt-IdNr.', { exact: true })).not.toBeEmpty();
  await expectAccessible(admin);
});

test('support sees no letter or QR buttons', async ({ browser }) => {
  const support = await staffBrowser(browser, 'support', ['support']);
  await support.goto('/willkommensbriefe');
  await support.waitForLoadState('networkidle');
  await expect(support.getByText('Dafür fehlt Ihnen die Berechtigung.')).toBeVisible();
  // The menu mirrors permissions: no entry for letters or company data.
  await expect(support.getByRole('link', { name: 'Willkommensbriefe' })).toHaveCount(0);
});
