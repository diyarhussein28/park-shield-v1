import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  expectAccessible,
  ownerWithActiveDecal,
  scannerPage,
  sql,
  uniqueEmail,
  waitForMail,
} from './helpers';

const ROOT = join(import.meta.dirname, '..', '..');
const OPS_URL = process.env.OPS_BASE_URL ?? 'http://localhost:3001';

test('history shows the alert with its text; reporting blocks that scanner (US-31)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const url = await ownerWithActiveDecal(page, request, uniqueEmail('history'));
  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Eigene Nachricht' }).click();
  await scan.getByLabel('Ihre Nachricht').fill('Bitte Auto umparken');
  await scan.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  await ctx.close();

  await page.goto('/konto');
  await page.getByRole('link', { name: 'Verlauf ansehen' }).click();
  const list = page.getByRole('list', { name: 'Verlauf' });
  const card = list.getByRole('listitem').filter({ hasText: 'Bitte Auto umparken' });
  await expect(card).toContainText('Eigene Nachricht · „Der Blaue“');
  await expect(list.getByRole('listitem').filter({ hasText: 'Test' })).toHaveCount(1); // the decal test
  await expectAccessible(page);

  await card.getByRole('button', { name: 'Missbrauch melden' }).click();
  await card.getByLabel('Was war los?').selectOption({ label: 'Belästigung oder Drohung' });
  await card.getByRole('button', { name: 'Melden', exact: true }).click();
  await expect(
    card.getByText(
      'Gemeldet. Diese Person kann „Der Blaue“ 30 Tage lang nicht mehr benachrichtigen.',
    ),
  ).toBeVisible();
  await page.reload();
  await expect(card.getByText('Gemeldet', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Missbrauch melden' })).toHaveCount(0);
});

test('"Warnung nicht bekommen?" explains the latest attempts (SP-05)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const url = await ownerWithActiveDecal(page, request, uniqueEmail('help'));
  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(scan.getByText('Die Warnung ist beim Fahrer angekommen.')).toBeVisible({
    timeout: 15_000,
  });
  await ctx.close();

  await page.goto('/konto/zustellung');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Warnung nicht bekommen?' }),
  ).toBeVisible();
  await expect(page.getByText(/Kein Gerät mit Push/)).toBeVisible();
  const attempts = page.getByRole('list', { name: 'Letzte Zustellversuche' });
  await expect(attempts.getByRole('listitem').first()).toContainText(
    'Licht brennt noch bei „Der Blaue“ · E-Mail',
  );
  await expect(attempts.getByRole('listitem').first()).toContainText('Gesendet');
  await expectAccessible(page);
});

test('data export as JSON and PDF, after a fresh sign-in (US-32)', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('export');
  await ownerWithActiveDecal(page, request, email);
  await page.goto('/konto');
  await page.getByRole('link', { name: 'Daten herunterladen oder Konto löschen' }).click();
  await expectAccessible(page);

  const json = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON herunterladen' }).click();
  const file = await (await json).path();
  const data = JSON.parse(readFileSync(file, 'utf8'));
  expect(data.account.email).toBe(email);
  expect(data.vehicles[0]).toMatchObject({ nickname: 'Der Blaue', plate: 'K-AB 1234' });

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  expect(
    readFileSync(await (await pdf).path())
      .subarray(0, 5)
      .toString(),
  ).toBe('%PDF-');

  // Signed in too long ago: the page asks for a new sign-in first.
  await sql(
    `UPDATE sessions s SET created_at = now() - interval '20 minutes' FROM users u WHERE u.id = s.user_id AND u.email = $1`,
    [email],
  );
  await page.getByRole('button', { name: 'JSON herunterladen' }).click();
  await expect(page.getByText(/Bitte melden Sie sich zur Sicherheit neu an/)).toBeVisible();
  await page.getByRole('button', { name: 'Neu anmelden' }).click();
  await expect(page).toHaveURL(/\/anmelden$/);
});

test('account deletion stops the decal at once and can be cancelled from the e-mail (US-32)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('delete');
  const url = await ownerWithActiveDecal(page, request, email);
  await page.goto('/konto/daten');
  const remove = page.getByRole('button', { name: 'Konto löschen' });
  await expect(remove).toBeDisabled();
  await page.getByLabel('Ich möchte mein Konto und alle Daten löschen.').check();
  await remove.click();
  await expect(page.getByText(/Ihr Konto wird am .* gelöscht/)).toBeVisible();

  const scan = await browser.newContext({ locale: 'de-DE' });
  const res = await (await scan.newPage()).goto(url);
  expect(res!.status()).toBe(404);
  await scan.close();

  const mail = await waitForMail(request, email, 'deletion_requested');
  const link = /(https?:\/\/\S+\/konto-loeschen-abbrechen#t=[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  const other = await browser.newContext({ locale: 'de-DE' });
  const p = await other.newPage();
  await p.goto(link);
  await expectAccessible(p);
  await p.getByRole('button', { name: 'Konto behalten' }).click();
  await expect(p.getByText(/Ihr Konto bleibt bestehen/)).toBeVisible();
  await other.close();
  const [u] = await sql('SELECT status FROM users WHERE email = $1', [email]);
  expect(u.status).toBe('active');
});

/** A platform passkey with user verification, as on a laptop with Windows Hello or Touch ID. */
async function virtualAuthenticator(ctx: BrowserContext, page: Page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test('ops: invitation, passkey set-up, permissions and sign-in again (US-34)', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one virtual authenticator run is enough');
  test.setTimeout(120_000);
  const email = `ops-${Date.now()}@parkshield.de`;
  const out = execFileSync(
    process.execPath,
    [
      join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      'scripts/ops-invite.ts',
      '--email',
      email,
      '--name',
      'Anna Admin',
      '--role',
      'superadmin',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const link = /(http\S+\/einladung#t=[A-Za-z0-9_-]+)/.exec(out)![1]!;

  const ctx = await browser.newContext({ locale: 'de-DE' });
  const page = await ctx.newPage();
  await virtualAuthenticator(ctx, page);
  await page.goto(link);
  await expect(page.getByText(`Zugang für ${email}`)).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Passkey einrichten' }).click();
  await expect(page).toHaveURL(`${OPS_URL}/`, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Anna Admin' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('list', { name: 'Rollen' })).toHaveText('superadmin');
  await expect(page.getByRole('list', { name: 'Berechtigungen' })).toContainText('staff.manage');
  await expectAccessible(page);

  await page.getByRole('link', { name: 'Mitarbeitende' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mitarbeitende' })).toBeVisible();
  const me = page
    .getByRole('list', { name: 'Mitarbeitende' })
    .getByRole('listitem')
    .filter({ hasText: email });
  await expect(me.getByText('Passkey eingerichtet')).toBeVisible();
  await expectAccessible(page);

  // The session cookie is host-only and Strict, and the staff session is 30 min idle.
  const cookie = (await ctx.cookies()).find((c) => c.name === 'ps_ops_session')!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  const [s] = await sql(
    `SELECT expires_at - now() AS left FROM sessions WHERE is_staff ORDER BY created_at DESC LIMIT 1`,
  );
  expect(s.left.minutes ?? 0).toBeGreaterThanOrEqual(29);

  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/anmelden$/);
  await page.waitForLoadState('networkidle'); // a click before hydration does nothing
  await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
  // Ceremony plus a full page load: slower than the default 5 s while the whole suite runs in parallel.
  await expect(page.getByRole('heading', { level: 1, name: 'Anna Admin' })).toBeVisible({
    timeout: 20_000,
  });
  await ctx.close();
});
