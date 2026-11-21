import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { FairUseService } from '../notifications/fair-use.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import { ViewTokenService } from '../alert-media/view-token.service';
import {
  appPushes,
  createHarness,
  escalationDue,
  linkSmsDirect,
  mailbox,
  registerAppDevice,
  runEscalation,
  smsInbox,
  resetState,
  setSetting,
  signIn,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { RemindersService } from './reminders.service';

let h: Harness;
let crypto: FieldCrypto;
beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const OWNER = 'owner@example.de';

/** A paying owner (verified number) with a vehicle and, unless `device` is false, the app. */
async function vehicleWithCode(email = OWNER, device = true) {
  const s = await subscribe(h, email);
  if (device) await registerAppDevice(h, email);
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

let ip = 1;
async function alert(code: string, type = 'lights_on') {
  const res = await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: `198.51.${100 + (ip++ % 100)}.7`,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { alertId: string; statusToken: string };
}

const ownerDeliveries = (alertId: string) =>
  h.db
    .selectFrom('alert_deliveries')
    .select(['channel', 'status', 'suppressed_reason'])
    .where('alert_id', '=', alertId)
    .where('recipient', '=', 'owner')
    .orderBy('queued_at')
    .execute();
const alertMails = async () => (await mailbox(h)).filter((m) => m.tag === 'alert_received');
const quiet = (s: Session, payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: '/v1/quiet-hours', headers: s.headers, payload });
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

describe('quiet hours (US-26, OW-06)', () => {
  it('mutes normal alerts and records them; urgent ones come through by default', async () => {
    const { s, code } = await vehicleWithCode();
    const added = await quiet(s, { days: ALL_DAYS, start: '00:00', end: '00:00' });
    expect(added.statusCode).toBe(201);
    expect(added.json().rules[0]).toMatchObject({
      days: ALL_DAYS,
      start: '00:00',
      urgentBypass: true,
    });

    const normal = await alert(code);
    const dispatch = h.app.get(DispatchService);
    await dispatch.dispatch(normal.alertId);
    await dispatch.dispatch(normal.alertId); // replay records nothing twice
    // Recorded once, on the first channel of the owner's order (the app comes first).
    expect(await ownerDeliveries(normal.alertId)).toEqual([
      { channel: 'native_push', status: 'suppressed', suppressed_reason: 'quiet_hours' },
    ]);
    expect(await alertMails()).toHaveLength(0);
    const a = await h.db
      .selectFrom('alerts')
      .select('status')
      .where('id', '=', normal.alertId)
      .executeTakeFirstOrThrow();
    expect(a.status).toBe('dispatched'); // kept, not delivered: it appears in the history

    const urgent = await alert(code, 'blocking');
    await dispatch.dispatch(urgent.alertId);
    expect((await ownerDeliveries(urgent.alertId)).some((d) => d.status === 'sent')).toBe(true);
  });

  it('mutes urgent alerts too when the owner turns the bypass off; tests are never muted', async () => {
    const { s, v, code } = await vehicleWithCode();
    await quiet(s, { days: ALL_DAYS, start: '00:00', end: '00:00', urgentBypass: false });
    const urgent = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(urgent.alertId);
    expect((await ownerDeliveries(urgent.alertId))[0]?.suppressed_reason).toBe('quiet_hours');

    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/test-window`,
      headers: s.headers,
    });
    const test = await alert(code);
    await h.app.get(DispatchService).dispatch(test.alertId);
    expect((await appPushes(h)).some((p) => p.body.message.data.kind === 'test')).toBe(true);
  });

  it('during quiet hours neither the reminder push nor the SMS is sent; the alert is kept', async () => {
    const { s, code } = await vehicleWithCode();
    await quiet(s, { days: ALL_DAYS, start: '00:00', end: '00:00', urgentBypass: false });
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    await escalationDue(h);
    expect(await runEscalation(h)).toEqual({ reminders: 1, sms: 1 });
    expect(await appPushes(h)).toHaveLength(0);
    expect(await smsInbox(h)).toHaveLength(0);
    expect(await ownerDeliveries(a.alertId)).toEqual([
      { channel: 'native_push', status: 'suppressed', suppressed_reason: 'quiet_hours' },
      { channel: 'sms', status: 'suppressed', suppressed_reason: 'quiet_hours' },
    ]);
  });

  it('validates rules, keeps them private and limits their number', async () => {
    const { s } = await vehicleWithCode();
    expect((await quiet(s, { days: [], start: '22:00', end: '07:00' })).statusCode).toBe(400);
    expect((await quiet(s, { days: [0], start: '25:00', end: '07:00' })).statusCode).toBe(400);
    for (let i = 0; i < 7; i++) {
      expect((await quiet(s, { days: [i], start: '22:00', end: '07:00' })).statusCode).toBe(201);
    }
    const eighth = await quiet(s, { days: [0], start: '12:00', end: '13:00' });
    expect(eighth.statusCode).toBe(409);
    const { rules } = (
      await h.app.inject({ method: 'GET', url: '/v1/quiet-hours', headers: s.headers })
    ).json();
    const other = await signIn(h, 'other@example.de');
    const del = (sess: Session) =>
      h.app.inject({
        method: 'DELETE',
        url: `/v1/quiet-hours/${rules[0].id}`,
        headers: sess.headers,
      });
    expect((await del(other)).statusCode).toBe(404);
    expect((await del(s)).statusCode).toBe(200);
  });
});

describe('temporary modes (US-26, OW-17)', () => {
  const startMode = (s: Session, vehicleId: string, payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${vehicleId}/mode`,
      headers: s.headers,
      payload,
    });

  it('"sensitive spot" lets only urgent alerts through', async () => {
    const { s, v, code } = await vehicleWithCode();
    const r = await startMode(s, v.id, { mode: 'sensitive_spot', minutes: 120 });
    expect(r.json().mode).toMatchObject({ mode: 'sensitive_spot' });
    const normal = await alert(code);
    await h.app.get(DispatchService).dispatch(normal.alertId);
    expect((await ownerDeliveries(normal.alertId))[0]?.suppressed_reason).toBe('sensitive_spot');
    const urgent = await alert(code, 'damage');
    await h.app.get(DispatchService).dispatch(urgent.alertId);
    expect((await ownerDeliveries(urgent.alertId)).some((d) => d.status === 'sent')).toBe(true);
  });

  it('"short stop" shows the return time to scanners; one mode at a time, at most 12 h', async () => {
    const { s, v, code } = await vehicleWithCode();
    expect((await startMode(s, v.id, { mode: 'short_stop', minutes: 721 })).statusCode).toBe(400);
    await startMode(s, v.id, { mode: 'sensitive_spot', minutes: 60 });
    const r = await startMode(s, v.id, { mode: 'short_stop', minutes: 30 });
    const endsAt = new Date(r.json().mode.endsAt).getTime();
    expect(endsAt - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(endsAt - Date.now()).toBeLessThan(31 * 60_000);
    const page = (await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` })).json();
    expect(new Date(page.backAt).getTime()).toBe(endsAt);
    expect(await h.db.selectFrom('vehicle_modes').selectAll().execute()).toHaveLength(1);

    const end = await h.app.inject({
      method: 'DELETE',
      url: `/v1/vehicles/${v.id}/mode`,
      headers: s.headers,
    });
    expect(end.json()).toEqual({ mode: null });
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` })).json().backAt,
    ).toBeNull();
    const other = await signIn(h, 'other@example.de');
    expect((await startMode(other, v.id, { mode: 'short_stop', minutes: 30 })).statusCode).toBe(
      404,
    );
  });
});

