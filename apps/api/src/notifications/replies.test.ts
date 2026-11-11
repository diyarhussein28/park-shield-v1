import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  addConfirmedContact,
  createHarness,
  mailbox,
  resetState,
  setSetting,
  subscribe,
  TEST_WA_WEBHOOK_SECRET,
  type Harness,
  type Session,
} from '../test/harness';
import { DispatchService } from './dispatch.service';
import { ESCALATE_TOPIC, EscalationService } from './escalation.service';

let h: Harness;
let crypto: FieldCrypto;
let server: Server;
let pushBase = '';
const pushed: string[] = [];

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      pushed.push(req.url ?? '');
      res.writeHead(req.url?.startsWith('/fail') ? 500 : 201).end();
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
  pushed.length = 0;
  await resetState(h);
});

const OWNER = 'owner@example.de';

async function vehicleWithCode(email = OWNER) {
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

let ipCounter = 1;
async function alert(code: string, type = 'lights_on', message?: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: `198.51.${100 + (ipCounter++ % 100)}.7`,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type, ...(message ? { message } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { alertId: string; statusToken: string };
}

const status = (a: { alertId: string; statusToken: string }) =>
  h.app
    .inject({
      method: 'GET',
      url: `/v1/alerts/${a.alertId}/status`,
      headers: { 'x-status-token': a.statusToken },
    })
    .then((r) => r.json());

const registerPush = (s: Session, endpoint: string) => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return h.app.inject({
    method: 'POST',
    url: '/v1/push-subscriptions',
    headers: s.headers,
    payload: {
      endpoint,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url'),
      },
    },
  });
};

const ownerChannels = (alertId: string) =>
  h.db
    .selectFrom('alert_deliveries')
    .select(['channel', 'status', 'suppressed_reason'])
    .where('alert_id', '=', alertId)
    .where('recipient', '=', 'owner')
    .orderBy('queued_at')
    .execute();

async function linkWhatsApp(s: Session) {
  await h.app.inject({
    method: 'POST',
    url: '/v1/channels/whatsapp',
    headers: s.headers,
    payload: { phone: '0151 23456789', consent: true },
  });
  const inbox = (await h.app.inject({ method: 'GET', url: '/v1/dev/whatsapp' })).json().messages;
  const code = inbox.find((m: { template: string }) => m.template === 'ps_otp').params[0];
  await h.app.inject({
    method: 'POST',
    url: '/v1/channels/whatsapp/verify',
    headers: s.headers,
    payload: { code },
  });
}

/** The reply token from the newest alert e-mail (it travels in the URL fragment). */
async function replyToken(tag = 'alert_received') {
  const mail = (await mailbox(h)).find((m) => m.tag === tag);
  const m = /\/antwort\?r=coming#t=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '');
  if (!m) throw new Error(`no reply link in ${tag}`);
  return m[1]!;
}
const reply = (token: string, r: string) =>
  h.app.inject({ method: 'POST', url: '/v1/ack', payload: { token, reply: r } });

