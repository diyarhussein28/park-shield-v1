import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import { sql } from 'kysely';
import { buildPublicApp } from '../apps';
import { loadEnv, type Env } from '../config/env';
import type { Db } from '../core/core.module';
import { createLogger } from '../core/logger';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import {
  OwnerReminderService,
  REMIND_TOPIC,
  SMS_ESCALATE_TOPIC,
} from '../notifications/owner-reminder.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';

export const UA_WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
export const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export interface Harness {
  app: NestFastifyApplication;
  db: Db;
  valkey: Redis;
  env: Env;
  close(): Promise<void>;
}

/** Public app against parkshield_test + Valkey DB 1, with every provider faked. */
export const PRINT_DIR = join(tmpdir(), `ps-print-${process.pid}`);
export const AUDIT_DIR = join(tmpdir(), `ps-audit-${process.pid}`);
export const TEST_TWILIO_AUTH_TOKEN = 'test-twilio-auth-token';
export const TEST_TWILIO_WEBHOOK_BASE = 'https://hooks.parkshield.test';

// Original values of settings changed by setSetting (undefined = key did not exist).
const touched = new Map<string, unknown>();

async function restoreTouched(h: Harness): Promise<void> {
  for (const [key, original] of touched) {
    if (original === undefined)
      await h.db.deleteFrom('app_settings').where('key', '=', key).execute();
    else
      await h.db
        .insertInto('app_settings')
        .values({ key, value: JSON.stringify(original) })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(original) }))
        .execute();
  }
  touched.clear();
}

/** Sets a runtime setting for one test; the next resetState (or close) restores the original. */
export async function setSetting(h: Harness, key: string, value: unknown): Promise<void> {
  if (!touched.has(key)) {
    const row = await h.db
      .selectFrom('app_settings')
      .select('value')
      .where('key', '=', key)
      .executeTakeFirst();
    touched.set(key, row?.value);
  }
  await h.db
    .insertInto('app_settings')
    .values({ key, value: JSON.stringify(value) })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(value) }))
    .execute();
  h.app.get(SettingsService).invalidate();
}

/** A verified SMS number for the owner, as after the SMS code (NT-07). */
export async function linkSmsDirect(h: Harness, ownerEmail: string, phone = '+4915123456789') {
  const crypto = h.app.get<FieldCrypto>(CRYPTO);
  const owner = await h.db
    .selectFrom('users')
    .select('id')
    .where('email', '=', ownerEmail)
    .executeTakeFirstOrThrow();
  // Replaces the number (subscribe() links one already).
  await h.db
    .deleteFrom('contact_channels')
    .where('user_id', '=', owner.id)
    .where('type', '=', 'sms')
    .execute();
  await h.db
    .insertInto('contact_channels')
    .values({
      user_id: owner.id,
      type: 'sms',
      address_enc: crypto.encrypt(phone),
      address_bidx: crypto.blindIndex(phone),
      priority: 4,
      verified_at: new Date(),
      opted_in_at: new Date(),
    })
    .execute();
}

/** The native app's sign-in: magic link with app=true, the session comes back as a bearer token. */
export async function appSignIn(h: Harness, email: string): Promise<{ authorization: string }> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/app/auth/magic-link',
    payload: { email, locale: 'de' },
  });
  if (res.statusCode !== 202) throw new Error(`app magic link failed: ${res.body}`);
  const mail = (await mailbox(h)).find((m) => m.tag === 'magic_link' && m.to === email)!;
  const consumed = await h.app.inject({
    method: 'POST',
    url: '/v1/app/auth/consume',
    payload: { token: linkToken(mail), platform: 'ios' },
  });
  if (consumed.statusCode !== 200) throw new Error(`app sign-in failed: ${consumed.body}`);
  return { authorization: `Bearer ${consumed.json().token}` };
}

/** Registers an app device for the owner (FCM fake: tokens starting with "invalid" are gone). */
export async function registerAppDevice(
  h: Harness,
  email: string,
  fcmToken = 'fcm-token-phone-0000000001',
): Promise<{ authorization: string }> {
  const app = await appSignIn(h, email);
  const r = await h.app.inject({
    method: 'POST',
    url: '/v1/app/devices/register',
    headers: app,
    payload: { fcmToken, platform: 'ios', appVersion: '1.0.0', locale: 'de' },
  });
  if (r.statusCode !== 200) throw new Error(`device registration failed: ${r.body}`);
  return app;
}

/** Moves the reminder (10 min) and/or SMS (30 min) due time of open alerts into the past. */
export async function escalationDue(
  h: Harness,
  step: 'reminder' | 'sms' | 'both' = 'both',
  alertId?: string,
): Promise<void> {
  const past = sql<Date>`now() - interval '1 second'`;
  const cols = {
    ...(step !== 'sms' ? { remind_at: past } : {}),
    ...(step !== 'reminder' ? { sms_due_at: past } : {}),
  };
  for (const [col, value] of Object.entries(cols)) {
    let q = h.db
      .updateTable('alerts')
      .set({ [col]: value })
      .where(col as 'remind_at', 'is not', null);
    if (alertId) q = q.where('id', '=', alertId);
    await q.execute();
  }
}

