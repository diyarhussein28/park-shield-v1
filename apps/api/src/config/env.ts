import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

const key32 = z
  .string()
  .refine((s) => Buffer.from(s, 'base64').length === 32, 'must be 32 random bytes, base64');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  VALKEY_URL: z.url(),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  OPS_API_HOST: z.string().default('127.0.0.1'),
  OPS_API_PORT: z.coerce.number().int().positive().default(4001),
  SCANNER_BASE_URL: z.url(),
  WEB_BASE_URL: z.url(),
  OPS_BASE_URL: z.url(),
  DATA_KEY_V1: key32,
  BIDX_KEY: key32,
  BLOCK_KEY_CURRENT: key32,
  BLOCK_KEY_PREVIOUS: key32,
  SESSION_SECRET: key32,
  // Long-lived pepper for phone hashes of verified scanners (abuse protection, phone bans). Required in
  // production; locally an empty value falls back to a key derived from BIDX_KEY.
  PHONE_PEPPER: z.union([z.literal(''), key32]).default(''),
  APP_ENV: z.string().default('local'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  // The single plan: 20 € a year incl. VAT, tax behaviour inclusive (price ID, not product ID).
  STRIPE_PRICE_YEARLY: z.string().default(''),
  // Monthly price (annual / 12) only for renewal.mode_b2c = monthly_after_first_term (legal fallback).
  STRIPE_PRICE_MONTHLY: z.string().default(''),
  // RevenueCat (in-app subscriptions, docs/billing-unified.md): secret REST key (v1, sk_…), the
  // webhook Authorization header value and the entitlement id. Empty key: local fake store.
  REVENUECAT_SECRET_KEY: z.string().default(''),
  REVENUECAT_WEBHOOK_AUTH: z.string().default(''),
  REVENUECAT_ENTITLEMENT_ID: z.string().default('parkshield'),
  // E-mail provider: Mailjet (EU, default; tracking switched off per message), Brevo or SendGrid.
  // Empty key: dev inbox. Brevo always rewrites links and adds an open pixel (only Enterprise can opt out).
  MAIL_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['mailjet', 'brevo', 'sendgrid']).default('mailjet'),
  ),
  MAILJET_API_KEY: z.string().default(''),
  MAILJET_SECRET_KEY: z.string().default(''),
  BREVO_API_KEY: z.string().default(''),
  SENDGRID_API_KEY: z.string().default(''),
  /** eu = api.eu.sendgrid.com (EU data residency, needs an EU subuser); global = api.sendgrid.com. */
  SENDGRID_REGION: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['global', 'eu']).default('global'),
  ),
  MAIL_FROM: z.string().default('ParkShield <contact@park-shield.de>'),
  FRIENDLY_CAPTCHA_SITEKEY: z.string().default(''),
  FRIENDLY_CAPTCHA_API_KEY: z.string().default(''),
  // EU keeps scanner data in the EU (privacy policy) but needs the Advanced plan; `global` is for
  // local testing on smaller plans and is refused in production. The web app reads the same variable.
  FRIENDLY_CAPTCHA_ENDPOINT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['eu', 'global']).default('eu'),
  ),
  VAPID_PUBLIC_KEY: z.string().min(20),
  VAPID_PRIVATE_KEY: z.string().min(20),
  VAPID_SUBJECT: z.string().default('mailto:contact@park-shield.de'),
  // Native app push: Firebase Cloud Messaging HTTP v1 (iOS through APNs via FCM). A service account of
  // the Firebase project; the private key may contain literal "\n". Empty: local fake (dev inbox).
  // TODO [LEGAL REVIEW] FCM is a Google service: DPA, transfer basis and the privacy notice.
  FCM_PROJECT_ID: z.string().default(''),
  FCM_CLIENT_EMAIL: z.string().default(''),
  FCM_PRIVATE_KEY: z.string().default(''),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  /**
   * SMS sender (NT-07): an alphanumeric sender ID (max. 11 characters, e.g. ParkShield), a Twilio
   * number in E.164 form, or a Messaging Service SID (MG…). Uses the same Twilio account.
   */
  TWILIO_SMS_FROM: z.string().default(''),
  // Twilio Verify service (VA…) for the optional phone check of scanners in Protected Mode. Empty: the
  // check is faked locally and switched off in production (Protected Mode then hides for everyone).
  TWILIO_VERIFY_SERVICE_SID: z.string().default(''),
  /** Public https origin Twilio calls (SMS status callbacks); empty: WEB_BASE_URL. */
  TWILIO_WEBHOOK_BASE_URL: z.string().default(''),
  /** '' = local fake; 'manual' = print files and job tickets in PRINT_OUTBOX_DIR, shipped by staff. */
  PRINT_PARTNER: z.string().default(''),
  PRINT_OUTBOX_DIR: z.string().default(''),
  // AD-17: Object Lock bucket for the audit stream (empty: local folder .local/audit-bucket).
  AUDIT_BUCKET: z.string().default(''),
  AUDIT_BUCKET_DIR: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('fsn1'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  // AD-20: Zammad (empty token: tickets go to the dev inbox).
  ZAMMAD_URL: z.string().default(''),
  ZAMMAD_TOKEN: z.string().default(''),
  /** Support desk: Zammad, or plain e-mail to SUPPORT_EMAIL (reply-to = the customer). */
  SUPPORT_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['zammad', 'email']).default('zammad'),
  ),
  SUPPORT_EMAIL: z.string().default('support@park-shield.de'),
  /**
   * The only address that gets the payment notifications with the customer's letter attached
   * (2026-11-22). The mailbox must be EU-hosted and have a deletion rule (LEGAL_REVIEW.md §11).
   */
  PAYMENT_NOTIFY_EMAIL: z.email().default('payment@park-shield.de'),
  ZAMMAD_GROUP: z.string().default('Support'),
  // US-45: Better Stack heartbeat (infra/monitoring output worker_heartbeat_url); empty: no heartbeat.
  HEARTBEAT_URL_WORKER: z.string().default(''),
  // Live chat timeouts (inactivity, max. duration): how often the API checks. 0 = never (unit tests
  // call the sweep directly, so it cannot run into a test's database reset).
  CHAT_SWEEP_MS: z.coerce.number().int().min(0).default(10_000),
  // Phase 2: optional photos with alerts. Off by default; part of the single plan when on.
  ALERT_PHOTOS_ENABLED: z
    .enum(['true', 'false', '1', '0', ''])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Encrypted alert photos, outside any web root and never served statically. Excluded from backups
  // (crypto-shredding: deleting the wrapped key in PostgreSQL makes every copy unreadable).
  // Empty: .local/alert-media in development, /var/lib/parkshield/alert-media in production.
  ALERT_MEDIA_DIR: z.string().default(''),
});

