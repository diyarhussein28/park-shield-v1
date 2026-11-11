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
  APP_ENV: z.string().default('local'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_PLUS_YEARLY: z.string().default(''),
  STRIPE_PRICE_PREMIUM_YEARLY: z.string().default(''),
  // E-mail provider: SendGrid (Twilio's e-mail service, default) or Brevo (EU). Empty key: dev inbox.
  MAIL_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['sendgrid', 'brevo']).default('sendgrid'),
  ),
  BREVO_API_KEY: z.string().default(''),
  SENDGRID_API_KEY: z.string().default(''),
  /** eu = api.eu.sendgrid.com (EU data residency, needs an EU subuser); global = api.sendgrid.com. */
  SENDGRID_REGION: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['global', 'eu']).default('global'),
  ),
  MAIL_FROM: z.string().default('ParkShield <hallo@parkshield.de>'),
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
  VAPID_SUBJECT: z.string().default('mailto:hallo@parkshield.de'),
  // WhatsApp provider: Twilio (no monthly fee) or 360dialog (BSP, Berlin). Both use the same four
  // Meta-approved templates (docs/whatsapp-templates.md).
  WHATSAPP_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['twilio', '360dialog']).default('twilio'),
  ),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  /** The WhatsApp sender number in E.164 form, e.g. +4915123456789. */
  TWILIO_WHATSAPP_FROM: z.string().default(''),
  /**
   * SMS sender (NT-07): an alphanumeric sender ID (max. 11 characters, e.g. ParkShield), a Twilio
   * number in E.164 form, or a Messaging Service SID (MG…). Uses the same Twilio account.
   */
  TWILIO_SMS_FROM: z.string().default(''),
  /** Public https origin Twilio calls (status callbacks, button replies); empty: WEB_BASE_URL. */
  TWILIO_WEBHOOK_BASE_URL: z.string().default(''),
  // Content SIDs (HX…) of the approved templates, one per template and language.
  TWILIO_CONTENT_PS_ALERT_DE: z.string().default(''),
  TWILIO_CONTENT_PS_ALERT_EN: z.string().default(''),
  TWILIO_CONTENT_PS_FOLLOWUP_DE: z.string().default(''),
  TWILIO_CONTENT_PS_FOLLOWUP_EN: z.string().default(''),
  TWILIO_CONTENT_PS_TEST_DE: z.string().default(''),
  TWILIO_CONTENT_PS_TEST_EN: z.string().default(''),
  TWILIO_CONTENT_PS_OTP_DE: z.string().default(''),
  TWILIO_CONTENT_PS_OTP_EN: z.string().default(''),
  D360_API_KEY: z.string().default(''),
  D360_BASE_URL: z.url().default('https://waba-v2.360dialog.io'),
  D360_WEBHOOK_SECRET: z.string().default(''),
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
  ZAMMAD_GROUP: z.string().default('Support'),
  // US-45: Better Stack heartbeat (infra/monitoring output worker_heartbeat_url); empty: no heartbeat.
  HEARTBEAT_URL_WORKER: z.string().default(''),
});

/** Providers without keys fall back to local fakes, which are never allowed in production. */
export function fakeProviders(env: Env) {
  return {
    mail: env.MAIL_PROVIDER === 'sendgrid' ? !env.SENDGRID_API_KEY : !env.BREVO_API_KEY,
    captcha: !env.FRIENDLY_CAPTCHA_API_KEY || !env.FRIENDLY_CAPTCHA_SITEKEY,
    payments: !env.STRIPE_SECRET_KEY,
    whatsapp:
      env.WHATSAPP_PROVIDER === 'twilio'
        ? !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM
        : !env.D360_API_KEY,
    sms: !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_SMS_FROM,
    // No real print partner adapter yet: it is built once the partner is chosen in Phase 0.
    print: !env.PRINT_PARTNER,
    auditBucket: !env.AUDIT_BUCKET,
    support: !env.ZAMMAD_TOKEN,
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
  if (realProduction && parsed.data.WHATSAPP_PROVIDER === 'twilio') {
    const missing = Object.entries(parsed.data)
      .filter(([k, v]) => k.startsWith('TWILIO_CONTENT_') && !v)
      .map(([k]) => k);
    if (missing.length) throw new Error(`Missing Twilio template SIDs: ${missing.join(', ')}`);
  }
  if (realProduction && parsed.data.FRIENDLY_CAPTCHA_ENDPOINT !== 'eu') {
    throw new Error('FRIENDLY_CAPTCHA_ENDPOINT must be "eu" in production (data stays in the EU)');
  }
  return parsed.data;
}
