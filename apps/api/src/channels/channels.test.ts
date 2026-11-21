import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DispatchService, PUSH_MAX_FAILURES } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import { TWILIO_SMS_WEBHOOK_PATH } from '../providers/twilio-sms';
import { twilioSignature } from '../providers/twilio-signature';
import {
  appPushes,
  createHarness,
  escalationDue,
  mailbox,
  registerAppDevice,
  resetState,
  runEscalation,
  setSetting,
  signIn,
  TEST_TWILIO_AUTH_TOKEN,
  TEST_TWILIO_WEBHOOK_BASE,
  subscribe,
  UA_IPHONE,
  type Harness,
  type Session,
} from '../test/harness';

let h: Harness;
let crypto: FieldCrypto;

// A stand-in push service: /ok answers 201, /gone 410, /fail 500.
let server: Server;
let pushBase = '';
const received: { path: string; urgency?: string; ttl?: string; encoding?: string }[] = [];

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        urgency: req.headers.urgency as string | undefined,
        ttl: req.headers.ttl as string | undefined,
        encoding: req.headers['content-encoding'],
      });
      const status = req.url?.startsWith('/gone') ? 410 : req.url?.startsWith('/fail') ? 500 : 201;
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  pushBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await h.close();
});
beforeEach(async () => {
  received.length = 0;
  await resetState(h);
});

const b64url = (b: Buffer) => b.toString('base64url');
function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(randomBytes(16)) };
}

const registerPush = (s: Session, endpoint: string, ua?: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/push-subscriptions',
    headers: { ...s.headers, ...(ua ? { 'user-agent': ua } : {}) },
    payload: { endpoint, keys: browserKeys() },
  });

async function vehicleWithCode(email = 'owner@example.de') {
  const s = await subscribe(h, email);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
    })
  ).json();
  const t = await h.db
    .selectFrom('qr_tokens')
    .select('code_enc')
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  return { s, v, code: crypto.decrypt(t.code_enc) };
}

async function alert(code: string, type = 'lights_on', ip = '203.0.113.7') {
  const res = await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: ip,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type },
  });
  expect(res.statusCode).toBe(201);
  return res.json().alertId as string;
}

const deliveries = (alertId: string) =>
  h.db
    .selectFrom('alert_deliveries')
    .select([
      'channel',
      'status',
      'suppressed_reason',
      'provider_message_id',
      'cost_micros_eur',
      'error_code',
    ])
    .where('alert_id', '=', alertId)
    .orderBy('queued_at')
    .execute();

const smsInbox = async () =>
  (await h.app.inject({ method: 'GET', url: '/v1/dev/sms' })).json().messages as {
    to: string;
    body: string;
    tag: string;
    messageId: string;
  }[];

