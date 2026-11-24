import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  alertIdOf,
  API_URL,
  appDevice,
  expectAccessible,
  ownerWithActiveDecal,
  scannerPage,
  sql,
  uniqueEmail,
  waitForAppPush,
  waitForMail,
  type Owner,
} from './helpers';

const ROOT = join(import.meta.dirname, '..', '..');
const OPS_URL = process.env.OPS_BASE_URL ?? 'http://localhost:3001';

interface HistoryAlert {
  id: string;
  vehicle: { nickname: string };
  type: { code: string; de: string };
  isTest: boolean;
  message: string | null;
  senderBlocked: boolean;
  canBlock: boolean;
}

/** The owner's history as the app loads it (`GET /v1/alerts`). */
async function history(request: APIRequestContext, owner: Owner): Promise<HistoryAlert[]> {
  const r = await request.get(`${API_URL}/v1/alerts`, { headers: owner.headers });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { alerts: HistoryAlert[] }).alerts;
}

test('history shows the alert with its text; „Absender blockieren“ ends the chat, stops the escalation and blocks that scanner (US-31)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const owner = await ownerWithActiveDecal(page, request, uniqueEmail('history'));
  const { ctx, page: scan } = await scannerPage(browser, owner.url);
  await scan.getByRole('button', { name: 'Eigene Nachricht' }).click();
  await scan.getByLabel('Ihre Nachricht').fill('Bitte Auto umparken');
  await scan.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  const alertId = await alertIdOf(scan);

  // The app's history (Warnungen → Verlauf) shows the text, the car and the decal test.
  const before = await history(request, owner);
  const alert = before.find((a) => a.id === alertId)!;
  expect(alert).toMatchObject({
    message: 'Bitte Auto umparken',
    vehicle: { nickname: 'Der Blaue' },
    type: { de: 'Eigene Nachricht' },
    canBlock: true,
    senderBlocked: false,
  });
  expect(before.filter((a) => a.isTest)).toHaveLength(1);

  // „Absender blockieren“ with the reason „Belästigung oder Drohung“.
  const report = await request.post(`${API_URL}/v1/alerts/${alertId}/report`, {
    headers: owner.headers,
    data: { reason: 'harassment' },
  });
  expect(report.status(), await report.text()).toBe(200);
  // The chat is locked at once: the scanner sees it has ended and cannot write any more.
  await expect(scan.getByText('Der Chat wurde beendet.')).toBeVisible({ timeout: 10_000 });
  await expect(scan.getByLabel('Ihre Antwort')).toBeHidden();
  const [state] = await sql<{ chat: string; stop: string; remind: Date | null; sms: Date | null }>(
    `SELECT c.status || '|' || c.close_reason AS chat, a.escalation_stop_reason AS stop,
            a.remind_at AS remind, a.sms_due_at AS sms
       FROM alerts a JOIN chat_sessions c ON c.alert_id = a.id WHERE a.id = $1`,
    [alertId],
  );
  expect(state).toMatchObject({ chat: 'closed|blocked', stop: 'blocked', remind: null, sms: null });
  // The same scanner cannot alert this car again (existing abuse module, no new identifiers).
  await scan.getByRole('button', { name: /Weitere Warnung senden/ }).click();
  await scan.getByRole('button', { name: 'Licht brennt noch' }).click();
  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByRole('alert')).toHaveText(
    'Ihre Nachricht konnte nicht zugestellt werden.',
  );
  await ctx.close();

  const after = (await history(request, owner)).find((a) => a.id === alertId)!;
  expect(after.senderBlocked).toBe(true);
});

test('"Warnung nicht bekommen?" explains the latest attempts (SP-05)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('help');
  const owner = await ownerWithActiveDecal(page, request, email);
  const deliveries = async () => {
    const r = await request.get(`${API_URL}/v1/me/deliveries`, { headers: owner.headers });
    expect(r.status()).toBe(200);
    return (await r.json()) as {
      attempts: { nickname: string; type: { de: string }; channel: string; status: string }[];
      setup: { appDevices: number; sms: boolean };
    };
  };
  // „Keine App mit aktivierten Mitteilungen.“ and „Handynummer bestätigt“.
  expect((await deliveries()).setup).toMatchObject({ appDevices: 0, sms: true });

  const app = await appDevice(request, email);
  const { ctx, page: scan } = await scannerPage(browser, owner.url);
  await scan.getByRole('button', { name: 'Licht brennt noch' }).click();
  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  await waitForAppPush(request, app.fcmToken, 'alert', await alertIdOf(scan));
  await ctx.close();

  const now = await deliveries();
  expect(now.setup.appDevices).toBe(1);
  const real = now.attempts.filter((a) => a.type.de === 'Licht brennt noch');
  expect(real[0]).toMatchObject({ nickname: 'Der Blaue', channel: 'native_push' });
  expect(['sent', 'delivered']).toContain(real[0]!.status);
  expect(now.attempts.filter((a) => a.channel === 'email')).toEqual([]);
});

test('data export as JSON and PDF, after a fresh sign-in (US-32)', async ({ page, request }) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('export');
  const owner = await ownerWithActiveDecal(page, request, email);

  const json = await request.post(`${API_URL}/v1/me/export`, { headers: owner.headers });
  expect(json.status(), await json.text()).toBe(200);
  const data = (await json.json()) as {
    account: { email: string };
    vehicles: { nickname: string; plate: string }[];
  };
  expect(data.account.email).toBe(email);
  expect(data.vehicles[0]).toMatchObject({ nickname: 'Der Blaue', plate: 'K-AB 1234' });

  const pdf = await request.post(`${API_URL}/v1/me/export.pdf`, { headers: owner.headers });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Signed in too long ago: the API asks for a new sign-in first.
  await sql(
    `UPDATE sessions s SET created_at = now() - interval '20 minutes' FROM users u WHERE u.id = s.user_id AND u.email = $1`,
    [email],
  );
  const stale = await request.post(`${API_URL}/v1/me/export`, { headers: owner.headers });
  expect(stale.status()).toBe(401);
  expect(await stale.json()).toMatchObject({ error: 'reauth_required' });
});

test('account deletion stops the decal at once and can be cancelled from the e-mail (US-32)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('delete');
  const owner = await ownerWithActiveDecal(page, request, email);
  const removed = await request.delete(`${API_URL}/v1/me`, {
    headers: owner.headers,
    data: { confirm: true },
  });
  expect(removed.status(), await removed.text()).toBe(200);

  const scan = await browser.newContext({ locale: 'de-DE' });
  const res = await (await scan.newPage()).goto(owner.url);
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
  await expect(p.locator('#main').getByRole('link', { name: 'Zur App' })).toHaveAttribute(
    'href',
    '/app',
  );
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
  await expect(page.getByRole('heading', { level: 1, name: 'Willkommen, Anna' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('list', { name: 'Rollen' })).toHaveText('Superadmin');
  await page.getByText('Einzelne Berechtigungen anzeigen').click();
  await expect(page.getByRole('list', { name: 'Berechtigungen' })).toContainText(
    'Mitarbeitende und Rollen verwalten',
  );
  await expectAccessible(page);

  await page
    .getByRole('navigation', { name: 'Hauptnavigation' })
    .getByRole('link', { name: 'Mitarbeitende' })
    .click();
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
  await expect(page.getByRole('heading', { level: 1, name: 'Willkommen, Anna' })).toBeVisible({
    timeout: 20_000,
  });
  await ctx.close();
});
