import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatService } from '../chat/chat.service';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  appPushes,
  createHarness,
  escalationDue,
  mailbox,
  registerAppDevice,
  resetState,
  runEscalation,
  setSetting,
  smsInbox,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { DispatchService } from './dispatch.service';
import { OwnerReminderService, SMS_ESCALATE_TOPIC } from './owner-reminder.service';

/**
 * Escalation to the owner (owner decision 2026-11-21): app push at once, a reminder push after
 * 10 minutes, ONE SMS after 30 minutes. Never an e-mail. Any reaction (ack, reply, chat, resolve, block)
 * cancels both steps; merely viewing the alert does not.
 */
let h: Harness;
let crypto: FieldCrypto;

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const OWNER = 'owner@example.de';

interface Setup {
  s: Session;
  app: { authorization: string };
  vehicleId: string;
  code: string;
}

async function setup(): Promise<Setup> {
  const s = await subscribe(h, OWNER);
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
  const app = await registerAppDevice(h, OWNER);
  return { s, app, vehicleId: v.id, code: crypto.decrypt(t.code_enc) };
}

let ipCounter = 1;
const nextIp = () => `198.51.${100 + (ipCounter++ % 100)}.${(ipCounter % 200) + 1}`;

async function alert(code: string, type = 'lights_on', ip = nextIp()) {
  const res = await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: ip,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type },
  });
  expect(res.statusCode, res.body).toBe(201);
  const a = res.json() as { alertId: string; statusToken: string; chatToken: string };
  await h.app.get(DispatchService).dispatch(a.alertId);
  return a;
}

const row = (alertId: string) =>
  h.db
    .selectFrom('alerts')
    .select([
      'status',
      'remind_at',
      'reminded_at',
      'sms_due_at',
      'sms_sent_at',
      'escalation_stage',
      'escalation_stopped_at',
      'escalation_stop_reason',
    ])
    .where('id', '=', alertId)
    .executeTakeFirstOrThrow();

const reminderPushes = async (alertId?: string) =>
  (await appPushes(h)).filter(
    (p) =>
      p.body.message.data.kind === 'reminder' &&
      (!alertId || p.body.message.data.alertId === alertId),
  );
const escalationSms = async () => (await smsInbox(h)).filter((m) => m.tag === 'sms_escalation');
const alertMails = async () => (await mailbox(h)).filter((m) => m.tag.startsWith('alert_'));

const smsDeliveries = (alertId: string) =>
  h.db
    .selectFrom('alert_deliveries')
    .select(['status', 'suppressed_reason'])
    .where('alert_id', '=', alertId)
    .where('channel', '=', 'sms')
    .execute();

describe('escalation timing', () => {
  it('a new alert is due for the reminder after 10 minutes and the SMS after 30 minutes', async () => {
    const { code } = await setup();
    const a = await alert(code);
    const r = await row(a.alertId);
    const minutes = (d: Date | null) => (d!.getTime() - Date.now()) / 60_000;
    expect(minutes(r.remind_at)).toBeGreaterThan(9.5);
    expect(minutes(r.remind_at)).toBeLessThan(10.5);
    expect(minutes(r.sms_due_at)).toBeGreaterThan(29.5);
    expect(minutes(r.sms_due_at)).toBeLessThan(30.5);
    expect(r.escalation_stage).toBe('none');
    // Nothing is due yet.
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
  });

  it('reads the delays from the settings', async () => {
    const { code } = await setup();
    await setSetting(h, 'escalation.reminder_minutes', 5);
    await setSetting(h, 'escalation.sms_minutes', 15);
    const a = await alert(code);
    const r = await row(a.alertId);
    expect(Math.round((r.remind_at!.getTime() - Date.now()) / 60_000)).toBe(5);
    expect(Math.round((r.sms_due_at!.getTime() - Date.now()) / 60_000)).toBe(15);
  });
});