/**
 * Runs the escalation like the worker: the sweepers, then every queued reminder / SMS outbox event
 * (marked processed). Returns how many steps the sweepers queued.
 */
export async function runEscalation(h: Harness): Promise<{ reminders: number; sms: number }> {
  const sweeper = h.app.get(OwnerReminderService);
  const dispatch = h.app.get(DispatchService);
  const reminders = await sweeper.sweep();
  const sms = await sweeper.sweepSms();
  const events = await h.db
    .selectFrom('outbox_events')
    .select(['id', 'topic', 'payload'])
    .where('topic', 'in', [REMIND_TOPIC, SMS_ESCALATE_TOPIC])
    .where('processed_at', 'is', null)
    .orderBy('id')
    .execute();
  for (const e of events) {
    const alertId = String((e.payload as { alertId: string }).alertId);
    if (e.topic === REMIND_TOPIC) await dispatch.remind(alertId);
    else await dispatch.escalateSms(alertId);
    await h.db
      .updateTable('outbox_events')
      .set({ processed_at: new Date() })
      .where('id', '=', e.id)
      .execute();
  }
  return { reminders, sms };
}

export interface DevAppPush {
  body: {
    message: {
      token: string;
      notification: { title: string; body: string };
      data: Record<string, string>;
      android: Record<string, unknown>;
      apns: { headers: Record<string, string>; payload: { aps: Record<string, unknown> } };
    };
  };
  messageId: string;
}

/** App pushes the fake FCM sender stored (newest first). */
export async function appPushes(h: Harness): Promise<DevAppPush[]> {
  const res = await h.app.inject({ method: 'GET', url: '/v1/dev/app-push' });
  return (res.json() as { messages: DevAppPush[] }).messages;
}

export interface DevSms {
  to: string;
  body: string;
  tag: string;
  messageId: string;
}

export async function smsInbox(h: Harness): Promise<DevSms[]> {
  const res = await h.app.inject({ method: 'GET', url: '/v1/dev/sms' });
  return (res.json() as { messages: DevSms[] }).messages;
}

export async function createHarness(
  overrides: Partial<Record<keyof Env, string>> = {},
): Promise<Harness> {
  const env = loadEnv({
    STRIPE_SECRET_KEY: '',
    MAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: '',
    FRIENDLY_CAPTCHA_API_KEY: '',
    FRIENDLY_CAPTCHA_SITEKEY: '',
    PRINT_PARTNER: '',
    PRINT_OUTBOX_DIR: PRINT_DIR,
    // Twilio stays a fake sender (no account SID); the token signs test webhooks.
    TWILIO_ACCOUNT_SID: '',
    TWILIO_SMS_FROM: '',
    TWILIO_AUTH_TOKEN: TEST_TWILIO_AUTH_TOKEN,
    TWILIO_WEBHOOK_BASE_URL: TEST_TWILIO_WEBHOOK_BASE,
    // Firebase stays a fake sender: app pushes land in the dev inbox (DEV_APP_PUSH_KEY).
    FCM_PROJECT_ID: '',
    FCM_CLIENT_EMAIL: '',
    FCM_PRIVATE_KEY: '',
    // Chat timeouts are swept by the tests themselves (ChatService.sweep), not by a timer.
    CHAT_SWEEP_MS: '0',
    // Independent of the developer's .env (e.g. a LAN address for phone testing).
    WEB_BASE_URL: 'http://localhost:3000',
    AUDIT_BUCKET: '',
    AUDIT_BUCKET_DIR: AUDIT_DIR,
    ZAMMAD_TOKEN: '',
    ...overrides,
  });
  const app = await buildPublicApp(env, createLogger(env));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const valkey = new Redis(env.VALKEY_URL);
  const h: Harness = {
    app,
    db: app.get<Db>(DB),
    valkey,
    env,
    async close() {
      await restoreTouched(h);
      valkey.disconnect();
      await app.close();
    },
  };
  return h;
}

let settingsSeed: { key: string; value: unknown }[] | null = null;

/**
 * Removes everything tests create. TRUNCATE … CASCADE also reaches app_settings (updated_by → users)
 * and filter_word_lists (created_by → users), so their seeds are put back after every reset.
 */
