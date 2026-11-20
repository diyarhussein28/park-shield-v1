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
  appPushes,
  appSignIn,
  createHarness,
  enableEscalation,
  linkSmsDirect,
  mailbox,
  makePremium,
  resetState,
  setSetting,
  smsInbox,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { DispatchService } from './dispatch.service';
import { ESCALATE_TOPIC, EscalationService } from './escalation.service';
import { OwnerReminderService, REMIND_TOPIC } from './owner-reminder.service';

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

/** The reply token from the newest alert e-mail (it travels in the URL fragment). */
async function replyToken(tag = 'alert_received') {
  const mail = (await mailbox(h)).find((m) => m.tag === tag);
  const m = /\/antwort\?r=coming#t=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '');
  if (!m) throw new Error(`no reply link in ${tag}`);
  return m[1]!;
}
const reply = (token: string, r: string) =>
  h.app.inject({ method: 'POST', url: '/v1/ack', payload: { token, reply: r } });

/** An app device of the owner (FCM fake: tokens starting with "invalid" are gone). */
async function registerApp(token = 'fcm-token-phone-0000000001') {
  const app = await appSignIn(h, OWNER);
  const r = await h.app.inject({
    method: 'POST',
    url: '/v1/app/devices/register',
    headers: app,
    payload: { fcmToken: token, platform: 'ios', appVersion: '1.0.0', locale: 'de' },
  });
  expect(r.statusCode).toBe(200);
  return app;
}

/** PREMIUM owner with escalation switched on and three confirmed contacts, in order. */
async function premiumWithContacts(n = 3) {
  await makePremium(h, OWNER);
  await enableEscalation(h, OWNER);
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    ids.push(
      await addConfirmedContact(h, OWNER, `kontakt${i}@example.de`, null, {
        name: `Kontakt ${i}`,
        phone: `+4915100000${i}0${i}`,
        order: i,
      }),
    );
  }
  return ids;
}

const due = () =>
  sql`UPDATE alerts SET escalate_at = now() - interval '1 second'
  WHERE escalate_at IS NOT NULL`.execute(h.db);

/** Runs the sweeper and the queued escalation events, like the worker. */
async function escalateNow() {
  const escalation = h.app.get(EscalationService);
  const n = await escalation.sweep();
  const events = await h.db
    .selectFrom('outbox_events')
    .select(['id', 'payload'])
    .where('topic', '=', ESCALATE_TOPIC)
    .where('processed_at', 'is', null)
    .execute();
  for (const e of events) {
    await escalation.run(e.payload as Record<string, unknown>);
    await h.db
      .updateTable('outbox_events')
      .set({ processed_at: new Date() })
      .where('id', '=', e.id)
      .execute();
  }
  return n;
}

const contactDeliveries = (alertId: string) =>
  h.db
    .selectFrom('alert_deliveries as d')
    .leftJoin('emergency_contacts as c', 'c.id', 'd.emergency_contact_id')
    .select(['d.channel', 'd.status', 'd.escalation_step', 'c.display_name'])
    .where('d.alert_id', '=', alertId)
    .where('d.recipient', '=', 'emergency_contact')
    .orderBy('d.queued_at')
    .execute();