describe('reminder push after 10 minutes', () => {
  it('is one generic push, also after a replay; "seen" does not stop it; no e-mail', async () => {
    const { code, app } = await setup();
    const a = await alert(code);
    const seen = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/seen`,
      headers: app,
    });
    expect(seen.statusCode).toBe(200);

    await escalationDue(h, 'reminder');
    expect(await runEscalation(h)).toEqual({ reminders: 1, sms: 0 });
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 }); // never twice
    await h.app.get(DispatchService).remind(a.alertId); // replayed outbox event
    const pushes = await reminderPushes(a.alertId);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.body.message.data).toEqual({ alertId: a.alertId, kind: 'reminder' });
    expect(pushes[0]!.body.message.notification).toEqual({
      title: 'ParkShield',
      body: 'Erinnerung: Eine Warnung wartet auf Ihre Reaktion.',
    });
    const r = await row(a.alertId);
    expect(r).toMatchObject({ escalation_stage: 'reminder_sent', remind_at: null });
    expect(r.reminded_at).toBeInstanceOf(Date);
    // The SMS step is still pending.
    expect(r.sms_due_at).not.toBeNull();
    expect(await alertMails()).toHaveLength(0);
    expect(await smsInbox(h)).toHaveLength(0);
  });
});

describe('one SMS after 30 minutes', () => {
  it('sends exactly one SMS, also when swept twice and the outbox event is replayed', async () => {
    const { code } = await setup();
    const a = await alert(code, 'blocking');
    await escalationDue(h);
    expect(await runEscalation(h)).toEqual({ reminders: 1, sms: 1 });
    expect(await h.app.get(OwnerReminderService).sweepSms()).toBe(0);
    // A replayed outbox event and a stray second event change nothing.
    await h.app.get(DispatchService).escalateSms(a.alertId);
    await h.db
      .insertInto('outbox_events')
      .values({ topic: SMS_ESCALATE_TOPIC, payload: JSON.stringify({ alertId: a.alertId }) })
      .execute();
    await runEscalation(h);

    const sms = await escalationSms();
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({ to: '+4915123456789' });
    expect(sms[0]!.body).toMatch(/^ParkShield, seit 30 Min keine Reaktion: /);
    expect(sms[0]!.body).toMatch(/\/v\/[A-Za-z0-9_-]{43}$/);
    expect(sms[0]!.body.length).toBeLessThanOrEqual(160);
    const r = await row(a.alertId);
    expect(r).toMatchObject({ escalation_stage: 'sms_sent', sms_due_at: null });
    expect(r.sms_sent_at).toBeInstanceOf(Date);
    expect(await smsDeliveries(a.alertId)).toEqual([{ status: 'sent', suppressed_reason: null }]);
    // Never an e-mail: not for the alert, the reminder or the SMS.
    expect(await alertMails()).toHaveLength(0);
  });

  it('the sweeper recovers steps whose due time passed long ago (worker was down)', async () => {
    const { code } = await setup();
    const a = await alert(code);
    await sql`UPDATE alerts SET remind_at = now() - interval '50 minutes',
      sms_due_at = now() - interval '30 minutes' WHERE id = ${a.alertId}`.execute(h.db);
    expect(await runEscalation(h)).toEqual({ reminders: 1, sms: 1 });
    expect(await reminderPushes(a.alertId)).toHaveLength(1);
    expect(await escalationSms()).toHaveLength(1);
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
  });

  it('an expired alert escalates no more', async () => {
    const { code } = await setup();
    const a = await alert(code);
    await escalationDue(h);
    await sql`UPDATE alerts SET expires_at = now() - interval '1 minute' WHERE id = ${a.alertId}`.execute(
      h.db,
    );
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
    expect(await escalationSms()).toHaveLength(0);
  });

  it('the monthly SMS cap suppresses further SMS with reason fair_use, without an e-mail', async () => {
    const { s, code } = await setup();
    await setSetting(h, 'sms.monthly_cap', 1);
    const first = await alert(code, 'blocking');
    const second = await alert(code, 'lights_on');
    await escalationDue(h, 'sms');
    expect((await runEscalation(h)).sms).toBe(2);
    expect(await escalationSms()).toHaveLength(1);
    const outcomes = [
      ...(await smsDeliveries(first.alertId)),
      ...(await smsDeliveries(second.alertId)),
    ];
    expect(outcomes).toContainEqual({ status: 'sent', suppressed_reason: null });
    expect(outcomes).toContainEqual({ status: 'suppressed', suppressed_reason: 'fair_use' });
    expect(await mailbox(h).then((m) => m.filter((x) => x.tag.startsWith('fair_use')))).toEqual([]);
    const usage = (
      await h.app.inject({ method: 'GET', url: '/v1/me/usage', headers: s.headers })
    ).json();
    expect(usage.sms).toEqual({ used: 1, limit: 1, capReached: true });
  });

  it('never during quiet hours, not even for an urgent alert (the push still goes out)', async () => {
    const { s, code } = await setup();
    const q = await h.app.inject({
      method: 'POST',
      url: '/v1/quiet-hours',
      headers: s.headers,
      payload: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00', urgentBypass: true },
    });
    expect(q.statusCode).toBe(201);
    const a = await alert(code, 'blocking');
    const pushed = (await appPushes(h)).filter((p) => p.body.message.data.alertId === a.alertId);
    expect(pushed).toHaveLength(1); // urgent: the push passes quiet hours
    await escalationDue(h, 'sms');
    expect((await runEscalation(h)).sms).toBe(1);
    await h.app.get(DispatchService).escalateSms(a.alertId); // replay records nothing twice
    expect(await escalationSms()).toHaveLength(0);
    expect(await smsDeliveries(a.alertId)).toEqual([
      { status: 'suppressed', suppressed_reason: 'quiet_hours' },
    ]);
  });

  it('a test alert gets the reminder push but never an SMS', async () => {
    const { s, code, vehicleId } = await setup();
    const w = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${vehicleId}/test-window`,
      headers: s.headers,
    });
    expect(w.statusCode).toBeLessThan(300);
    const a = await alert(code);
    const r = await row(a.alertId);
    expect(r.remind_at).not.toBeNull();
    expect(r.sms_due_at).toBeNull();
    // Even with a due time forced into the past, the sweeper skips test alerts.
    await sql`UPDATE alerts SET remind_at = now() - interval '1 second',
      sms_due_at = now() - interval '1 second' WHERE id = ${a.alertId}`.execute(h.db);
    expect(await runEscalation(h)).toEqual({ reminders: 1, sms: 0 });
    await h.app.get(DispatchService).escalateSms(a.alertId);
    expect(await reminderPushes(a.alertId)).toHaveLength(1);
    expect(await smsInbox(h)).toHaveLength(0);
  });
});