describe('fair use (US-27, NT-05): the monthly SMS safety cap', () => {
  it('counts escalation SMS per month and above `sms.monthly_cap` suppresses them, without e-mail', async () => {
    await setSetting(h, 'sms.monthly_cap', 5);
    const { s, code } = await vehicleWithCode();
    const results: string[] = [];
    for (let i = 0; i < 7; i++) {
      const a = await alert(code, 'blocking');
      await h.app.get(DispatchService).dispatch(a.alertId);
      await escalationDue(h, 'sms', a.alertId);
      await runEscalation(h);
      const sms = (await ownerDeliveries(a.alertId)).find((d) => d.channel === 'sms')!;
      results.push(sms.status === 'sent' ? 'sent' : `${sms.status}:${sms.suppressed_reason}`);
    }
    expect(results).toEqual([
      'sent',
      'sent',
      'sent',
      'sent',
      'sent',
      'suppressed:fair_use',
      'suppressed:fair_use',
    ]);
    expect((await smsInbox(h)).filter((m) => m.tag === 'sms_escalation')).toHaveLength(5);
    // Since 2026-11-21 the cap is shown in the app and logged, never mailed.
    const mails = await mailbox(h);
    expect(mails.filter((m) => m.tag.startsWith('fair_use'))).toHaveLength(0);
    const usage = await h.app.inject({ method: 'GET', url: '/v1/me/usage', headers: s.headers });
    expect(usage.json()).toEqual({ sms: { used: 5, limit: 5, capReached: true } });
  });

  it('cannot be overshot by concurrent alerts, and a failed send gives the unit back', async () => {
    await setSetting(h, 'sms.monthly_cap', 5);
    await subscribe(h, OWNER);
    const user = await h.db.selectFrom('users').select('id').executeTakeFirstOrThrow();
    const fair = h.app.get(FairUseService);
    const owner = { id: user.id, email: OWNER, lang: 'de' as const };
    const granted = await Promise.all(Array.from({ length: 12 }, () => fair.reserve(owner, 'sms')));
    expect(granted.filter(Boolean)).toHaveLength(5);
    await fair.release(user.id, 'sms');
    expect(await fair.reserve(owner, 'sms')).toBe(true);
    expect(await fair.reserve(owner, 'sms')).toBe(false);
  });
});