export async function resetState(h: Harness): Promise<void> {
  await restoreTouched(h);
  settingsSeed ??= await h.db.selectFrom('app_settings').select(['key', 'value']).execute();
  await sql`TRUNCATE users, promo_codes, partners, outbox_events RESTART IDENTITY CASCADE`.execute(
    h.db,
  );
  if (settingsSeed.length) {
    await h.db
      .insertInto('app_settings')
      .values(settingsSeed.map((s) => ({ key: s.key, value: JSON.stringify(s.value) })))
      .onConflict((oc) =>
        oc.column('key').doUpdateSet((eb) => ({ value: eb.ref('excluded.value') })),
      )
      .execute();
  }
  // filter_word_lists.created_by → users, so the cascade empties it too: put the seed version back.
  await h.db
    .insertInto('filter_word_lists')
    .values({ words: JSON.stringify(SEED_WORDS), note: 'Initial lists' })
    .execute();
  await h.valkey.flushdb();
  h.app.get(SettingsService).invalidate();
}

/** Same as the seed in 20261115000000_sprint9_ops_tools.sql. */
const SEED_WORDS = {
  insults: {
    de: [
      'arsch',
      'arschloch',
      'idiot',
      'wichser',
      'fotze',
      'hurensohn',
      'spast',
      'missgeburt',
      'penner',
      'schlampe',
      'vollidiot',
      'depp',
    ],
    en: ['asshole', 'fuck', 'bitch', 'cunt', 'moron', 'retard'],
  },
  threats: {
    de: ['umbringen', 'abstechen', 'kaputtmachen', 'zerkratzen', 'abfackeln'],
    en: ['kill you'],
  },
};

export interface DevMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  tag: string;
}

export async function mailbox(h: Harness): Promise<DevMail[]> {
  const res = await h.app.inject({ method: 'GET', url: '/v1/dev/mailbox' });
  return (res.json() as { mails: DevMail[] }).mails;
}

export async function lastMail(h: Harness, tag: string): Promise<DevMail | undefined> {
  return (await mailbox(h)).find((m) => m.tag === tag);
}

export function linkToken(mail: DevMail): string {
  const m = /#t=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!m) throw new Error(`no token link in mail ${mail.tag}`);
  return m[1]!;
}

export interface Session {
  cookie: string;
  csrf: string;
  headers: Record<string, string>;
}

export function sessionFrom(res: { cookies: { name: string; value: string }[] }): Session {
  const jar = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  const cookie = `ps_session=${jar.ps_session}; ps_csrf=${jar.ps_csrf}`;
  return { cookie, csrf: jar.ps_csrf!, headers: { cookie, 'x-csrf-token': jar.ps_csrf! } };
}

export async function requestLink(h: Harness, email: string, ua = UA_WINDOWS_CHROME) {
  return h.app.inject({
    method: 'POST',
    url: '/v1/auth/magic-link',
    headers: { 'user-agent': ua },
    payload: { email, locale: 'de', captcha: DEV_CAPTCHA_SOLUTION },
  });
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

/** Name and address, required before checkout (PUT /v1/me/profile). */
export async function completeProfile(
  h: Harness,
  s: Session,
  profile: Partial<typeof SAMPLE_PROFILE> = {},
): Promise<void> {
  const res = await h.app.inject({
    method: 'PUT',
    url: '/v1/me/profile',
    headers: s.headers,
    payload: { ...SAMPLE_PROFILE, ...profile },
  });
  if (res.statusCode !== 200) throw new Error(`profile failed: ${res.body}`);
}

/**
 * Signs in, completes the profile, verifies the mobile number (required since 2026-11-21) and buys the
 * single plan through the fake checkout.
 */
export async function subscribe(h: Harness, email: string, promoCode?: string): Promise<Session> {
  const s = await signIn(h, email);
  await completeProfile(h, s);
  await linkSmsDirect(h, email);
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/billing/checkout',
    headers: s.headers,
    payload: {
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
      ...(promoCode ? { promoCode } : {}),
    },
  });
  if (res.statusCode !== 200) throw new Error(`checkout failed: ${res.body}`);
  const sessionId = new URL(res.json().url).searchParams.get('session')!;
  const done = await h.app.inject({
    method: 'POST',
    url: '/v1/dev/payments/complete',
    payload: { sessionId },
  });
  if (done.statusCode !== 200) throw new Error(`payment failed: ${done.body}`);
  return s;
}

/** The e-mail address each session from signIn belongs to (for verifyPhone). */
const sessionEmails = new WeakMap<Session, string>();

/** A verified mobile number for the session's owner (required before checkout since 2026-11-21). */
export async function verifyPhone(h: Harness, s: Session, phone?: string): Promise<void> {
  const email = sessionEmails.get(s);
  if (!email) throw new Error('verifyPhone needs a session from signIn');
  await linkSmsDirect(h, email, phone);
}

export async function signIn(h: Harness, email: string, ua = UA_WINDOWS_CHROME): Promise<Session> {
  await requestLink(h, email, ua);
  const mail = (await mailbox(h)).find((m) => m.tag === 'magic_link' && m.to === email)!;
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/auth/magic-link/consume',
    headers: { 'user-agent': ua },
    payload: { token: linkToken(mail) },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  const session = sessionFrom(res);
  sessionEmails.set(session, email);
  return session;
}