describe('stop conditions cancel the reminder and the SMS', () => {
  type Stop = (x: Setup, a: { alertId: string }) => Promise<void>;
  const post = (x: Setup, url: string, payload?: object) =>
    h.app.inject({ method: 'POST', url, headers: x.app, ...(payload ? { payload } : {}) });

  const stops: [string, Stop, string][] = [
    [
      '„Ich komme“',
      async (x, a) => {
        expect((await post(x, `/v1/app/alerts/${a.alertId}/ack`, {})).statusCode).toBe(200);
      },
      'acknowledged',
    ],
    [
      'the reply „In ca. 30 Min“',
      async (x, a) => {
        const r = await post(x, `/v1/app/alerts/${a.alertId}/ack`, { reply: 'in_30_min' });
        expect(r.json()).toEqual({ reply: 'in_30_min', escalating: false });
      },
      'replied',
    ],
    [
      'opening the chat',
      async (x, a) => {
        expect((await post(x, `/v1/app/alerts/${a.alertId}/chat/open`)).statusCode).toBe(200);
      },
      'chat_opened',
    ],
    [
      'marking it resolved',
      async (x, a) => {
        expect((await post(x, `/v1/app/alerts/${a.alertId}/resolve`)).statusCode).toBe(200);
      },
      'resolved',
    ],
    [
      'blocking the sender',
      async (x, a) => {
        expect((await post(x, `/v1/app/alerts/${a.alertId}/block`)).statusCode).toBe(200);
      },
      'blocked',
    ],
  ];

  for (const [name, stop, reason] of stops) {
    it(`${name} cancels both steps (reason ${reason})`, async () => {
      const x = await setup();
      const a = await alert(x.code, 'blocking');
      await stop(x, a);
      const r = await row(a.alertId);
      expect(r).toMatchObject({
        remind_at: null,
        sms_due_at: null,
        escalation_stop_reason: reason,
      });
      expect(r.escalation_stopped_at).toBeInstanceOf(Date);
      // Even a due time written back (e.g. a racing writer) is ignored once stopped.
      await sql`UPDATE alerts SET remind_at = now() - interval '1 second',
        sms_due_at = now() - interval '1 second' WHERE id = ${a.alertId}`.execute(h.db);
      expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
      expect(await reminderPushes(a.alertId)).toHaveLength(0);
      expect(await escalationSms()).toHaveLength(0);
    });
  }

  it('an owner message in the chat is a stop condition too', async () => {
    const x = await setup();
    const a = await alert(x.code, 'blocking');
    expect((await post(x, `/v1/app/alerts/${a.alertId}/chat/open`)).statusCode).toBe(200);
    // Undo what opening did, to see the message rule on its own.
    await sql`UPDATE alerts SET escalation_stopped_at = NULL, escalation_stop_reason = NULL,
      remind_at = now() + interval '10 minutes', sms_due_at = now() + interval '30 minutes'
      WHERE id = ${a.alertId}`.execute(h.db);
    const sent = await h.app.get(ChatService).send(a.alertId, 'owner', 'Ich bin gleich da.');
    expect(sent.ok).toBe(true);
    expect(await row(a.alertId)).toMatchObject({
      remind_at: null,
      sms_due_at: null,
      escalation_stop_reason: 'replied',
    });
    await escalationDue(h);
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
  });

  it('a stop after the reminder still cancels the SMS; the first reason is kept', async () => {
    const x = await setup();
    const a = await alert(x.code);
    await escalationDue(h, 'reminder');
    expect(await runEscalation(h)).toEqual({ reminders: 1, sms: 0 });
    await post(x, `/v1/app/alerts/${a.alertId}/resolve`);
    await post(x, `/v1/app/alerts/${a.alertId}/ack`, {});
    expect(await row(a.alertId)).toMatchObject({
      escalation_stage: 'reminder_sent',
      sms_due_at: null,
      escalation_stop_reason: 'resolved',
    });
    await escalationDue(h, 'sms');
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
    expect(await escalationSms()).toHaveLength(0);
  });

  it('viewing alone („gesehen“) does not stop either step', async () => {
    const x = await setup();
    const a = await alert(x.code);
    await post(x, `/v1/app/alerts/${a.alertId}/seen`);
    const detail = await h.app.inject({
      method: 'GET',
      url: `/v1/app/alerts/${a.alertId}`,
      headers: x.app,
    });
    expect(detail.statusCode).toBe(200);
    const r = await row(a.alertId);
    expect(r.escalation_stopped_at).toBeNull();
    await escalationDue(h);
    expect(await runEscalation(h)).toEqual({ reminders: 1, sms: 1 });
    expect(await escalationSms()).toHaveLength(1);
  });
});