/** Providers without keys fall back to local fakes, which are never allowed in production. */
export function fakeProviders(env: Env) {
  return {
    mail:
      env.MAIL_PROVIDER === 'mailjet'
        ? !env.MAILJET_API_KEY || !env.MAILJET_SECRET_KEY
        : env.MAIL_PROVIDER === 'sendgrid'
          ? !env.SENDGRID_API_KEY
          : !env.BREVO_API_KEY,
    captcha: !env.FRIENDLY_CAPTCHA_API_KEY || !env.FRIENDLY_CAPTCHA_SITEKEY,
    payments: !env.STRIPE_SECRET_KEY,
    store: !env.REVENUECAT_SECRET_KEY || !env.REVENUECAT_WEBHOOK_AUTH,
    fcm: !env.FCM_PROJECT_ID || !env.FCM_CLIENT_EMAIL || !env.FCM_PRIVATE_KEY,
    sms: !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_SMS_FROM,
    // No real print partner adapter yet: it is built once the partner is chosen in Phase 0.
    print: !env.PRINT_PARTNER,
    auditBucket: !env.AUDIT_BUCKET,
    support: env.SUPPORT_PROVIDER === 'email' ? !env.SUPPORT_EMAIL : !env.ZAMMAD_TOKEN,
  };
}
export type Env = z.infer<typeof envSchema>;

/**
 * Local dev, unit tests and the CI end-to-end run (a production build with fake providers, APP_ENV=ci):
 * the only places where test helpers (dev mailbox, local push receiver) may exist. Real production
 * never qualifies, and loadEnv refuses fakes there.
 */
export const isTestEnvironment = (env: Pick<Env, 'NODE_ENV' | 'APP_ENV'>) =>
  env.NODE_ENV !== 'production' || env.APP_ENV === 'ci';

function findRepoRoot(start: string): string | undefined {
  let dir = start;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'turbo.json'))) return dir;
    dir = dirname(dir);
  }
  return undefined;
}

export const repoRoot = (): string => findRepoRoot(process.cwd()) ?? process.cwd();

/** Where encrypted alert photos live (ALERT_MEDIA_DIR, see the schema above). */
export const alertMediaDir = (env: Pick<Env, 'ALERT_MEDIA_DIR' | 'NODE_ENV'>): string =>
  env.ALERT_MEDIA_DIR ||
  (env.NODE_ENV === 'production'
    ? '/var/lib/parkshield/alert-media'
    : join(repoRoot(), '.local', 'alert-media'));

/** Loads the repo-root .env in local dev (production injects real environment variables) and validates. */
export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const root = findRepoRoot(process.cwd());
  if (root && existsSync(join(root, '.env'))) config({ path: join(root, '.env'), quiet: true });
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const fakes = Object.entries(fakeProviders(parsed.data)).filter(([, isFake]) => isFake);
  const realProduction = parsed.data.NODE_ENV === 'production' && parsed.data.APP_ENV !== 'ci';
  if (realProduction && fakes.length) {
    throw new Error(`Missing provider keys in production: ${fakes.map(([p]) => p).join(', ')}`);
  }
  if (realProduction && !parsed.data.PHONE_PEPPER) {
    throw new Error('PHONE_PEPPER is required in production (32 random bytes, base64)');
  }
  if (realProduction && parsed.data.FRIENDLY_CAPTCHA_ENDPOINT !== 'eu') {
    throw new Error('FRIENDLY_CAPTCHA_ENDPOINT must be "eu" in production (data stays in the EU)');
  }
  return parsed.data;
}
