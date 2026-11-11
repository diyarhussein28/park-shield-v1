import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DispatchService, PUSH_MAX_FAILURES } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  createHarness,
  lastMail,
  resetState,
  setSetting,
  signIn,
  subscribe,
  TEST_WA_WEBHOOK_SECRET,
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

const waInbox = async () =>
  (await h.app.inject({ method: 'GET', url: '/v1/dev/whatsapp' })).json().messages as {
    to: string;
    template: string;
    params: string[];
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

describe('dispatch on all channels (US-20, US-21, NT-06, NT-12)', () => {
  it('pushes every device once (high urgency for urgent alerts) alongside e-mail', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/ok/phone`);
    await registerPush(s, `${pushBase}/ok/laptop`);
    const id = await alert(code, 'blocking');
    const dispatch = h.app.get(DispatchService);
    await dispatch.dispatch(id);
    await dispatch.dispatch(id); // replay
    expect(received.map((r) => r.path).sort()).toEqual(['/ok/laptop', '/ok/phone']);
    expect(
      received.every((r) => r.urgency === 'high' && r.ttl === '7200' && r.encoding === 'aes128gcm'),
    ).toBe(true);
    const rows = await deliveries(id);
    expect(rows.filter((r) => r.channel === 'webpush' && r.status === 'sent')).toHaveLength(2);
    expect(rows.filter((r) => r.channel === 'email' && r.status === 'sent')).toHaveLength(1);
    const devices = await h.db
      .selectFrom('push_subscriptions')
      .select(['last_ok_at', 'failed_count'])
      .execute();
    expect(devices.every((d) => d.last_ok_at && d.failed_count === 0)).toBe(true);
  });

  it('removes a device after HTTP 410 and tells the owner by e-mail', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/gone/1`);
    const id = await alert(code);
    await h.app.get(DispatchService).dispatch(id);
    expect(await h.db.selectFrom('push_subscriptions').selectAll().execute()).toHaveLength(0);
    expect((await deliveries(id)).find((r) => r.channel === 'webpush')).toMatchObject({
      status: 'failed',
      error_code: 'http_410',
    });
    const mail = await lastMail(h, 'push_removed');
    expect(mail?.to).toBe('owner@example.de');
    expect(mail?.text).toContain('/konto/benachrichtigungen');
  });

  it(`removes a device after ${PUSH_MAX_FAILURES} consecutive errors, and a success resets the count`, async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/fail/1`);
    await h.db
      .updateTable('push_subscriptions')
      .set({ failed_count: PUSH_MAX_FAILURES - 2 })
      .execute();
    const dispatch = h.app.get(DispatchService);
    await dispatch.dispatch(await alert(code, 'lights_on', '198.51.100.1'));
    expect(
      (await h.db.selectFrom('push_subscriptions').select('failed_count').executeTakeFirstOrThrow())
        .failed_count,
    ).toBe(PUSH_MAX_FAILURES - 1);
    expect(await lastMail(h, 'push_removed')).toBeUndefined();
    await dispatch.dispatch(await alert(code, 'lights_on', '198.51.101.1'));
    expect(await h.db.selectFrom('push_subscriptions').selectAll().execute()).toHaveLength(0);
    expect(await lastMail(h, 'push_removed')).toBeDefined();
  });

  it('suppresses a switched-off channel with reason kill_switch and still sends the others', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/ok/1`);
    await setSetting(h, 'channels.webpush.enabled', false);
    const id = await alert(code);
    await h.app.get(DispatchService).dispatch(id);
    expect(received).toHaveLength(0);
    const rows = await deliveries(id);
    expect(rows.find((r) => r.channel === 'webpush')).toMatchObject({
      status: 'suppressed',
      suppressed_reason: 'kill_switch',
    });
    expect(rows.find((r) => r.channel === 'email')?.status).toBe('sent');
    const a = await h.db.selectFrom('alerts').select('status').executeTakeFirstOrThrow();
    expect(a.status).toBe('delivered');
  });
});

