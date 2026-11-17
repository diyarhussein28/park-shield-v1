import { createECDH, randomBytes } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOpsApp } from '../apps';
import { loadEnv } from '../config/env';
import type { FieldCrypto } from '../core/crypto';
import { createLogger } from '../core/logger';
import { CRYPTO, VALKEY } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import { PUSH, type PushSender } from '../providers/ports';
import { StaffService } from '../ops/staff.service';
import {
  createHarness,
  mailbox,
  resetState,
  setSetting,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';

let h: Harness;
let crypto: FieldCrypto;
let ops: NestFastifyApplication;

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  const env = loadEnv({
    MAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    D360_API_KEY: '',
    TWILIO_ACCOUNT_SID: '',
    PRINT_PARTNER: '',
  });
  ops = await buildOpsApp(env, createLogger(env));
  await ops.init();
  await ops.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await ops.close();
  await h.close();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetState(h);
});

const SECRET_TEXT = 'Ich stehe direkt neben Ihrem Auto, Hausnummer 12';

async function owner(email = 'owner@example.de', nickname = 'Der Blaue') {
  const s = await subscribe(h, email);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname, plate: 'K-AB 1234' },
    })
  ).json() as { id: string; decal: { tokenId: string } };
  const t = await h.db
    .selectFrom('qr_tokens')
    .select('code_enc')
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  return { s, v, code: crypto.decrypt(t.code_enc) };
}

function send(
  code: string,
  body: Record<string, unknown> = {},
  ip = '198.51.100.7',
  ua = 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile',
) {
  return h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: ip,
    headers: { 'user-agent': ua },
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'lights_on', ...body },
  });
}

const block = (s: Session, alertId: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/alerts/${alertId}/report`,
    headers: s.headers,
    payload: { reason: 'harassment' },
  });

const setProtection = (s: Session, vehicleId: string, active: boolean) =>
  h.app.inject({
    method: 'PUT',
    url: `/v1/vehicles/${vehicleId}/protection`,
    headers: s.headers,
    payload: { active },
  });

const smsInbox = async () =>
  (await h.app.inject({ method: 'GET', url: '/v1/dev/sms' })).json().messages as {
    to: string;
    body: string;
    tag: string;
  }[];

const verifyStart = (code: string, phone: string, ip = '198.51.100.7') =>
  h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/verify/start`,
    remoteAddress: ip,
    payload: { phone, lang: 'de', captcha: DEV_CAPTCHA_SOLUTION },
  });