describe('channel matrix (tiered notifications)', () => {
  it('PLUS: push (app and browser) and e-mail at once, never SMS, never WhatsApp', async () => {
    const { s, code } = await vehicleWithCode();
    await registerPush(s, `${pushBase}/ok/1`);
    await registerApp();
    await linkSmsDirect(h, OWNER);
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect(pushed).toEqual(['/ok/1']);
    expect((await ownerChannels(a.alertId)).map((d) => `${d.channel}:${d.status}`)).toEqual([
      'native_push:sent',
      'webpush:sent',
      'email:sent',
    ]);
    expect(await smsInbox(h)).toHaveLength(0);
  });

  it('PREMIUM: push, e-mail and SMS at once', async () => {
    const { s, code } = await vehicleWithCode();
    await makePremium(h, OWNER);
    await registerPush(s, `${pushBase}/ok/1`);
    await registerApp();
    await linkSmsDirect(h, OWNER);
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect((await ownerChannels(a.alertId)).map((d) => `${d.channel}:${d.status}`)).toEqual([
      'native_push:sent',
      'webpush:sent',
      'email:sent',
      'sms:sent',
    ]);
    const sms = (await smsInbox(h))[0]!;
    expect(sms.body.length).toBeLessThanOrEqual(160);
    expect(sms.body).toMatch(/Details: .*\/v\/[A-Za-z0-9_-]{43}$/);
  });

  it('keeps going when one channel fails or is switched off', async () => {
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

  it('the app push carries no message text, photo, plate, nickname or name', async () => {
    const { code } = await vehicleWithCode();
    await registerApp();
    const a = await alert(code, 'custom', 'Ihr Licht brennt, Herr Meier');
    await h.app.get(DispatchService).dispatch(a.alertId);
    const push = (await appPushes(h))[0]!.body.message;
    expect(push.notification).toEqual({
      title: 'ParkShield',
      body: 'Neuer Alarm für Ihr Fahrzeug: Eigene Nachricht',
    });
    expect(push.data).toEqual({ alertId: a.alertId, type: 'custom', kind: 'alert' });
    expect(JSON.stringify(push)).not.toMatch(/Meier|Licht|Der Blaue|K-AB|owner@example|jpg|\/v\//);
    expect(push.apns.headers['apns-push-type']).toBe('alert');
    expect(push.apns.payload.aps.category).toBe('PS_ALERT');
    expect(push.android).toMatchObject({ priority: 'NORMAL' });
    // E-mail carries the time, the filtered message and the view link, no attachment.
    const mail = (await mailbox(h)).find((m) => m.tag === 'alert_received')!;
    expect(mail.text).toContain('Ihr Licht brennt, Herr Meier');
    expect(mail.text).toMatch(/Details & Fotos ansehen: http.*\/v\/[A-Za-z0-9_-]{43}/);
  });

  it('removes an app device FCM reports as unregistered', async () => {
    const { code } = await vehicleWithCode();
    await registerApp('invalid-token-0000000000001');
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect(await h.db.selectFrom('user_devices').selectAll().execute()).toHaveLength(0);
    expect((await ownerChannels(a.alertId))[0]).toMatchObject({
      channel: 'native_push',
      status: 'failed',
    });
  });

  it('follows the owner’s order for the sequence; the order has no WhatsApp', async () => {
    const { s } = await vehicleWithCode();
    const overview = await h.app.inject({ method: 'GET', url: '/v1/channels', headers: s.headers });
    expect(overview.json().order).toEqual(['native_push', 'webpush', 'email', 'sms']);
    const bad = await h.app.inject({
      method: 'PUT',
      url: '/v1/channels/order',
      headers: s.headers,
      payload: { order: ['email', 'webpush', 'whatsapp', 'sms'] },
    });
    expect(bad.statusCode).toBe(400);
    const saved = await h.app.inject({
      method: 'PUT',
      url: '/v1/channels/order',
      headers: s.headers,
      payload: { order: ['email', 'sms', 'webpush', 'native_push'] },
    });
    expect(saved.json().order).toEqual(['email', 'sms', 'webpush', 'native_push']);
  });
});

describe('quick replies and „Ich komme" (US-23, NT-02, NT-10)', () => {
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
    expect(await status(a)).toMatchObject({
      status: 'acknowledged',
      ownerReply: 'coming',
      acknowledgedBy: 'owner',
    });

    const again = await reply(token, 'not_nearby');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already_answered', reply: 'coming' });
    expect((await reply('x'.repeat(43), 'coming')).statusCode).toBe(404);
  });

  it('"seen" in the app is not an answer; "Ich komme" in the app is, once', async () => {
    const { code } = await vehicleWithCode();
    const app = await registerApp();
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    const seen = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/seen`,
      headers: app,
    });
    expect(seen.statusCode).toBe(200);
    expect(await status(a)).toMatchObject({ status: 'delivered', ownerReply: null });
    expect((await status(a)).seenAt).not.toBeNull();
    const ack = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/ack`,
      headers: app,
      payload: {},
    });
    expect(ack.json()).toEqual({ reply: 'coming', escalating: false });
    const twice = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/ack`,
      headers: app,
      payload: {},
    });
    expect(twice.statusCode).toBe(409);
    // The e-mail link is spent too.
    expect((await reply(await replyToken(), 'coming')).statusCode).toBe(409);
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
    await premiumWithContacts(1);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    const first = await replyToken();
    await reply(first, 'in_30_min');
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
    expect((await reply(fresh, 'coming')).json()).toEqual({ reply: 'coming', escalating: false });
  });
});

describe('owner reminder (all plans; PREMIUM also by SMS)', () => {
  it('sends a second push after 3 minutes; "seen" does not stop it, an answer does', async () => {
    const { code } = await vehicleWithCode();
    const app = await registerApp();
    const reminders = h.app.get(OwnerReminderService);
    const a = await alert(code);
    const row = await h.db.selectFrom('alerts').select('remind_at').executeTakeFirstOrThrow();
    expect(row.remind_at!.getTime()).toBeGreaterThan(Date.now() + 2.5 * 60_000);
    expect(row.remind_at!.getTime()).toBeLessThan(Date.now() + 3.5 * 60_000);
    await h.app.get(DispatchService).dispatch(a.alertId);
    await h.app.inject({ method: 'POST', url: `/v1/app/alerts/${a.alertId}/seen`, headers: app });

    expect(await reminders.sweep()).toBe(0);
    await sql`UPDATE alerts SET remind_at = now() - interval '1 second'`.execute(h.db);
    expect(await reminders.sweep()).toBe(1);
    expect(await reminders.sweep()).toBe(0); // never twice
    const events = await h.db
      .selectFrom('outbox_events')
      .select('payload')
      .where('topic', '=', REMIND_TOPIC)
      .execute();
    expect(events).toEqual([{ payload: { alertId: a.alertId } }]);
    await h.app.get(DispatchService).remind(a.alertId);
    await h.app.get(DispatchService).remind(a.alertId); // replay
    const pushes = (await appPushes(h)).filter((p) => p.body.message.data.kind === 'reminder');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.body.message.notification.body).toBe(
      'Erinnerung: Licht brennt noch. Bitte reagieren Sie.',
    );
    // With a push device, no reminder e-mail.
    expect((await mailbox(h)).filter((m) => m.tag === 'alert_reminder')).toHaveLength(0);

    // An answered alert gets no reminder.
    const b = await alert(code, 'lights_on', undefined);
    await h.app.get(DispatchService).dispatch(b.alertId);
    await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${b.alertId}/ack`,
      headers: app,
      payload: {},
    });
    await sql`UPDATE alerts SET remind_at = now() - interval '1 second' WHERE id = ${b.alertId}`.execute(
      h.db,
    );
    expect(await reminders.sweep()).toBe(0);
  });

  it('without any push device: e-mail with the hint; PREMIUM: a second SMS, at most 2 per alert', async () => {
    const { code } = await vehicleWithCode();
    await makePremium(h, OWNER);
    await linkSmsDirect(h, OWNER);
    const a = await alert(code, 'blocking');
    const dispatch = h.app.get(DispatchService);
    await dispatch.dispatch(a.alertId);
    await sql`UPDATE alerts SET remind_at = now() - interval '1 second'`.execute(h.db);
    await h.app.get(OwnerReminderService).sweep();
    await dispatch.remind(a.alertId);
    const mail = (await mailbox(h)).find((m) => m.tag === 'alert_reminder')!;
    expect(mail.text).toContain('Sie haben keine App mit aktivierten Mitteilungen');
    const sms = await smsInbox(h);
    expect(sms.map((m) => m.tag)).toEqual(['sms_reminder', 'sms_alert']);
    expect(sms[0]!.body.length).toBeLessThanOrEqual(160);
    // A third SMS (the follow-up) is not sent: max 2 per alert to the owner.
    await reply(await replyToken(), 'in_30_min');
    await sql`UPDATE alerts SET acknowledged_at = now() - interval '16 minutes'`.execute(h.db);
    await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/waiting`,
      headers: { 'x-status-token': a.statusToken },
    });
    await dispatch.followup(a.alertId);
    expect((await smsInbox(h)).filter((m) => m.tag.startsWith('sms_'))).toHaveLength(2);
  });
});

describe('escalation to trusted contacts (PREMIUM, NT-03)', () => {
  it('never for PLUS: no escalate_at, and the API answers 403', async () => {
    const { s, code } = await vehicleWithCode();
    await enableEscalation(h, OWNER);
    await addConfirmedContact(h, OWNER);
    await alert(code, 'blocking');
    const row = await h.db.selectFrom('alerts').select('escalate_at').executeTakeFirstOrThrow();
    expect(row.escalate_at).toBeNull();
    for (const url of ['/v1/app/escalation', '/v1/escalation']) {
      const r = await h.app.inject({ method: 'GET', url, headers: s.headers });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toBe('premium_required');
    }
    const invite = await h.app.inject({
      method: 'POST',
      url: '/v1/app/emergency-contacts',
      headers: s.headers,
      payload: { name: 'Kim', phone: '0151 11111111', ownerName: 'Max' },
    });
    expect(invite.statusCode).toBe(403);
  });

  it('only for escalating types, switched on, with a confirmed contact, not for tests', async () => {
    const { s, v, code } = await vehicleWithCode();
    await makePremium(h, OWNER);
    await addConfirmedContact(h, OWNER);
    await alert(code, 'blocking'); // switched off (default)
    await enableEscalation(h, OWNER);
    await alert(code, 'lights_on');
    await alert(code, 'window_open');
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
      ['blocking', false, false], // escalation off
      ['lights_on', false, false], // type does not escalate
      ['window_open', false, true],
      ['towing_risk', true, false], // test
    ]);
  });

  it('escalates contact 1 → 2 → 3 with the delay, once each, by SMS and e-mail without details', async () => {
    const { code } = await vehicleWithCode();
    await premiumWithContacts(3);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect(await escalateNow()).toBe(0); // not due yet
    await due();
    expect(await escalateNow()).toBe(1);
    expect(await escalateNow()).toBe(0); // next step only after the delay
    let rows = await h.db
      .selectFrom('alerts')
      .select(['escalation_step', 'escalate_at'])
      .executeTakeFirstOrThrow();
    expect(rows.escalation_step).toBe(1);
    expect(rows.escalate_at!.getTime()).toBeGreaterThan(Date.now() + 6 * 60_000);
    await due();
    await escalateNow();
    await due();
    await escalateNow();
    await due();
    expect(await escalateNow()).toBe(0); // the chain ends after contact 3
    rows = await h.db
      .selectFrom('alerts')
      .select(['escalation_step', 'escalate_at'])
      .executeTakeFirstOrThrow();
    expect(rows).toEqual({ escalation_step: 3, escalate_at: null });
    const d = await contactDeliveries(a.alertId);
    expect(d.map((x) => `${x.escalation_step}:${x.display_name}:${x.channel}:${x.status}`)).toEqual(
      [
        '1:Kontakt 1:sms:sent',
        '1:Kontakt 1:email:sent',
        '2:Kontakt 2:sms:sent',
        '2:Kontakt 2:email:sent',
        '3:Kontakt 3:sms:sent',
        '3:Kontakt 3:email:sent',
      ],
    );
    const sms = (await smsInbox(h)).filter((m) => m.tag === 'sms_escalation');
    expect(sms).toHaveLength(3);
    for (const m of sms) {
      expect(m.body.length).toBeLessThanOrEqual(160);
      expect(m.body).toMatch(/\/k\/[A-Za-z0-9_-]{43}$/);
      expect(m.body).not.toMatch(/K-AB|Meier|owner@example/);
    }
    const mail = (await mailbox(h)).find((m) => m.tag === 'escalation')!;
    expect(mail.subject).toBe('ParkShield: Fahrzeug versperrt Ausfahrt bei „Der Blaue“');
    expect(mail.text).toContain('Keine Benachrichtigungen mehr erhalten');
    expect(mail.text).not.toMatch(/K-AB|owner@example\.de|antwort|\/v\//);
    expect(await status(a)).toMatchObject({ status: 'escalated' });
  });

  it('the first „Ich komme" (a contact) stops the chain; the owner sees who', async () => {
    const { code } = await vehicleWithCode();
    await premiumWithContacts(3);
    const app = await registerApp();
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    await due();
    await escalateNow();
    const link = /\/k\/([A-Za-z0-9_-]{43})/.exec(
      (await smsInbox(h)).find((m) => m.tag === 'sms_escalation')!.body,
    )![1]!;
    const preview = await h.app.inject({
      method: 'POST',
      url: '/v1/contacts/alert/preview',
      payload: { token: link },
    });
    expect(preview.json()).toMatchObject({ nickname: 'Der Blaue', acknowledged: false });
    expect(JSON.stringify(preview.json())).not.toMatch(/K-AB|owner@example/);
    const ack = await h.app.inject({
      method: 'POST',
      url: '/v1/contacts/alert/ack',
      payload: { token: link },
    });
    expect(ack.statusCode).toBe(200);
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/v1/contacts/alert/ack',
          payload: { token: link },
        })
      ).statusCode,
    ).toBe(409);
    expect(await status(a)).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'contact' });
    await due();
    expect(await escalateNow()).toBe(0);
    const detail = (
      await h.app.inject({ method: 'GET', url: `/v1/app/alerts/${a.alertId}`, headers: app })
    ).json();
    expect(detail.acknowledgedBy).toEqual({ kind: 'contact', name: 'Kontakt 1' });
    // The owner's own "Ich komme" is spent now too.
    expect((await reply(await replyToken(), 'coming')).statusCode).toBe(409);
  });

  it('the owner’s „Ich komme" after the chain started stops it', async () => {
    const { code } = await vehicleWithCode();
    await premiumWithContacts(2);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    await due();
    await escalateNow();
    expect((await reply(await replyToken(), 'coming')).statusCode).toBe(200);
    await due();
    expect(await escalateNow()).toBe(0);
    expect((await contactDeliveries(a.alertId)).every((d) => d.escalation_step === 1)).toBe(true);
  });

  it('"Bin nicht in der Nähe" starts the chain at once; "In ca. 30 Min" postpones it', async () => {
    const { code } = await vehicleWithCode();
    await premiumWithContacts(1);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect((await reply(await replyToken(), 'not_nearby')).json()).toEqual({
      reply: 'not_nearby',
      escalating: true,
    });
    const events = await h.db
      .selectFrom('outbox_events')
      .select(['topic', 'payload'])
      .where('topic', '=', ESCALATE_TOPIC)
      .execute();
    expect(events).toEqual([{ topic: ESCALATE_TOPIC, payload: { alertId: a.alertId } }]);
    await h.app.get(EscalationService).run({ alertId: a.alertId });
    await h.app.get(EscalationService).run({ alertId: a.alertId }); // replay
    expect((await contactDeliveries(a.alertId)).map((d) => d.channel)).toEqual(['sms', 'email']);

    const b = await alert(code, 'damage');
    await h.app.get(DispatchService).dispatch(b.alertId);
    await reply(await replyToken(), 'in_30_min');
    const later = await h.db
      .selectFrom('alerts')
      .select('escalate_at')
      .where('id', '=', b.alertId)
      .executeTakeFirstOrThrow();
    expect(later.escalate_at!.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
  });

  it('switching escalation off cancels pending steps; on applies to new alerts', async () => {
    const { s, code } = await vehicleWithCode();
    await premiumWithContacts(1);
    const a = await alert(code, 'blocking');
    const off = await h.app.inject({
      method: 'PUT',
      url: '/v1/escalation',
      headers: s.headers,
      payload: { enabled: false },
    });
    expect(off.json()).toMatchObject({ available: true, enabled: false });
    const row = await h.db
      .selectFrom('alerts')
      .select('escalate_at')
      .where('id', '=', a.alertId)
      .executeTakeFirstOrThrow();
    expect(row.escalate_at).toBeNull();
    await h.app.inject({
      method: 'PUT',
      url: '/v1/escalation',
      headers: s.headers,
      payload: { enabled: true, delayMinutes: 12 },
    });
    await alert(code, 'blocking');
    const rows = await h.db
      .selectFrom('alerts')
      .select('escalate_at')
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(rows.escalate_at!.getTime()).toBeGreaterThan(Date.now() + 11 * 60_000);
    // Per vehicle: off for this vehicle only.
    const settings = (
      await h.app.inject({ method: 'GET', url: '/v1/escalation', headers: s.headers })
    ).json();
    await h.app.inject({
      method: 'PUT',
      url: '/v1/escalation',
      headers: s.headers,
      payload: { vehicles: [{ id: settings.vehicles[0].id, enabled: false }] },
    });
    await alert(code, 'blocking');
    const last = await h.db
      .selectFrom('alerts')
      .select('escalate_at')
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(last.escalate_at).toBeNull();
  });

  it('never escalates to pending, declined or deactivated contacts', async () => {
    const { code } = await vehicleWithCode();
    const [id] = await premiumWithContacts(1);
    await h.db.updateTable('emergency_contacts').set({ consent: 'pending' }).execute();
    const a = await alert(code, 'blocking');
    expect(
      (await h.db.selectFrom('alerts').select('escalate_at').executeTakeFirstOrThrow()).escalate_at,
    ).toBeNull();
    await h.db.updateTable('emergency_contacts').set({ consent: 'confirmed' }).execute();
    await sql`UPDATE alerts SET escalate_at = now()`.execute(h.db);
    await h.db
      .updateTable('emergency_contacts')
      .set({ deactivated_at: new Date() })
      .where('id', '=', id!)
      .execute();
    await due();
    expect(await escalateNow()).toBe(0);
    expect(await contactDeliveries(a.alertId)).toHaveLength(0);
  });

  it('a downgrade to PLUS stops escalation at once (checked at escalation time)', async () => {
    const { code } = await vehicleWithCode();
    await premiumWithContacts(1);
    const a = await alert(code, 'blocking');
    await h.db.updateTable('subscriptions').set({ plan: 'plus' }).execute();
    await due();
    expect(await escalateNow()).toBe(0);
    expect(await contactDeliveries(a.alertId)).toHaveLength(0);
  });

  it('the sweeper recovers a step whose job got lost (e.g. Valkey restart), never twice', async () => {
    const { code } = await vehicleWithCode();
    await premiumWithContacts(1);
    await alert(code, 'blocking');
    await h.valkey.flushdb();
    await due();
    const escalation = h.app.get(EscalationService);
    const [one, two] = await Promise.all([escalation.sweep(), escalation.sweep()]);
    expect(one + two).toBe(1);
  });

  it('opt-out from an escalation message deletes the contact and tells the owner', async () => {
    const { code } = await vehicleWithCode();
    await premiumWithContacts(1);
    const a = await alert(code, 'blocking');
    await due();
    await escalateNow();
    const link = /\/k\/([A-Za-z0-9_-]{43})/.exec(
      (await smsInbox(h)).find((m) => m.tag === 'sms_escalation')!.body,
    )![1]!;
    const r = await h.app.inject({
      method: 'POST',
      url: '/v1/contacts/opt-out',
      payload: { token: link },
    });
    expect(r.statusCode).toBe(200);
    expect(await h.db.selectFrom('emergency_contacts').selectAll().execute()).toHaveLength(0);
    const mail = (await mailbox(h)).find((m) => m.tag === 'ec_decided')!;
    expect(mail.to).toBe(OWNER);
    expect(a.alertId).toBeTruthy();
  });
});