describe('resilience (US-25)', () => {
  it('keeps working after a Valkey restart: reply links and escalation live in PostgreSQL', async () => {
    const { code } = await vehicleWithCode();
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    const view = h.app.get(ViewTokenService).tokenFor(a.alertId);
    const token = (
      await h.app.inject({ method: 'GET', url: `/v1/alerts/view/${view}` })
    ).json().replyToken as string;

    await h.valkey.flushdb(); // what a restart without persistence looks like

    const preview = await h.app.inject({
      method: 'POST',
      url: '/v1/ack/preview',
      payload: { token },
    });
    expect(preview.json()).toMatchObject({ answered: false });
    await h.app.get(DispatchService).dispatch(a.alertId); // a retry after the restart reuses the link
    await escalationDue(h, 'reminder');
    await h.valkey.flushdb();
    expect(await runEscalation(h)).toEqual({ reminders: 1, sms: 0 });
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 }); // never twice
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/v1/ack',
          payload: { token, reply: 'in_30_min' },
        })
      ).statusCode,
    ).toBe(200);
    // The reply stopped the SMS step.
    await escalationDue(h, 'sms');
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
    const again = await h.app.inject({
      method: 'POST',
      url: '/v1/ack',
      payload: { token, reply: 'coming' },
    });
    expect(again.json()).toMatchObject({ error: 'already_answered', reply: 'in_30_min' });
  });
});

