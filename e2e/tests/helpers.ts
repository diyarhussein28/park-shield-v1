import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { config } from 'dotenv';
import pg from 'pg';

const envFile = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(envFile)) config({ path: envFile, quiet: true });

let pool: pg.Pool | null = null;

/**
 * Direct SQL against the dev database (stands in for things the UI cannot do yet, or the clock).
 * One small pool per worker: opening a PostgreSQL connection costs ~400 ms on Windows, and many
 * parallel tests opening their own would queue in front of the apps' connections.
 */
// Rows of ad-hoc test queries are untyped on purpose; callers may pass a row type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 60_000,
  });
  return (await pool.query(text, params)).rows as T[];
}

export const API_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export const uniqueEmail = (name: string) =>
  `${name}+${Date.now()}${Math.floor(Math.random() * 1000)}@example.de`;

interface Mail {
  to: string;
  tag: string;
  text: string;
}

/** Waits for a mail in the local dev inbox (fake Brevo). */
export async function waitForMail(
  request: APIRequestContext,
  to: string,
  tag: string,
): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_URL}/v1/dev/mailbox`);
        const { mails } = (await res.json()) as { mails: Mail[] };
        found = mails.find((m) => m.to === to && m.tag === tag);
        return Boolean(found);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

export function linkIn(mail: Mail): string {
  const m = /(https?:\/\/\S+)/.exec(mail.text);
  if (!m) throw new Error(`no link in ${mail.tag}`);
  return m[1]!;
}

/** Waits (up to 3 s) for running entrance animations, so axe judges the settled page, not a fade. */
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
      new Promise((r) => setTimeout(r, 3000)),
    ]),
  );
}

export async function expectAccessible(page: Page) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .exclude('nextjs-portal')
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes.length}: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')})`,
    ),
  ).toEqual([]);
  // Reflow (WCAG 1.4.10): nothing wider than the screen. On a phone the page would zoom out and every
  // tap would land beside its target. scrollWidth also catches text that overflows its box.
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `page is ${scroll}px wide on a ${client}px screen`).toBeLessThanOrEqual(client);
}

export const OPS_URL = process.env.OPS_BASE_URL ?? 'http://localhost:3001';

/**
 * A signed-in staff member in a fresh browser. The passkey ceremony itself is covered in sprint8.spec;
 * here the staff session is created directly, exactly as api-ops would after a passkey sign-in.
 */
export async function staffBrowser(
  browser: Browser,
  name: string,
  roles: string[],
  options: { locale?: string; viewport?: { width: number; height: number } } = {},
): Promise<Page> {
  const email = `${name}-${Date.now()}${Math.floor(Math.random() * 1000)}@parkshield.de`;
  const [u] = await sql(
    `INSERT INTO users (email, kind, display_name, email_verified_at) VALUES ($1, 'staff', $2, now()) RETURNING id`,
    [email, name],
  );
  for (const r of roles)
    await sql('INSERT INTO staff_role_assignments (user_id, role_code) VALUES ($1, $2)', [u.id, r]);
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(18).toString('base64url');
  await sql(
    `INSERT INTO sessions (user_id, token_hash, is_staff, expires_at) VALUES ($1, $2, true, now() + interval '30 minutes')`,
    [u.id, createHash('sha256').update(token).digest()],
  );
  const ctx = await browser.newContext({
    locale: options.locale ?? 'de-DE',
    baseURL: OPS_URL,
    ...(options.viewport ? { viewport: options.viewport } : {}),
  });
  const host = new URL(OPS_URL).hostname;
  await ctx.addCookies([
    {
      name: 'ps_ops_session',
      value: token,
      domain: host,
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
    { name: 'ps_ops_csrf', value: csrf, domain: host, path: '/', sameSite: 'Strict' },
  ]);
  return ctx.newPage();
}

/** A stranger's phone: fresh context, no cookies, German. */
export async function scannerPage(browser: Browser, url: string) {
  const ctx = await browser.newContext({ locale: 'de-DE' });
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

/**
 * Signs up, pays, adds "Der Blaue" and uses up the decal's test window, so the next scans are real
 * alerts. Returns the scan URL.
 */
export async function ownerWithActiveDecal(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<string> {
  await signUp(page, request, email);
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: 'Zahlungspflichtig bestellen' }).click();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page.getByText(/^Vertragsnummer: PS-/)).toBeVisible({ timeout: 15_000 });
  await page.goto('/konto/fahrzeuge');
  await page.getByLabel('Spitzname').fill('Der Blaue');
  await page.getByLabel('Kennzeichen').fill('K-AB 1234');
  await page.getByRole('button', { name: 'Fahrzeug hinzufügen' }).click();
  await page.getByRole('link', { name: /Aufkleber und Details/ }).click();
  await page.getByRole('button', { name: 'Aufkleber testen' }).click();
  const link = page.getByRole('link', { name: 'Scan-Seite auf diesem Gerät öffnen' });
  const url = (await link.getAttribute('href'))!;
  const own = await scannerPage(page.context().browser()!, url);
  await own.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(own.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  await own.ctx.close();
  return url;
}

/** Signs up through the real UI and the e-mailed magic link; ends on /konto. */
export async function signUp(page: Page, request: APIRequestContext, email: string) {
  // Wait for hydration: in `next dev` under a full parallel run, an early click can hit the static HTML.
  await page.goto('/anmelden');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-Mail-Adresse').fill(email);
  await page.getByRole('button', { name: 'Link senden' }).click();
  await expect(page.getByText('Fast geschafft!')).toBeVisible({ timeout: 15_000 });
  const mail = await waitForMail(request, email, 'magic_link');
  await page.goto(linkIn(mail));
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Anmelden' }).click();
  // `next dev` renders /konto in up to ~14 s when several sign-ins land at once (production: well under 1 s).
  await expect(page).toHaveURL(/\/konto$/, { timeout: 30_000 });
  await expect(page.getByText(`Angemeldet als ${email}`)).toBeVisible();
}