describe('channel order and fallback (US-22, NT-01, NT-12)', () => {
  it('normal alerts stop at the first channel that works (Push before e-mail)', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/ok/1`);
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect(pushed).toEqual(['/ok/1']);
    expect(await ownerChannels(a.alertId)).toEqual([
      { channel: 'webpush', status: 'sent', suppressed_reason: null },
    ]);
    expect((await mailbox(h)).filter((m) => m.tag === 'alert_received')).toHaveLength(0);
  });

  it('falls back to the next channel when one fails, or is switched off', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/fail/1`);
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect((await ownerChannels(a.alertId)).map((d) => `${d.channel}:${d.status}`)).toEqual([
      'webpush:failed',
      'email:sent',
    ]);

    await h.db.deleteFrom('push_subscriptions').execute();
    await registerPush(s, `${pushBase}/ok/2`);
    await setSetting(h, 'channels.webpush.enabled', false);
    const b = await alert(code);
    await h.app.get(DispatchService).dispatch(b.alertId);
    expect(await ownerChannels(b.alertId)).toEqual([
      { channel: 'webpush', status: 'suppressed', suppressed_reason: 'kill_switch' },
      { channel: 'email', status: 'sent', suppressed_reason: null },
    ]);
  });

  it('urgent alerts go to every channel at once', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/ok/1`);
    await linkWhatsApp(s);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect((await ownerChannels(a.alertId)).map((d) => `${d.channel}:${d.status}`)).toEqual([
      'webpush:sent',
      'email:sent',
      'whatsapp:sent',
    ]);
  });

  it('follows the owner’s own order, and the default order from settings', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/ok/1`);
    const overview = await h.app.inject({ method: 'GET', url: '/v1/channels', headers: s.headers });
    expect(overview.json().order).toEqual(['webpush', 'email', 'whatsapp']);

    await setSetting(h, 'channels.order', ['email', 'webpush', 'whatsapp']);
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect((await ownerChannels(a.alertId)).map((d) => d.channel)).toEqual(['email']);

    const bad = await h.app.inject({
      method: 'PUT',
      url: '/v1/channels/order',
      headers: s.headers,
      payload: { order: ['email', 'email', 'whatsapp'] },
    });
    expect(bad.statusCode).toBe(400);
    const saved = await h.app.inject({
      method: 'PUT',
      url: '/v1/channels/order',
      headers: s.headers,
      payload: { order: ['whatsapp', 'webpush', 'email'] },
    });
    expect(saved.json().order).toEqual(['whatsapp', 'webpush', 'email']);
    // WhatsApp is not linked, so the first channel that works is Push.
    const b = await alert(code);
    await h.app.get(DispatchService).dispatch(b.alertId);
    expect((await ownerChannels(b.alertId)).map((d) => d.channel)).toEqual(['webpush']);
  });
});