describe('WhatsApp linking (US-21)', () => {
  async function link(s: Session, phone = '0151 23456789') {
    const start = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp',
      headers: s.headers,
      payload: { phone, consent: true },
    });
    expect(start.statusCode).toBe(200);
    const otp = (await waInbox()).find((m) => m.template === 'ps_otp')!;
    return { start, otp };
  }

  it('needs consent and a valid mobile number', async () => {
    const s = await signIn(h, 'owner@example.de');
    const noConsent = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp',
      headers: s.headers,
      payload: { phone: '0151 23456789' },
    });
    expect(noConsent.statusCode).toBe(400);
    const landline = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp',
      headers: s.headers,
      payload: { phone: '030 1234567', consent: true },
    });
    expect(landline.json().error).toBe('phone_invalid');
    expect(await waInbox()).toHaveLength(0);
  });

  it('verifies the OTP, records the opt-in, sends a test message, and unlinks with one tap', async () => {
    const s = await signIn(h, 'owner@example.de');
    const { start, otp } = await link(s);
    expect(start.json().phone).toBe('+49 ••• 6789');
    expect(otp.to).toBe('4915123456789');
    const code = otp.params[0]!;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp/verify',
      headers: s.headers,
      payload: { code: wrong },
    });
    expect(bad.json()).toEqual({ error: 'code_wrong', attemptsLeft: 4 });

    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp/verify',
      headers: s.headers,
      payload: { code },
    });
    expect(ok.statusCode).toBe(200);
    expect((await waInbox())[0]?.template).toBe('ps_test');
    const channel = await h.db.selectFrom('contact_channels').selectAll().executeTakeFirstOrThrow();
    expect(channel.verified_at).not.toBeNull();
    expect(channel.opted_in_at).not.toBeNull();
    expect(channel.address_enc!.toString('latin1')).not.toContain('15123456789');
    const consent = await h.db.selectFrom('consents').selectAll().executeTakeFirstOrThrow();
    expect(consent).toMatchObject({ purpose: 'whatsapp', withdrawn_at: null });
    const overview = (
      await h.app.inject({ method: 'GET', url: '/v1/channels', headers: s.headers })
    ).json();
    expect(overview.whatsapp.phone).toBe('+49 ••• 6789');

    // The code works only once.
    const replay = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp/verify',
      headers: s.headers,
      payload: { code },
    });
    expect(replay.json().error).toBe('code_expired');

    const unlink = await h.app.inject({
      method: 'DELETE',
      url: '/v1/channels/whatsapp',
      headers: s.headers,
    });
    expect(unlink.statusCode).toBe(200);
    expect(await h.db.selectFrom('contact_channels').selectAll().execute()).toHaveLength(0);
    const withdrawn = await h.db
      .selectFrom('consents')
      .select('withdrawn_at')
      .executeTakeFirstOrThrow();
    expect(withdrawn.withdrawn_at).not.toBeNull();
  });

  it('locks the code after 5 wrong attempts and limits code requests', async () => {
    const s = await signIn(h, 'owner@example.de');
    await link(s);
    for (let i = 0; i < 5; i++) {
      await h.app.inject({
        method: 'POST',
        url: '/v1/channels/whatsapp/verify',
        headers: s.headers,
        payload: { code: '999999' },
      });
    }
    const otp = (await waInbox()).find((m) => m.template === 'ps_otp')!;
    const late = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp/verify',
      headers: s.headers,
      payload: { code: otp.params[0] },
    });
    expect(late.json().error).toBe('code_expired');

    await link(s);
    await link(s);
    const fourth = await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp',
      headers: s.headers,
      payload: { phone: '0151 23456789', consent: true },
    });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().limit).toBe('whatsapp.otp_user');
  });

  it('delivers alerts on WhatsApp with cost, and tracks statuses from the webhook', async () => {
    const { s, code } = await vehicleWithCode();
    const { otp } = await link(s);
    await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp/verify',
      headers: s.headers,
      payload: { code: otp.params[0] },
    });
    // Urgent, so WhatsApp is used alongside e-mail (a normal alert stops at the first channel).
    const id = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(id);
    const msg = (await waInbox())[0]!;
    expect(msg).toMatchObject({ template: 'ps_alert', to: '4915123456789' });
    expect(msg.params).toEqual(['Fahrzeug versperrt Ausfahrt', 'Der Blaue']);
    const wa = (await deliveries(id)).find((r) => r.channel === 'whatsapp')!;
    expect(wa).toMatchObject({
      status: 'sent',
      cost_micros_eur: 55_000,
      provider_message_id: msg.messageId,
    });

    const hook = (statuses: unknown[], secret = TEST_WA_WEBHOOK_SECRET) =>
      h.app.inject({
        method: 'POST',
        url: `/v1/webhooks/whatsapp/${secret}`,
        payload: { entry: [{ changes: [{ value: { statuses } }] }] },
      });
    expect((await hook([], 'wrong')).statusCode).toBe(404);
    const ts = Math.floor(Date.now() / 1000);
    expect((await hook([{ id: msg.messageId, status: 'read', timestamp: ts }])).statusCode).toBe(
      200,
    );
    // Out of order: a late "delivered" must not move it back.
    await hook([{ id: msg.messageId, status: 'delivered', timestamp: ts - 5 }]);
    const row = await h.db
      .selectFrom('alert_deliveries')
      .select(['status', 'delivered_at', 'read_at'])
      .where('channel', '=', 'whatsapp')
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('read');
    expect(row.read_at).not.toBeNull();
    expect(row.delivered_at).not.toBeNull();
  });

  it('records a WhatsApp kill switch as suppressed', async () => {
    const { s, code } = await vehicleWithCode();
    const { otp } = await link(s);
    await h.app.inject({
      method: 'POST',
      url: '/v1/channels/whatsapp/verify',
      headers: s.headers,
      payload: { code: otp.params[0] },
    });
    await setSetting(h, 'channels.whatsapp.enabled', false);
    const before = (await waInbox()).length;
    const id = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(id);
    expect((await waInbox()).length).toBe(before);
    expect((await deliveries(id)).find((r) => r.channel === 'whatsapp')).toMatchObject({
      status: 'suppressed',
      suppressed_reason: 'kill_switch',
    });
  });
});
