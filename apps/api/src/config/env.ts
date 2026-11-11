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
  BREVO_API_KEY: z.string().default(''),
  MAIL_FROM: z.string().default('ParkShield <hallo@parkshield.de>'),
  FRIENDLY_CAPTCHA_SITEKEY: z.string().default(''),
  FRIENDLY_CAPTCHA_API_KEY: z.string().default(''),
  VAPID_PUBLIC_KEY: z.string().min(20),
  VAPID_PRIVATE_KEY: z.string().min(20),
  VAPID_SUBJECT: z.string().default('mailto:hallo@parkshield.de'),
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
    mail: !env.BREVO_API_KEY,
    captcha: !env.FRIENDLY_CAPTCHA_API_KEY || !env.FRIENDLY_CAPTCHA_SITEKEY,
    payments: !env.STRIPE_SECRET_KEY,
    whatsapp: !env.D360_API_KEY,
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
  if (parsed.data.NODE_ENV === 'production' && parsed.data.APP_ENV !== 'ci' && fakes.length) {
    throw new Error(`Missing provider keys in production: ${fakes.map(([p]) => p).join(', ')}`);
  }
  return parsed.data;
}