describe('protection score (US-28, OW-14)', () => {
  it('four steps of 25 %: e-mail, app, verified mobile number, tested decal', async () => {
    const { s, v, code } = await vehicleWithCode(OWNER, false);
    const score = async () =>
      (await h.app.inject({ method: 'GET', url: '/v1/me/protection', headers: s.headers })).json();
    await h.db.deleteFrom('contact_channels').execute();
    expect(await score()).toEqual({
      percent: 25,
      steps: { email: true, channel: false, phone: false, decal: false },
    });
    await registerAppDevice(h, OWNER);
    expect(await score()).toMatchObject({ percent: 50, steps: { channel: true } });
    await linkSmsDirect(h, OWNER);
    expect(await score()).toMatchObject({ percent: 75, steps: { phone: true } });
    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/test-window`,
      headers: s.headers,
    });
    await alert(code);
    expect(await score()).toEqual({
      percent: 100,
      steps: { email: true, channel: true, phone: true, decal: true },
    });
  });
});

describe('reminders and summaries (US-29, US-30)', () => {
  async function delivered(tokenId: string, userEmail: string, daysAgo: number) {
    const user = await h.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', userEmail)
      .executeTakeFirstOrThrow();
    const order = await h.db
      .insertInto('decal_orders')
      .values({
        user_id: user.id,
        status: 'delivered',
        shipping_address_enc: crypto.encrypt('{}'),
        total_gross_cents: 0,
        delivered_at: sql`now() - make_interval(days => ${daysAgo})`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('decal_order_items')
      .values({
        order_id: order.id,
        product: 'uv_vinyl_sticker',
        qr_token_id: tokenId,
        unit_gross_cents: 0,
      })
      .execute();
    return order.id;
  }
  const reminderMails = async (tag: string) => (await mailbox(h)).filter((m) => m.tag === tag);

  it('sends activation reminders at 3, 7 and 14 days, at most 3, never once tested', async () => {
    const { v } = await vehicleWithCode();
    const orderId = await delivered(v.decal.tokenId, OWNER, 2);
    const reminders = h.app.get(RemindersService);
    await reminders.activation();
    expect(await reminderMails('activation_reminder')).toHaveLength(0);
    await h.db
      .updateTable('decal_orders')
      .set({ delivered_at: sql`now() - interval '4 days'` })
      .where('id', '=', orderId)
      .execute();
    await reminders.activation();
    await reminders.activation();
    expect(await reminderMails('activation_reminder')).toHaveLength(1);
    // Far overdue: one reminder, not two at once.
    await h.db
      .updateTable('decal_orders')
      .set({ delivered_at: sql`now() - interval '15 days'` })
      .where('id', '=', orderId)
      .execute();
    await reminders.activation();
    await reminders.activation();
    expect(await reminderMails('activation_reminder')).toHaveLength(2);
    const u = await h.db
      .selectFrom('users')
      .select('activation_reminders')
      .executeTakeFirstOrThrow();
    expect(u.activation_reminders).toBe(3);
  });

  it('does not remind about a decal that was tested', async () => {
    const { v } = await vehicleWithCode();
    await delivered(v.decal.tokenId, OWNER, 5);
    await h.db
      .updateTable('qr_tokens')
      .set({ last_test_at: sql`now()` })
      .execute();
    await h.app.get(RemindersService).activation();
    expect(await reminderMails('activation_reminder')).toHaveLength(0);
  });

  it('suggests a test scan after 11 months without a scan, once per silence', async () => {
    await vehicleWithCode();
    await h.db
      .updateTable('qr_tokens')
      .set({
        activated_at: sql`now() - interval '12 months'`,
        assigned_at: sql`now() - interval '12 months'`,
        last_scanned_at: null,
      })
      .execute();
    const reminders = h.app.get(RemindersService);
    await reminders.decalHealth();
    await reminders.decalHealth();
    expect(await reminderMails('decal_health')).toHaveLength(1);
    expect((await reminderMails('decal_health'))[0]?.subject).toBe(
      'Funktioniert Ihr Aufkleber an „Der Blaue“ noch?',
    );
    // Scanned since, then silent again for 11 months: one more reminder.
    await h.db
      .updateTable('qr_tokens')
      .set({
        last_scanned_at: sql`now() - interval '11 months 1 day'`,
        health_reminded_at: sql`now() - interval '12 months'`,
      })
      .execute();
    await reminders.decalHealth();
    expect(await reminderMails('decal_health')).toHaveLength(2);
  });

  it('sends the monthly summary once per period, weekly on request, never when off', async () => {
    const { s, code } = await vehicleWithCode();
    await alert(code);
    await alert(code, 'blocking');
    const reminders = h.app.get(RemindersService);
    await reminders.summaries();
    expect(await reminderMails('summary')).toHaveLength(0); // signed up today
    await sql`UPDATE users SET created_at = now() - interval '32 days'`.execute(h.db);
    await sql`UPDATE alerts SET created_at = now() - interval '1 day'`.execute(h.db);
    await reminders.summaries();
    await reminders.summaries();
    const [summary] = await reminderMails('summary');
    expect(summary?.text).toContain('2 Warnungen');
    // PLUS: three applicable steps (trusted contacts are PREMIUM only), one done.
    expect(summary?.text).toContain('Ihr Schutz: 75 %');
    expect(await reminderMails('summary')).toHaveLength(1);

    await h.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: s.headers,
      payload: { summaryFrequency: 'weekly' },
    });
    await sql`UPDATE users SET last_summary_at = now() - interval '8 days'`.execute(h.db);
    await reminders.summaries();
    expect(await reminderMails('summary')).toHaveLength(2);
    await h.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: s.headers,
      payload: { summaryFrequency: 'off' },
    });
    await sql`UPDATE users SET last_summary_at = now() - interval '40 days'`.execute(h.db);
    await reminders.summaries();
    expect(await reminderMails('summary')).toHaveLength(2);
  });

  it('rejects an unknown time zone', async () => {
    const s = await signIn(h, OWNER);
    const bad = await h.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: s.headers,
      payload: { timezone: 'Mars/Olympus' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await h.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: s.headers,
      payload: { timezone: 'Europe/Vienna' },
    });
    expect(ok.statusCode).toBe(200);
  });
});
