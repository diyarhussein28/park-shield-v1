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

/** The native app's sign-in (magic link with app=true → bearer token), as the app does it. */
export async function appSession(request: APIRequestContext, email: string) {
  const r = await request.post(`${API_URL}/v1/app/auth/magic-link`, {
    data: { email, locale: 'de' },
  });
  expect(r.status()).toBe(202);
  let token: string | undefined;
  await expect
    .poll(
      async () => {
        const { mails } = (await (await request.get(`${API_URL}/v1/dev/mailbox`)).json()) as {
          mails: Mail[];
        };
        const m = mails.find(
          (x) => x.to === email && x.tag === 'magic_link' && x.text.includes('/app/anmelden#t='),
        );
        token = m ? /\/app\/anmelden#t=([A-Za-z0-9_-]+)/.exec(m.text)?.[1] : undefined;
        return Boolean(token);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const consumed = await request.post(`${API_URL}/v1/app/auth/consume`, {
    data: { token, platform: 'android' },
  });
  expect(consumed.status()).toBe(200);
  const session = ((await consumed.json()) as { token: string }).token;
  return { session, headers: { authorization: `Bearer ${session}` } };
}

/** The alert id from the scanner page's fragment (#a=<id>.<status token>.<chat token>). */
export async function alertIdOf(scan: Page): Promise<string> {
  await expect.poll(() => scan.evaluate(() => location.hash)).toMatch(/^#a=[0-9a-f-]{36}\./);
  return /^#a=([0-9a-f-]{36})\./.exec(await scan.evaluate(() => location.hash))![1]!;
}

/** An owner as the app sees it: bearer headers for the owner API, the verified number, the e-mail. */
export interface Owner {
  email: string;
  session: string;
  headers: { authorization: string };
  phone: string;
}

/** The sign-up sample profile (same person as the fake Stripe billing address). */
export const SAMPLE_PROFILE = {
  firstName: 'Erika',
  lastName: 'Mustermann',
  street: 'Musterstraße 12',
  postalCode: '50667',
  city: 'Köln',
  country: 'DE',
};

/** A unique German mobile number per call (tests run in parallel). */
export const uniqueMobile = () =>
  `+491512${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;

/** The 6-digit code the fake Twilio Verify sent to a number (local SMS inbox). */
export async function smsCodeFor(request: APIRequestContext, e164: string): Promise<string> {
  let code = '';
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API_URL}/v1/dev/sms`);
        const { messages } = (await res.json()) as { messages: { to: string; body: string }[] };
        code = /(\d{6})/.exec(messages.find((m) => m.to === e164)?.body ?? '')?.[1] ?? '';
        return code;
      },
      { timeout: 15_000 },
    )
    .not.toBe('');
  return code;
}

/**
 * Signs up the way the app does since the website lost its portal (2026-11-24): app sign-in, name and
 * address, the required mobile number with its SMS code and, unless `pay` is false, the yearly plan
 * through the fake checkout.
 */
export async function appOwner(
  request: APIRequestContext,
  email: string,
  { pay = true, promoCode }: { pay?: boolean; promoCode?: string } = {},
): Promise<Owner> {
  const app = await appSession(request, email);
  const profile = await request.put(`${API_URL}/v1/me/profile`, {
    headers: app.headers,
    data: SAMPLE_PROFILE,
  });
  expect(profile.status(), await profile.text()).toBe(200);
  const phone = uniqueMobile();
  const start = await request.post(`${API_URL}/v1/channels/phone`, {
    headers: app.headers,
    data: { phone, channels: ['sms'], consent: true },
  });
  expect(start.status(), await start.text()).toBe(200);
  const verify = await request.post(`${API_URL}/v1/channels/phone/verify`, {
    headers: app.headers,
    data: { code: await smsCodeFor(request, phone) },
  });
  expect(verify.status(), await verify.text()).toBe(200);
  const owner = { email, ...app, phone };
  if (pay) await payPlan(request, owner, promoCode);
  return owner;
}

/** The yearly plan through the fake Stripe checkout (what „Testzahlung ausführen“ did). */
export async function payPlan(request: APIRequestContext, owner: Owner, promoCode?: string) {
  const checkout = await request.post(`${API_URL}/v1/billing/checkout`, {
    headers: owner.headers,
    data: {
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
      ...(promoCode ? { promoCode } : {}),
    },
  });
  expect(checkout.status(), await checkout.text()).toBe(200);
  const sessionId = new URL(((await checkout.json()) as { url: string }).url).searchParams.get(
    'session',
  );
  const done = await request.post(`${API_URL}/v1/dev/payments/complete`, { data: { sessionId } });
  expect(done.status(), await done.text()).toBe(200);
  await expect
    .poll(
      async () => {
        const r = await request.get(`${API_URL}/v1/billing/subscription`, {
          headers: owner.headers,
        });
        return ((await r.json()) as { subscription: { status: string } | null }).subscription
          ?.status;
      },
      { timeout: 15_000 },
    )
    .toBe('active');
}