describe('„Absender blockieren“ (Stage 3)', () => {
  it('locks the chat at once, cancels the escalation and blocks the scanner for this vehicle', async () => {
    const x = await setup();
    const ip = '203.0.113.50';
    const a = await alert(x.code, 'blocking', ip);
    const chat = h.app.get(ChatService);
    expect((await chat.state(a.alertId, 'scanner'))?.status).toBe('locked');

    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/block`,
      headers: x.app,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ blocked: true, chatClosed: true });

    // The chat is closed even though the owner never opened it; the scanner cannot write any more.
    expect(await chat.state(a.alertId, 'scanner')).toMatchObject({
      status: 'closed',
      closeReason: 'blocked',
    });
    expect(await chat.send(a.alertId, 'scanner', 'Hallo?')).toEqual({
      ok: false,
      error: 'chat_not_active',
    });
    // Escalation cancelled: the sweepers send nothing.
    expect(await row(a.alertId)).toMatchObject({
      remind_at: null,
      sms_due_at: null,
      escalation_stop_reason: 'blocked',
    });
    await sql`UPDATE alerts SET remind_at = now() - interval '1 second',
      sms_due_at = now() - interval '1 second' WHERE id = ${a.alertId}`.execute(h.db);
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });

    // The abuse module: a report and a per-vehicle scanner block (no identifier stored in clear).
    const report = await h.db
      .selectFrom('abuse_reports')
      .select(['reason', 'kind'])
      .where('alert_id', '=', a.alertId)
      .executeTakeFirstOrThrow();
    expect(report).toEqual({ reason: 'blocked', kind: 'owner_report' });
    expect(await h.db.selectFrom('scanner_blocks').selectAll().execute()).toHaveLength(1);
    const again = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${x.code}/alerts`,
      remoteAddress: ip,
      payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'lights_on' },
    });
    expect(again.statusCode).toBe(403);
    // Another person can still alert.
    await alert(x.code);

    // A second block is harmless.
    const twice = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/block`,
      headers: x.app,
    });
    expect(twice.statusCode).toBe(200);
    expect(twice.json()).toMatchObject({ blocked: true, chatClosed: false });
    expect(await h.db.selectFrom('scanner_blocks').selectAll().execute()).toHaveLength(1);
    expect(
      await h.db
        .selectFrom('abuse_reports')
        .select('id')
        .where('alert_id', '=', a.alertId)
        .execute(),
    ).toHaveLength(1);
  });

  it('works from the web portal too, and only for the owner', async () => {
    const x = await setup();
    const a = await alert(x.code);
    const other = await subscribe(h, 'other@example.de');
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/block`,
      headers: other.headers,
    });
    expect(foreign.statusCode).toBe(404);
    expect((await row(a.alertId)).escalation_stopped_at).toBeNull();
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/block`,
      headers: x.s.headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await row(a.alertId)).toMatchObject({ escalation_stop_reason: 'blocked' });
    expect(await h.app.get(ChatService).state(a.alertId, 'owner')).toMatchObject({
      status: 'closed',
      closeReason: 'blocked',
    });
  });

  it('the portal report („Absender blockieren“ in the history) closes the chat and stops too', async () => {
    const x = await setup();
    const ip = '203.0.113.60';
    const a = await alert(x.code, 'blocking', ip);
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/report`,
      headers: x.s.headers,
      payload: { reason: 'harassment' },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    expect(res.json()).toMatchObject({ reported: true, blocked: true });
    expect(await h.app.get(ChatService).state(a.alertId, 'scanner')).toMatchObject({
      status: 'closed',
      closeReason: 'blocked',
    });
    expect(await row(a.alertId)).toMatchObject({
      remind_at: null,
      sms_due_at: null,
      escalation_stop_reason: 'blocked',
    });
    await sql`UPDATE alerts SET remind_at = now() - interval '1 second',
      sms_due_at = now() - interval '1 second' WHERE id = ${a.alertId}`.execute(h.db);
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
    // The same scanner cannot alert this vehicle again.
    const again = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${x.code}/alerts`,
      remoteAddress: ip,
      payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'lights_on' },
    });
    expect(again.statusCode).toBe(403);
    // A second report is refused, the block action after it is harmless.
    const twice = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/report`,
      headers: x.s.headers,
      payload: { reason: 'harassment' },
    });
    expect(twice.statusCode).toBe(409);
    const block = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/block`,
      headers: x.s.headers,
    });
    expect(block.statusCode).toBe(200);
    expect(await h.db.selectFrom('scanner_blocks').selectAll().execute()).toHaveLength(1);
  });

  it('a test alert is closed and stopped, but nothing is reported to the abuse module', async () => {
    const x = await setup();
    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${x.vehicleId}/test-window`,
      headers: x.s.headers,
    });
    const a = await alert(x.code);
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/block`,
      headers: x.app,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ blocked: true, phoneBanned: false, protectedMode: false });
    expect(await row(a.alertId)).toMatchObject({ escalation_stop_reason: 'blocked' });
    expect(await h.db.selectFrom('abuse_reports').selectAll().execute()).toHaveLength(0);
    expect(await h.db.selectFrom('scanner_blocks').selectAll().execute()).toHaveLength(0);
  });
});