describe('Web Push devices (US-20)', () => {
  it('registers a device with its platform, lists and removes it', async () => {
    const s = await signIn(h, 'owner@example.de');
    const res = await registerPush(s, `${pushBase}/ok/1`, UA_IPHONE);
    expect(res.statusCode).toBe(201);
    expect(res.json().platform).toBe('ios');
    const overview = (
      await h.app.inject({ method: 'GET', url: '/v1/channels', headers: s.headers })
    ).json();
    expect(overview.push.publicKey).toBe(h.env.VAPID_PUBLIC_KEY);
    expect(overview.push.devices).toHaveLength(1);
    expect(overview.push.devices[0]).toMatchObject({ platform: 'ios' });
    expect(JSON.stringify(overview)).not.toContain('p256dh');

    const other = await signIn(h, 'other@example.de');
    const id = overview.push.devices[0].id;
    expect(
      (
        await h.app.inject({
          method: 'DELETE',
          url: `/v1/push-subscriptions/${id}`,
          headers: other.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await h.app.inject({
          method: 'DELETE',
          url: `/v1/push-subscriptions/${id}`,
          headers: s.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(await h.db.selectFrom('push_subscriptions').selectAll().execute()).toHaveLength(0);
  });

  it('refuses endpoints that are not browser push services (SSRF)', async () => {
    const s = await signIn(h, 'owner@example.de');
    for (const endpoint of [
      'https://169.254.169.254/latest/meta-data',
      'https://internal.example.com/push',
      'https://fcm.googleapis.com.evil.example/x',
      'http://fcm.googleapis.com/fcm/send/x',
      'http://10.0.0.5/push',
    ]) {
      const res = await registerPush(s, endpoint);
      expect(res.statusCode, endpoint).toBe(400);
    }
    expect((await registerPush(s, 'https://fcm.googleapis.com/fcm/send/abc')).statusCode).toBe(201);
    expect((await registerPush(s, 'https://web.push.apple.com/QGx')).statusCode).toBe(201);
  });

  it('needs a signed-in owner and the CSRF token', async () => {
    const s = await signIn(h, 'owner@example.de');
    const anon = await h.app.inject({
      method: 'POST',
      url: '/v1/push-subscriptions',
      payload: { endpoint: `${pushBase}/ok`, keys: browserKeys() },
    });
    expect(anon.statusCode).toBe(401);
    const noCsrf = await h.app.inject({
      method: 'POST',
      url: '/v1/push-subscriptions',
      headers: { cookie: s.cookie },
      payload: { endpoint: `${pushBase}/ok`, keys: browserKeys() },
    });
    expect(noCsrf.statusCode).toBe(403);
  });
});

describe('dispatch: app push only (US-21, NT-06, NT-12, owner decision 2026-11-21)', () => {
  it('pushes every app device once; never web push, e-mail or SMS at alert time', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/ok/laptop`);
    await registerAppDevice(h, 'owner@example.de', 'fcm-token-phone-0000000001');
    await registerAppDevice(h, 'owner@example.de', 'fcm-token-tablet-000000001');
    const id = await alert(code, 'blocking');
    const dispatch = h.app.get(DispatchService);
    await dispatch.dispatch(id);
    await dispatch.dispatch(id); // replay
    expect(received).toHaveLength(0);
    const rows = await deliveries(id);
    expect(rows.map((r) => `${r.channel}:${r.status}`)).toEqual([
      'native_push:sent',
      'native_push:sent',
    ]);
    expect((await appPushes(h)).map((p) => p.body.message.token).sort()).toEqual([
      'fcm-token-phone-0000000001',
      'fcm-token-tablet-000000001',
    ]);
    expect(await smsInbox()).toHaveLength(0);
    expect((await mailbox(h)).filter((m) => m.tag.startsWith('alert_'))).toHaveLength(0);
    const a = await h.db.selectFrom('alerts').select('status').executeTakeFirstOrThrow();
    expect(a.status).toBe('delivered');
  });

  it(`removes an app device FCM reports as gone, or after ${PUSH_MAX_FAILURES} errors in a row`, async () => {
    const { code } = await vehicleWithCode();
    await registerAppDevice(h, 'owner@example.de', 'invalid-token-0000000000001');
    const id = await alert(code, 'lights_on', '198.51.100.1');
    await h.app.get(DispatchService).dispatch(id);
    expect(await h.db.selectFrom('user_devices').selectAll().execute()).toHaveLength(0);
    expect((await deliveries(id))[0]).toMatchObject({ channel: 'native_push', status: 'failed' });
  });

  it('suppresses switched-off app push with reason kill_switch', async () => {
    const { code } = await vehicleWithCode();
    await registerAppDevice(h, 'owner@example.de');
    await setSetting(h, 'channels.native_push.enabled', false);
    const id = await alert(code);
    await h.app.get(DispatchService).dispatch(id);
    expect(await appPushes(h)).toHaveLength(0);
    expect(await deliveries(id)).toEqual([
      expect.objectContaining({
        channel: 'native_push',
        status: 'suppressed',
        suppressed_reason: 'kill_switch',
      }),
    ]);
  });
});

describe('SMS (NT-07): the owner’s verified mobile number', () => {
  async function linkSms(s: Session, phone = '0151 23456789') {
    const start = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/sms',
      headers: s.headers,
      payload: { phone, consent: true },
    });
    expect(start.statusCode, start.body).toBe(200);
    const otp = (await smsInbox()).find((m) => m.tag === 'sms_verify')!;
    const code = /(\d{6})/.exec(otp.body)![1]!;
    return { start, otp, code };
  }

  it('links a number with an SMS code and records the opt-in; it can be changed, not removed', async () => {
    const s = await signIn(h, 'owner@example.de');
    const noConsent = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/sms',
      headers: s.headers,
      payload: { phone: '0151 23456789' },
    });
    expect(noConsent.statusCode).toBe(400);

    const { start, otp, code } = await linkSms(s);
    expect(start.json().phone).toBe('+49 ••• 6789');
    expect(otp.to).toBe('+4915123456789');
    const wrong = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/sms/verify',
      headers: s.headers,
      payload: { code: code === '000000' ? '111111' : '000000' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('code_wrong');
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/sms/verify',
      headers: s.headers,
      payload: { code },
    });
    expect(ok.statusCode).toBe(200);
    expect((await smsInbox())[0]?.tag).toBe('sms_linked');
    const channel = await h.db.selectFrom('contact_channels').selectAll().executeTakeFirstOrThrow();
    expect(channel).toMatchObject({ type: 'sms' });
    expect(channel.verified_at).not.toBeNull();
    expect(channel.opted_in_at).not.toBeNull();
    expect(channel.address_enc!.toString('latin1')).not.toContain('15123456789');
    const consent = await h.db.selectFrom('consents').selectAll().executeTakeFirstOrThrow();
    expect(consent).toMatchObject({ purpose: 'sms', withdrawn_at: null });
    const overview = (
      await h.app.inject({ method: 'GET', url: '/v1/channels', headers: s.headers })
    ).json();
    expect(overview.sms.phone).toBe('+49 ••• 6789');
    expect(overview).not.toHaveProperty('whatsapp');
    const profile = (
      await h.app.inject({ method: 'GET', url: '/v1/me/profile', headers: s.headers })
    ).json();
    expect(profile.phoneVerified).toBe(true);

    // The number is required (escalation SMS): removing it is refused, it stays linked.
    const del = await h.app.inject({ method: 'DELETE', url: '/v1/channels/sms', headers: s.headers });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toEqual({ error: 'phone_required' });
    expect(await h.db.selectFrom('contact_channels').selectAll().execute()).toHaveLength(1);
  });

  it('accepts mobile numbers only, from Germany and the EU', async () => {
    const s = await signIn(h, 'owner@example.de');
    const start = (phone: string) =>
      h.app.inject({
        method: 'POST',
        url: '/v1/channels/sms',
        headers: s.headers,
        payload: { phone, consent: true },
      });
    const landline = await start('+49 30 12345678');
    expect(landline.statusCode).toBe(400);
    expect(landline.json().error).toBe('phone_not_mobile');
    const us = await start('+1 202 555 0147');
    expect(us.statusCode).toBe(400);
    expect(us.json().error).toBe('phone_country');
    const swiss = await start('+41 79 123 45 67');
    expect(swiss.json().error).toBe('phone_country');
    expect(await smsInbox()).toHaveLength(0);
    // An EU mobile number works (Austria).
    expect((await start('+43 664 1234567')).statusCode).toBe(200);
    expect((await smsInbox())[0]).toMatchObject({ tag: 'sms_verify', to: '+436641234567' });
  });

  it('limits SMS code requests per user', async () => {
    const s = await signIn(h, 'owner@example.de');
    for (let i = 0; i < 3; i++) await linkSms(s);
    const fourth = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/sms',
      headers: s.headers,
      payload: { phone: '0151 23456789', consent: true },
    });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().limit).toBe('sms.otp_user');
  });

  it('the escalation SMS is one GSM-7 segment with the view link and cost; signed status callbacks', async () => {
    const { code: decal } = await vehicleWithCode();
    const id = await alert(decal, 'blocking');
    await h.app.get(DispatchService).dispatch(id);
    expect(await smsInbox()).toHaveLength(0); // never at alert time
    await escalationDue(h, 'sms');
    await runEscalation(h);
    const msg = (await smsInbox())[0]!;
    expect(msg).toMatchObject({ tag: 'sms_escalation', to: '+4915123456789' });
    expect(msg.body).toContain('Fahrzeug versperrt Ausfahrt');
    expect(msg.body).toMatch(/\/v\/[A-Za-z0-9_-]{43}$/);
    expect(msg.body.length).toBeLessThanOrEqual(160);
    const row = (await deliveries(id)).find((r) => r.channel === 'sms')!;
    expect(row).toMatchObject({
      status: 'sent',
      cost_micros_eur: 100_000,
      provider_message_id: msg.messageId,
    });

    const url = `${TEST_TWILIO_WEBHOOK_BASE}${TWILIO_SMS_WEBHOOK_PATH}`;
    const params = { MessageSid: msg.messageId, MessageStatus: 'delivered' };
    const post = (signature: string) =>
      h.app.inject({
        method: 'POST',
        url: TWILIO_SMS_WEBHOOK_PATH,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': signature,
        },
        payload: new URLSearchParams(params).toString(),
      });
    expect((await post('forged')).statusCode).toBe(403);
    const ok = await post(twilioSignature(TEST_TWILIO_AUTH_TOKEN, url, params));
    expect(ok.statusCode).toBe(200);
    expect((await deliveries(id)).find((r) => r.channel === 'sms')!.status).toBe('delivered');
  });
});

describe('one mobile number for SMS (NT-07)', () => {
  it('links the number with one SMS code through the phone set-up', async () => {
    const s = await signIn(h, 'owner@example.de');
    const start = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/phone',
      headers: s.headers,
      payload: { phone: '0151 23456789', channels: ['sms'], consent: true },
    });
    expect(start.json()).toEqual({ phone: '+49 ••• 6789', via: 'sms' });
    const otp = (await smsInbox()).find((m) => m.tag === 'sms_verify')!;
    const code = /(\d{6})/.exec(otp.body)![1]!;
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/phone/verify',
      headers: s.headers,
      payload: { code },
    });
    expect(ok.json()).toEqual({ channels: ['sms'] });
    const rows = await h.db.selectFrom('contact_channels').select('type').execute();
    expect(rows.map((r) => r.type)).toEqual(['sms']);
    const overview = (
      await h.app.inject({ method: 'GET', url: '/v1/channels', headers: s.headers })
    ).json();
    expect(overview.available).toEqual({ sms: true });
  });

  it('refuses WhatsApp everywhere (removed)', async () => {
    const s = await signIn(h, 'owner@example.de');
    const start = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/phone',
      headers: s.headers,
      payload: { phone: '0151 23456789', channels: ['whatsapp'], consent: true },
    });
    expect(start.statusCode).toBe(400);
    for (const url of [
      '/v1/channels/whatsapp',
      '/v1/webhooks/twilio/whatsapp',
      '/v1/webhooks/whatsapp/x',
    ]) {
      const r = await h.app.inject({ method: 'POST', url, headers: s.headers, payload: {} });
      expect(r.statusCode).toBe(404);
    }
  });

  it('does not offer a switched-off channel', async () => {
    const s = await signIn(h, 'owner@example.de');
    await setSetting(h, 'channels.sms.enabled', false);
    const overview = (
      await h.app.inject({ method: 'GET', url: '/v1/channels', headers: s.headers })
    ).json();
    expect(overview.available).toEqual({ sms: false });
    const start = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/phone',
      headers: s.headers,
      payload: { phone: '0151 23456789', channels: ['sms'], consent: true },
    });
    expect(start.json().error).toBe('channel_unavailable');
  });
});