/** Adds the one vehicle („Der Blaue“, K-AB 1234) and returns its id. */
export async function addVehicle(
  request: APIRequestContext,
  owner: Owner,
  vehicle: { nickname?: string; plate?: string } = {},
): Promise<string> {
  const r = await request.post(`${API_URL}/v1/vehicles`, {
    headers: owner.headers,
    data: { nickname: 'Der Blaue', plate: 'K-AB 1234', ...vehicle },
  });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

export interface ActiveOwner extends Owner {
  vehicleId: string;
  /** The decal's scanner URL (`/s/<code>`). */
  url: string;
}

/**
 * Signs up, pays, adds „Der Blaue“ and uses up the decal's test window with a real scan, so the next
 * scans are real alerts.
 */
export async function ownerWithActiveDecal(
  page: Page,
  request: APIRequestContext,
  email: string,
): Promise<ActiveOwner> {
  const owner = await appOwner(request, email);
  const vehicleId = await addVehicle(request, owner);
  const test = await request.post(`${API_URL}/v1/vehicles/${vehicleId}/test-window`, {
    headers: owner.headers,
  });
  expect(test.status(), await test.text()).toBe(200);
  const url = ((await test.json()) as { scanUrl: string }).scanUrl;
  const own = await scannerPage(page.context().browser()!, url);
  await own.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await own.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(own.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  await own.ctx.close();
  return { ...owner, vehicleId, url };
}

export interface AppPush {
  body: {
    message: {
      token: string;
      notification: { title: string; body: string };
      data: Record<string, string>;
    };
  };
  sentAt: string;
}

/**
 * The owner's phone with the app (2026-11-21: alerts reach the owner by app push only): an app session
 * and a registered device with a unique FCM token, whose pushes land in the local inbox
 * (/v1/dev/app-push) while Firebase is faked.
 */
export async function appDevice(request: APIRequestContext, email: string) {
  const app = await appSession(request, email);
  const fcmToken = `e2e-${randomBytes(24).toString('base64url')}`;
  const r = await request.post(`${API_URL}/v1/app/devices/register`, {
    headers: app.headers,
    data: { fcmToken, platform: 'android', locale: 'de' },
  });
  expect(r.status()).toBe(200);
  return { ...app, fcmToken };
}

/** Every push the fake FCM stored for one device token (newest first). */
export async function appPushesTo(request: APIRequestContext, fcmToken: string) {
  const { messages } = (await (await request.get(`${API_URL}/v1/dev/app-push`)).json()) as {
    messages: AppPush[];
  };
  return messages.filter((m) => m.body.message.token === fcmToken);
}

/** Waits for the push of one kind (alert, test, reminder, chat, …) for an alert on one device. */
export async function waitForAppPush(
  request: APIRequestContext,
  fcmToken: string,
  kind: string,
  alertId?: string,
): Promise<AppPush> {
  let found: AppPush | undefined;
  await expect
    .poll(
      async () => {
        found = (await appPushesTo(request, fcmToken)).find(
          (m) =>
            m.body.message.data.kind === kind &&
            (!alertId || m.body.message.data.alertId === alertId),
        );
        return Boolean(found);
      },
      { timeout: 20_000, message: `app push "${kind}"` },
    )
    .toBe(true);
  return found!;
}

/** Alerts never go by e-mail (2026-11-21): no alert mail of any kind reached the owner. */
export async function expectNoAlertMail(request: APIRequestContext, to: string) {
  const { mails } = (await (await request.get(`${API_URL}/v1/dev/mailbox`)).json()) as {
    mails: Mail[];
  };
  expect(
    mails
      .filter((m) => m.to === to && /^(alert|escalation|reminder)/.test(m.tag))
      .map((m) => m.tag),
  ).toEqual([]);
}

/** Makes the reminder push (10 min) or the escalation SMS (30 min) due now; the worker sweeps every 5 s. */
export async function escalationDue(alertId: string, step: 'reminder' | 'sms') {
  await sql(
    step === 'reminder'
      ? `UPDATE alerts SET remind_at = now() - interval '1 second' WHERE id = $1`
      : `UPDATE alerts SET sms_due_at = now() - interval '1 second' WHERE id = $1`,
    [alertId],
  );
}

/** The SMS deliveries of one alert to the owner (status, suppressed reason). */
export const smsDeliveries = (alertId: string) =>
  sql<{ status: string; suppressed_reason: string | null; provider_message_id: string | null }>(
    `SELECT status, suppressed_reason, provider_message_id FROM alert_deliveries
      WHERE alert_id = $1 AND channel = 'sms' ORDER BY queued_at`,
    [alertId],
  );

/** Waits for the one escalation SMS of an alert and returns it from the local SMS inbox. */
export async function waitForEscalationSms(request: APIRequestContext, alertId: string) {
  let sms: { to: string; body: string; tag: string; messageId: string } | undefined;
  await expect
    .poll(
      async () => {
        const sent = (await smsDeliveries(alertId)).find((d) => d.status === 'sent');
        if (!sent?.provider_message_id) return false;
        const { messages } = (await (await request.get(`${API_URL}/v1/dev/sms`)).json()) as {
          messages: { to: string; body: string; tag: string; messageId: string }[];
        };
        sms = messages.find((m) => m.messageId === sent.provider_message_id);
        return Boolean(sms);
      },
      { timeout: 20_000, message: 'escalation SMS' },
    )
    .toBe(true);
  return sms!;
}