/** Runs the whole phone check and returns the in-memory verification token. */
async function verified(code: string, phone = '0151 11122233', ip = '198.51.100.7') {
  const start = await verifyStart(code, phone, ip);
  expect(start.statusCode, start.body).toBe(202);
  const sms = (await smsInbox()).find((m) => m.tag === 'sms_verify')!;
  const otp = /(\d{6})/.exec(sms.body)![1]!;
  const check = await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/verify/check`,
    remoteAddress: ip,
    payload: { phone, code: otp },
  });
  expect(check.statusCode, check.body).toBe(200);
  return check.json().verification as string;
}

describe('rate limits (abuse protection §2)', () => {
  it('per scanner and vehicle: 2 per hour and 3 per day, with Retry-After', async () => {
    const { code } = await owner();
    await setSetting(h, 'ratelimit.alert.scanner_vehicle', { max: 10, windowSeconds: 3600 });
    for (let i = 0; i < 3; i++) expect((await send(code)).statusCode).toBe(201);
    const fourth = await send(code);
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json()).toMatchObject({ limit: 'alert.scanner_vehicle_day' });
    expect(Number(fourth.headers['retry-after'])).toBeGreaterThan(86_000);
  });

  it('per vehicle from everyone answers with the vehicle message', async () => {
    const { code } = await owner();
    await setSetting(h, 'ratelimit.alert.vehicle', { max: 1, windowSeconds: 86_400 });
    expect((await send(code, {}, '198.51.100.1')).statusCode).toBe(201);
    const second = await send(code, {}, '203.0.113.1');
    expect(second.statusCode).toBe(429);
    expect(second.json().message).toBe(
      'Der Fahrzeughalter wurde bereits mehrfach benachrichtigt. Bitte versuchen Sie es später erneut.',
    );
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('a failed captcha is refused before anything is counted', async () => {
    const { code } = await owner();
    const bad = await send(code, { captcha: 'wrong' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('captcha_failed');
    expect(await h.valkey.keys('rls:*')).toHaveLength(0);
  });

  it('fails open with in-process counters while Valkey does not answer', async () => {
    const { code } = await owner();
    const valkey = h.app.get<Redis>(VALKEY);
    // Valkey hangs: every command (rate limit script, daily salt) never answers.
    vi.spyOn(valkey, 'eval').mockImplementation(() => new Promise(() => {}) as never);
    vi.spyOn(valkey, 'set').mockImplementation(() => new Promise(() => {}) as never);
    const ip = '192.0.2.44';
    expect((await send(code, {}, ip)).statusCode).toBe(201);
    expect((await send(code, {}, ip)).statusCode).toBe(201);
    // The fallback still applies the limits (2 per hour per scanner and vehicle).
    const third = await send(code, {}, ip);
    expect(third.statusCode).toBe(429);
    expect(third.json().limit).toBe('alert.scanner_vehicle');
    expect(await h.db.selectFrom('alerts').selectAll().execute()).toHaveLength(2);
  });
});

describe('blocking a sender (abuse protection §3)', () => {
  it('a blocked sender gets the neutral 403; when the block expires they get through again', async () => {
    const { s, code } = await owner();
    const a = (await send(code)).json();
    expect((await block(s, a.alertId)).json()).toMatchObject({ blocked: true });
    const again = await send(code);
    expect(again.statusCode).toBe(403);
    expect(again.json()).toEqual({
      error: 'not_deliverable',
      message: 'Ihre Nachricht konnte nicht zugestellt werden.',
    });
    expect(JSON.stringify(again.json())).not.toMatch(/Blau|block|sperr/i);
    await sql`UPDATE scanner_blocks SET expires_at = now() - interval '1 second'`.execute(h.db);
    expect((await send(code)).statusCode).toBe(201);
    await sql`SELECT run_retention()`.execute(h.db);
    expect(await h.db.selectFrom('scanner_blocks').selectAll().execute()).toHaveLength(0);
  });

  it('the owner never sees a scanner identifier', async () => {
    const { s, code } = await owner();
    await send(code);
    const res = await h.app.inject({ method: 'GET', url: '/v1/alerts', headers: s.headers });
    expect(res.body).not.toMatch(/scanner_ref|block_ref|scannerRef|phone_hash|phoneHash/);
  });
});

describe('Protected Mode (abuse protection §4)', () => {
  it('switches on automatically after 2 blocks within 30 days, for 30 days', async () => {
    const { s, v, code } = await owner();
    const a = (await send(code, {}, '198.51.100.1')).json();
    const b = (await send(code, {}, '203.0.113.2')).json();
    expect((await block(s, a.alertId)).json().protectedMode).toBe(false);
    expect((await block(s, b.alertId)).json().protectedMode).toBe(true);
    const status = (
      await h.app.inject({
        method: 'GET',
        url: `/v1/vehicles/${v.id}/protection`,
        headers: s.headers,
      })
    ).json();
    expect(status).toMatchObject({ active: true, source: 'auto' });
    const days = (new Date(status.activeUntil).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('two blocks more than 30 days apart do not switch it on', async () => {
    const { s, code } = await owner();
    const a = (await send(code, {}, '198.51.100.1')).json();
    await block(s, a.alertId);
    await sql`UPDATE abuse_reports SET created_at = now() - interval '31 days'`.execute(h.db);
    const b = (await send(code, {}, '203.0.113.2')).json();
    expect((await block(s, b.alertId)).json().protectedMode).toBe(false);
  });

  it('the owner switches it on and off; other owners cannot', async () => {
    const { s, v } = await owner();
    const other = await owner('other@example.de', 'Rot');
    expect((await setProtection(other.s, v.id, true)).statusCode).toBe(404);
    expect((await setProtection(s, v.id, true)).json()).toEqual({
      active: true,
      source: 'manual',
      activeUntil: null,
    });
    expect((await setProtection(s, v.id, false)).json()).toMatchObject({ active: false });
  });

  it('unconfirmed content never reaches any notification channel; the type goes out at once', async () => {
    const { s, v, code } = await owner();
    await setProtection(s, v.id, true);
    // Every channel: push device, SMS number, WhatsApp is template-only, e-mail.
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const sub = await h.app.inject({
      method: 'POST',
      url: '/v1/push-subscriptions',
      headers: s.headers,
      payload: {
        endpoint: 'http://127.0.0.1:9/ok/1',
        keys: {
          p256dh: ecdh.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
      },
    });
    expect(sub.statusCode).toBeLessThan(300);
    await h.db
      .insertInto('contact_channels')
      .values({
        user_id: (await h.db.selectFrom('users').select('id').executeTakeFirstOrThrow()).id,
        type: 'sms',
        address_enc: crypto.encrypt('+4915199988877'),
        address_bidx: crypto.blindIndex('+4915199988877'),
        is_enabled: true,
        verified_at: new Date(),
        opted_in_at: new Date(),
      } as never)
      .execute();
    const push = h.app.get<PushSender>(PUSH);
    const pushed: string[] = [];
    vi.spyOn(push, 'send').mockImplementation(async (_t, payload) => {
      pushed.push(payload);
      return { statusCode: 201 };
    });

    const res = await send(code, { type: 'custom', message: SECRET_TEXT });
    expect(res.statusCode).toBe(201);
    const row = await h.db
      .selectFrom('alerts')
      .select(['content_hidden', 'verified_phone_hash', 'custom_message_enc'])
      .executeTakeFirstOrThrow();
    expect(row.content_hidden).toBe(true);
    expect(row.verified_phone_hash).toBeNull();
    expect(row.custom_message_enc).not.toBeNull(); // stored, only hidden

    // Urgent, so the dispatcher uses every channel at once.
    await sql`UPDATE alerts SET severity = 'urgent'`.execute(h.db);
    await h.app.get(DispatchService).dispatch(res.json().alertId);

    const mails = (await mailbox(h)).filter((m) => m.tag === 'alert_received');
    const sms = (await smsInbox()).filter((m) => m.tag === 'sms_alert');
    const whatsapp = (await h.app.inject({ method: 'GET', url: '/v1/dev/whatsapp' })).json()
      .messages as unknown[];
    expect(mails).toHaveLength(1);
    expect(sms).toHaveLength(1);
    expect(pushed).toHaveLength(1);
    const everything = JSON.stringify([mails, sms, pushed, whatsapp]);
    expect(everything).not.toContain('Hausnummer 12');
    expect(mails[0]!.text).toContain(
      'Nachricht von nicht bestätigtem Absender – ansehen in ParkShield',
    );
    expect(sms[0]!.body).toContain('nicht bestaetigtem Absender');
    expect(pushed[0]).toContain('nicht bestätigtem Absender');

    // Portal: hidden behind "Anzeigen", which returns the text on request.
    const list = (
      await h.app.inject({ method: 'GET', url: '/v1/alerts', headers: s.headers })
    ).json();
    expect(list.alerts[0]).toMatchObject({ message: null, hiddenContent: true });
    const shown = await h.app.inject({
      method: 'GET',
      url: `/v1/alerts/${res.json().alertId}/hidden-content`,
      headers: s.headers,
    });
    expect(shown.json()).toEqual({ message: SECRET_TEXT });
  });

  it('confirmed senders are shown normally; the page offers the check only in Protected Mode', async () => {
    const { s, v, code } = await owner();
    const page = () =>
      h.app.inject({ method: 'GET', url: `/v1/scan/${code}` }).then((r) => r.json());
    expect((await page()).offerVerification).toBe(false);
    expect((await verifyStart(code, '0151 11122233')).json().error).toBe('not_needed');
    await setProtection(s, v.id, true);
    expect((await page()).offerVerification).toBe(true);

    const token = await verified(code);
    const res = await send(code, { type: 'custom', message: SECRET_TEXT, verification: token });
    expect(res.statusCode).toBe(201);
    const row = await h.db
      .selectFrom('alerts')
      .select(['content_hidden', 'verified_phone_hash'])
      .executeTakeFirstOrThrow();
    expect(row.content_hidden).toBe(false);
    expect(row.verified_phone_hash).toHaveLength(32);
    // Only the HMAC is stored, never the number.
    const dump = JSON.stringify(await sql`SELECT * FROM alerts`.execute(h.db));
    expect(dump).not.toMatch(/15111122233|0151/);
    await h.app.get(DispatchService).dispatch(res.json().alertId);
    expect((await mailbox(h)).find((m) => m.tag === 'alert_received')!.text).toContain(
      'Hausnummer 12',
    );
  });

  it('a token for another decal or past its time counts as unconfirmed, the alert still goes out', async () => {
    const one = await owner();
    const two = await owner('two@example.de', 'Grün');
    await setProtection(one.s, one.v.id, true);
    await setProtection(two.s, two.v.id, true);
    const token = await verified(one.code);
    const res = await send(two.code, { type: 'custom', message: SECRET_TEXT, verification: token });
    expect(res.statusCode).toBe(201);
    const row = await h.db.selectFrom('alerts').select('content_hidden').executeTakeFirstOrThrow();
    expect(row.content_hidden).toBe(true);
  });
});

describe('phone check (abuse protection §4)', () => {
  async function protectedVehicle() {
    const o = await owner();
    await setProtection(o.s, o.v.id, true);
    return o;
  }

  it('accepts mobile numbers only: VoIP and landline are refused', async () => {
    const { code } = await protectedVehicle();
    expect((await verifyStart(code, '032 212345678')).json().error).toBe('phone_not_mobile');
    expect((await verifyStart(code, '030 12345678')).json().error).toBe('phone_not_mobile');
    expect((await verifyStart(code, '+1 202 555 0143')).json().error).toBe('phone_country');
    expect((await verifyStart(code, 'abc')).json().error).toBe('phone_invalid');
    expect((await smsInbox()).filter((m) => m.tag === 'sms_verify')).toHaveLength(0);
  });

  it('limits codes per scanner and per number (SMS pumping), captcha first', async () => {
    const { code } = await protectedVehicle();
    const noCaptcha = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${code}/verify/start`,
      payload: { phone: '0151 11122233', captcha: 'wrong' },
    });
    expect(noCaptcha.statusCode).toBe(400);
    for (let i = 0; i < 3; i++)
      expect((await verifyStart(code, `0151 1112223${i}`)).statusCode).toBe(202);
    const fourth = await verifyStart(code, '0151 11122239');
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().limit).toBe('verify.otp_scanner');
    // The same number from other networks: 3 per day.
    for (let i = 0; i < 2; i++)
      expect((await verifyStart(code, '0151 11122230', `203.0.113.${i + 10}`)).statusCode).toBe(
        202,
      );
    const tooMany = await verifyStart(code, '0151 11122230', '203.0.113.99');
    expect(tooMany.json().limit).toBe('verify.otp_phone');
  });

  it('a wrong code is refused', async () => {
    const { code } = await protectedVehicle();
    await verifyStart(code, '0151 11122233');
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${code}/verify/check`,
      payload: { phone: '0151 11122233', code: '000000' },
    });
    expect([422, 200]).toContain(res.statusCode);
    if (res.statusCode === 200) return; // 1 in a million: the random code was 000000
    expect(res.json().error).toBe('code_invalid');
  });
});

describe('phone bans (abuse protection §5)', () => {
  it('blocking a confirmed sender bans the number for this vehicle for 12 months', async () => {
    const { s, v, code } = await owner();
    await setProtection(s, v.id, true);
    const token = await verified(code);
    const a = (await send(code, { verification: token })).json();
    expect((await block(s, a.alertId)).json()).toMatchObject({ blocked: true, phoneBanned: true });
    const ban = await h.db.selectFrom('phone_bans').selectAll().executeTakeFirstOrThrow();
    expect(ban).toMatchObject({ vehicle_id: v.id, created_by: 'owner' });
    const months = (ban.expires_at.getTime() - Date.now()) / (30.4 * 86_400_000);
    expect(months).toBeGreaterThan(11.9);
    expect(months).toBeLessThan(12.2);

    // From another network (no scanner block), the number is still banned: no new check, no alert.
    const otherIp = '203.0.113.200';
    expect((await verifyStart(code, '0151 11122233', otherIp)).statusCode).toBe(403);
    const again = await send(code, { verification: token }, otherIp);
    expect(again.statusCode).toBe(403);
    expect(again.json().error).toBe('not_deliverable');

    await sql`UPDATE phone_bans SET expires_at = now() - interval '1 second'`.execute(h.db);
    await sql`SELECT run_retention()`.execute(h.db);
    expect(await h.db.selectFrom('phone_bans').selectAll().execute()).toHaveLength(0);
  });

  it('3 vehicles within 90 days make a global-ban candidate; staff confirm it after review', async () => {
    const phone = '0151 44455566';
    for (const [i, email] of ['a@example.de', 'b@example.de', 'c@example.de'].entries()) {
      const o = await owner(email, `Auto ${i}`);
      await setProtection(o.s, o.v.id, true);
      const ip = `198.51.10${i}.1`;
      const token = await verified(o.code, phone, ip);
      const a = (await send(o.code, { verification: token }, ip)).json();
      await block(o.s, a.alertId);
    }
    expect(await h.db.selectFrom('phone_bans').selectAll().execute()).toHaveLength(3);
    // Never automatic: no global ban yet.
    const globalBefore = await h.db
      .selectFrom('phone_bans')
      .select('id')
      .where('vehicle_id', 'is', null)
      .execute();
    expect(globalBefore).toHaveLength(0);

    const staff = ops.get(StaffService);
    const { userId } = await staff.invite(null, {
      email: 'mod@parkshield.de',
      name: 'mod',
      roles: ['abuse_moderator'],
    });
    const sess = await staff.createSession(userId, 'Chrome · Windows');
    const headers = {
      cookie: `ps_ops_session=${sess.token}; ps_ops_csrf=${sess.csrf}`,
      'x-csrf-token': sess.csrf,
    };
    const list = await ops.inject({
      method: 'GET',
      url: '/ops/v1/abuse/phone-candidates',
      headers,
    });
    expect(list.statusCode).toBe(200);
    const [candidate] = list.json().candidates;
    expect(candidate).toMatchObject({ vehicles: 3 });
    expect(list.body).not.toMatch(/4455566|\+49/);

    const ban = await ops.inject({
      method: 'POST',
      url: '/ops/v1/abuse/phone-bans',
      headers,
      payload: { hash: candidate.hash, reason: 'Belästigung, 3 Halter' },
    });
    expect(ban.statusCode).toBe(201);
    expect(
      (await ops.inject({ method: 'GET', url: '/ops/v1/abuse/phone-candidates', headers })).json()
        .candidates,
    ).toHaveLength(0);

    // Globally banned: a fourth vehicle refuses the check as well.
    const d = await owner('d@example.de', 'Auto 4');
    await setProtection(d.s, d.v.id, true);
    expect((await verifyStart(d.code, phone, '198.51.110.1')).statusCode).toBe(403);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('actor_id', '=', userId)
      .execute();
    expect(audit.map((a) => a.action)).toContain('abuse.phone_ban_global');
  });
});