describe('quick replies (US-23, NT-02, NT-10)', () => {
  it('records "Ich komme" on a tap only, shows it to the scanner, and works once', async () => {
    const { code } = await vehicleWithCode();
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    const mail = (await mailbox(h)).find((m) => m.tag === 'alert_received')!;
    for (const label of ['Ich komme', 'In ca. 30 Min', 'Bin nicht in der Nähe']) {
      expect(mail.html).toContain(label);
    }
    const token = await replyToken();
    expect(mail.text).not.toMatch(/[?&]t=/); // the token is only ever in the fragment

    // Opening the page (preview) changes nothing.
    const preview = await h.app.inject({
      method: 'POST',
      url: '/v1/ack/preview',
      payload: { token },
    });
    expect(preview.json()).toMatchObject({
      nickname: 'Der Blaue',
      answered: false,
      expired: false,
    });
    expect((await status(a)).status).toBe('delivered');

    const r = await reply(token, 'coming');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ reply: 'coming', escalating: false });
    expect(await status(a)).toMatchObject({ status: 'acknowledged', ownerReply: 'coming' });

    const again = await reply(token, 'not_nearby');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already_answered', reply: 'coming' });
    const after = await h.app.inject({
      method: 'POST',
      url: '/v1/ack/preview',
      payload: { token },
    });
    expect(after.json()).toMatchObject({ answered: true, reply: 'coming' });
    expect((await reply('x'.repeat(43), 'coming')).statusCode).toBe(404);
  });

  it('uses the same link in every channel and every retry', async () => {
    const { s, code } = await vehicleWithCode();
    await linkWhatsApp(s);
    const a = await alert(code, 'blocking');
    const dispatch = h.app.get(DispatchService);
    await dispatch.dispatch(a.alertId);
    const token = await replyToken();
    const wa = (await h.app.inject({ method: 'GET', url: '/v1/dev/whatsapp' })).json().messages[0];
    expect(wa.buttons).toEqual([
      `ack:${token}:coming`,
      `ack:${token}:in_30_min`,
      `ack:${token}:not_nearby`,
    ]);
  });

  it('"In ca. 30 Min" postpones escalation by 30 minutes, "Ich komme" cancels it', async () => {
    const { code } = await vehicleWithCode();
    await addConfirmedContact(h, OWNER);
    const a = await alert(code, 'blocking');
    const initial = await h.db.selectFrom('alerts').select('escalate_at').executeTakeFirstOrThrow();
    expect(initial.escalate_at!.getTime()).toBeGreaterThan(Date.now() + 6 * 60_000);
    expect(initial.escalate_at!.getTime()).toBeLessThan(Date.now() + 8 * 60_000);

    await h.app.get(DispatchService).dispatch(a.alertId);
    await reply(await replyToken(), 'in_30_min');
    const later = await h.db.selectFrom('alerts').select('escalate_at').executeTakeFirstOrThrow();
    expect(later.escalate_at!.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect((await status(a)).ownerReply).toBe('in_30_min');

    const b = await alert(code, 'damage');
    await h.app.get(DispatchService).dispatch(b.alertId);
    await reply(await replyToken(), 'coming');
    const row = await h.db
      .selectFrom('alerts')
      .select('escalate_at')
      .where('id', '=', b.alertId)
      .executeTakeFirstOrThrow();
    expect(row.escalate_at).toBeNull();
  });

  it('"Bin nicht in der Nähe" escalates at once to the confirmed contact, once, with no details', async () => {
    const { code } = await vehicleWithCode();
    await addConfirmedContact(h, OWNER, 'kim@example.de');
    const a = await alert(code, 'blocking', undefined);
    await h.app.get(DispatchService).dispatch(a.alertId);
    const r = await reply(await replyToken(), 'not_nearby');
    expect(r.json()).toEqual({ reply: 'not_nearby', escalating: true });
    const events = await h.db
      .selectFrom('outbox_events')
      .select(['topic', 'payload'])
      .where('topic', '=', ESCALATE_TOPIC)
      .execute();
    expect(events).toEqual([{ topic: ESCALATE_TOPIC, payload: { alertId: a.alertId } }]);

    const escalation = h.app.get(EscalationService);
    await escalation.run(a.alertId);
    await escalation.run(a.alertId); // replayed event
    const mails = (await mailbox(h)).filter((m) => m.tag === 'escalation');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe('kim@example.de');
    expect(mails[0]!.subject).toBe('ParkShield: Fahrzeug versperrt Ausfahrt bei „Der Blaue“');
    expect(mails[0]!.text).not.toMatch(/K-AB|owner@example\.de|antwort/);
    expect(await status(a)).toMatchObject({ status: 'escalated', ownerReply: 'not_nearby' });
  });

  it('without a contact, "Bin nicht in der Nähe" only tells the scanner', async () => {
    const { code } = await vehicleWithCode();
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect((await reply(await replyToken(), 'not_nearby')).json().escalating).toBe(false);
    expect(await status(a)).toMatchObject({ status: 'acknowledged', ownerReply: 'not_nearby' });
    const row = await h.db.selectFrom('alerts').select('escalate_at').executeTakeFirstOrThrow();
    expect(row.escalate_at).toBeNull();
  });

  it('accepts quick replies from WhatsApp buttons', async () => {
    const { s, code } = await vehicleWithCode();
    await linkWhatsApp(s);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    const token = await replyToken();
    const hook = await h.app.inject({
      method: 'POST',
      url: `/v1/webhooks/whatsapp/${TEST_WA_WEBHOOK_SECRET}`,
      payload: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '4915123456789',
                      type: 'button',
                      button: { payload: `ack:${token}:coming`, text: 'Ich komme' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    expect(hook.statusCode).toBe(200);
    expect(await status(a)).toMatchObject({ status: 'acknowledged', ownerReply: 'coming' });
  });

  it('stops working when the alert expires', async () => {
    const { code } = await vehicleWithCode();
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    const token = await replyToken();
    await sql`UPDATE alerts SET expires_at = now() - interval '1 minute', ack_token_expires_at = now() - interval '1 minute'`.execute(
      h.db,
    );
    expect((await reply(token, 'coming')).statusCode).toBe(410);
  });

  it('the reminder after "Ich warte noch" brings fresh reply buttons', async () => {
    const { code } = await vehicleWithCode();
    await addConfirmedContact(h, OWNER);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    const first = await replyToken();
    await reply(first, 'coming');
    await sql`UPDATE alerts SET acknowledged_at = now() - interval '16 minutes'`.execute(h.db);
    const w = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/waiting`,
      headers: { 'x-status-token': a.statusToken },
    });
    expect(w.statusCode).toBe(200);
    await h.app.get(DispatchService).followup(a.alertId);
    const fresh = await replyToken('alert_followup');
    expect(fresh).not.toBe(first);
    expect((await reply(fresh, 'not_nearby')).json()).toEqual({
      reply: 'not_nearby',
      escalating: true,
    });
  });
});

describe('escalation engine (NT-03, 02-architecture §3 step 8)', () => {
  it('schedules escalation only for escalating, real alerts with a confirmed contact', async () => {
    const { s, v, code } = await vehicleWithCode();
    await alert(code, 'blocking');
    await addConfirmedContact(h, OWNER);
    await alert(code, 'lights_on');
    await alert(code, 'damage');
    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/test-window`,
      headers: s.headers,
    });
    await alert(code, 'towing_risk');
    const rows = await h.db
      .selectFrom('alerts')
      .select(['alert_type', 'is_test', 'escalate_at'])
      .orderBy('created_at')
      .execute();
    expect(rows.map((r) => [r.alert_type, r.is_test, r.escalate_at !== null])).toEqual([
      ['blocking', false, false], // no contact yet
      ['lights_on', false, false], // type does not escalate
      ['damage', false, true],
      ['towing_risk', true, false], // test
    ]);
  });

  it('the sweeper escalates due alerts once and queues the contact notification', async () => {
    const { code } = await vehicleWithCode();
    const contactId = await addConfirmedContact(h, OWNER, 'kim@example.de');
    const a = await alert(code, 'blocking');
    const escalation = h.app.get(EscalationService);
    expect(await escalation.sweep()).toBe(0);
    await sql`UPDATE alerts SET escalate_at = now() - interval '1 second'`.execute(h.db);
    expect(await escalation.sweep()).toBe(1);
    expect(await escalation.sweep()).toBe(0);
    expect((await status(a)).status).toBe('escalated');
    await escalation.run(a.alertId);
    const delivery = await h.db
      .selectFrom('alert_deliveries')
      .select(['recipient', 'emergency_contact_id', 'status'])
      .where('recipient', '=', 'emergency_contact')
      .executeTakeFirstOrThrow();
    expect(delivery).toEqual({
      recipient: 'emergency_contact',
      emergency_contact_id: contactId,
      status: 'sent',
    });

    // A late reply is still accepted and shown; it does not undo the escalation.
    await h.app.get(DispatchService).dispatch(a.alertId); // status escalated: no owner dispatch now
    const late = await h.db.selectFrom('alerts').select('escalated_at').executeTakeFirstOrThrow();
    expect(late.escalated_at).not.toBeNull();
  });

  it('does not escalate when the contact withdrew before the alert fell due', async () => {
    const { code } = await vehicleWithCode();
    await addConfirmedContact(h, OWNER);
    await alert(code, 'blocking');
    await h.db.deleteFrom('emergency_contacts').execute();
    await sql`UPDATE alerts SET escalate_at = now() - interval '1 second'`.execute(h.db);
    expect(await h.app.get(EscalationService).sweep()).toBe(0);
  });

  it('accepts a late reply after escalation', async () => {
    const { code } = await vehicleWithCode();
    await addConfirmedContact(h, OWNER);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    const token = await replyToken();
    await sql`UPDATE alerts SET escalate_at = now() - interval '1 second'`.execute(h.db);
    await h.app.get(EscalationService).sweep();
    const r = await reply(token, 'coming');
    expect(r.statusCode).toBe(200);
    const s = await status(a);
    expect(s).toMatchObject({ status: 'acknowledged', ownerReply: 'coming' });
    expect(s.escalatedAt).not.toBeNull();
  });
});
