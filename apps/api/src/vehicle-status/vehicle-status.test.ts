import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  appPushes,
  createHarness,
  escalationDue,
  registerAppDevice,
  resetState,
  runEscalation,
  setSetting,
  smsInbox,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import {
  STATUS_EXPIRE_TOPIC,
  STATUS_PREWARN_TOPIC,
  VehicleStatusService,
} from './vehicle-status.service';

/**
 * „Bin gleich zurück“ (owner spec 2026-11-26): the owner's temporary status message, the scan page
 * and the scanner's „Ich warte“. The numbers in the test names are the spec's acceptance tests (§11).
 */
let h: Harness;
let crypto: FieldCrypto;
let svc: VehicleStatusService;

beforeAll(async () => {
  h = await createHarness({ VEHICLE_STATUS_ENABLED: 'true' });
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  svc = h.app.get(VehicleStatusService);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

interface Owner {
  s: Session;
  app: { authorization: string };
  vehicleId: string;
  tokenId: string;
  code: string;
}

const PLATE = 'K-XY 4711';
const LABEL = 'Der Blaue';

async function owner(email = 'brb@example.de', fcm = 'fcm-token-brb-000000000001'): Promise<Owner> {
  const s = await subscribe(h, email);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: LABEL, plate: PLATE },
    })
  ).json();
  const t = await h.db
    .selectFrom('qr_tokens')
    .select('code_enc')
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  const app = await registerAppDevice(h, email, fcm);
  return { s, app, vehicleId: v.id, tokenId: v.decal.tokenId, code: crypto.decrypt(t.code_enc) };
}

const put = (o: Owner, payload: object) =>
  h.app.inject({
    method: 'PUT',
    url: `/v1/vehicles/${o.vehicleId}/status`,
    headers: o.app,
    payload,
  });
const extend = (o: Owner) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/vehicles/${o.vehicleId}/status/extend`,
    headers: o.app,
    payload: { minutes: 5 },
  });
const getStatus = async (o: Owner) =>
  (
    await h.app.inject({ method: 'GET', url: `/v1/vehicles/${o.vehicleId}/status`, headers: o.app })
  ).json();
const scanPage = async (code: string) =>
  (await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` })).json();

let ip = 1;
const nextIp = () => `203.0.${113 + (ip % 3)}.${(ip++ % 250) + 1}`;
const waiting = (code: string, remoteAddress: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/waiting`,
    remoteAddress,
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari' },
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de' },
  });

describe('owner endpoints', () => {
  it('1: activates with defaults (first preset, 10 min) and the scan page shows it', async () => {
    const o = await owner();
    expect(await getStatus(o)).toEqual({ enabled: true, status: null });
    const res = await put(o, { presetKey: 'BACK_FEW_MIN' });
    expect(res.statusCode, res.body).toBe(200);
    const st = res.json().status;
    expect(st).toMatchObject({ presetKey: 'BACK_FEW_MIN', customText: null, durationMin: 10 });
    expect(new Date(st.expiresAt).getTime() - Date.now()).toBeGreaterThan(9.9 * 60_000);
    const page = await scanPage(o.code);
    expect(page.vehicleStatus).toMatchObject({
      presetKey: 'BACK_FEW_MIN',
      customText: null,
      minutesLeft: 10,
    });
    expect(page.alertTypes.map((a: { code: string }) => a.code)).not.toContain('waiting');
    // Both jobs are queued for this version: pre-expiry push 60 s before, expiry at expires_at.
    const jobs = await h.db
      .selectFrom('outbox_events')
      .select(['topic', 'payload', 'available_at'])
      .where('topic', 'in', [STATUS_PREWARN_TOPIC, STATUS_EXPIRE_TOPIC])
      .orderBy('available_at')
      .execute();
    expect(jobs.map((j) => j.topic)).toEqual([STATUS_PREWARN_TOPIC, STATUS_EXPIRE_TOPIC]);
    expect(jobs[1]!.available_at.getTime() - jobs[0]!.available_at.getTime()).toBe(60_000);
    expect(jobs[0]!.payload).toEqual({ vehicleId: o.vehicleId, version: 1 });
  });

  it('2: custom text: 150 graphemes pass, 151 and contact data are rejected', async () => {
    const o = await owner();
    const ok = await put(o, {
      customText: `  ${'ä'.repeat(140)}  👨‍👩‍👧 ${'b'.repeat(7)} `,
      durationMin: 5,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status.customText).toBe(`${'ä'.repeat(140)} 👨‍👩‍👧 ${'b'.repeat(7)}`);
    expect((await put(o, { customText: 'x'.repeat(151) })).json()).toMatchObject({
      error: 'text_too_long',
    });
    for (const bad of [
      'Ruf an: 0171 2345678',
      '+49 (171) 23-45-67',
      'Schreib mir: max@example.de',
      'Infos auf www.example.org',
      'https://example.com',
      'siehe parkshield.de',
      'Insta @max_muster',
    ]) {
      const r = await put(o, { customText: bad });
      expect(r.statusCode, bad).toBe(422);
      expect(r.json().error, bad).toBe('text_contact_data');
    }
    expect((await put(o, { customText: 'a\nb\nc\nd' })).json().error).toBe('text_too_many_lines');
    expect((await put(o, { customText: '   ' })).json().error).toBe('text_empty');
    expect((await put(o, { customText: 'Bin in 5 Min zurück, Parkplatz 3' })).statusCode).toBe(200);
    // Exactly one of preset and text; durations from the list only.
    expect((await put(o, { presetKey: 'LOADING', customText: 'x' })).statusCode).toBe(400);
    expect((await put(o, { presetKey: 'LOADING', durationMin: 20 })).statusCode).toBe(400);
    expect((await put(o, { presetKey: 'PARKING_OK' })).statusCode).toBe(400);
  });

  it('3: +5 Min up to the 60-min cap, then at_cap; jobs of older versions do nothing', async () => {
    const o = await owner();
    await put(o, { presetKey: 'PLEASE_WAIT', durationMin: 30 });
    let last: { expiresAt: string; canExtend: boolean } | null = null;
    for (let i = 0; i < 6; i++) {
      const r = await extend(o);
      expect(r.statusCode, r.body).toBe(200);
      last = r.json().status;
    }
    expect(new Date(last!.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(new Date(last!.expiresAt).getTime() - Date.now()).toBeGreaterThan(59.5 * 60_000);
    expect(last!.canExtend).toBe(false);
    const capped = await extend(o);
    expect(capped.statusCode).toBe(409);
    expect(capped.json().error).toBe('at_cap');
    // Version 7 now (1 + 6 extensions). The jobs of version 1 are no-ops, also once it is late.
    await sql`UPDATE vehicle_status SET expires_at = now() - interval '1 second', started_at = now() - interval '1 hour'`.execute(
      h.db,
    );
    const before = (await appPushes(h)).length;
    await svc.prewarn(o.vehicleId, 1);
    await svc.expire(o.vehicleId, 1);
    expect(await h.db.selectFrom('vehicle_status').select('version').execute()).toEqual([
      { version: 7 },
    ]);
    expect((await appPushes(h)).length).toBe(before);
    await svc.expire(o.vehicleId, 7);
    expect(await h.db.selectFrom('vehicle_status').selectAll().execute()).toEqual([]);
  });

  it('4: the scan page stops at expires_at even when the job is late; the sweep deletes and pushes silently', async () => {
    const o = await owner();
    await put(o, { presetKey: 'QUICK_ERRAND', durationMin: 5 });
    await sql`UPDATE vehicle_status SET expires_at = now() - interval '1 second', started_at = now() - interval '6 minutes'`.execute(
      h.db,
    );
    expect((await scanPage(o.code)).vehicleStatus).toBeNull();
    expect((await getStatus(o)).status).toBeNull();
    expect(await svc.sweep()).toBe(1);
    expect(await h.db.selectFrom('vehicle_status').selectAll().execute()).toEqual([]);
    const [silent] = await appPushes(h);
    expect(silent!.body.message.data).toEqual({ vehicleId: o.vehicleId, kind: 'brb_ended' });
    expect(silent!.body.message).not.toHaveProperty('notification');
    expect(silent!.body.message.apns.payload.aps).toEqual({ 'content-available': 1 });
  });

  it('5: the pre-expiry push carries „+5 Min“ / „Beenden“ (category PS_BRB) and generic text', async () => {
    const o = await owner();
    const st = (await put(o, { presetKey: 'LOADING', durationMin: 5 })).json().status;
    expect(st.canExtend).toBe(true);
    await svc.prewarn(o.vehicleId, 1);
    const [push] = await appPushes(h);
    expect(push!.body.message.notification).toEqual({
      title: 'ParkShield',
      body: 'Bin gleich zurück läuft in 1 Min ab – verlängern?',
    });
    expect(push!.body.message.data).toEqual({ vehicleId: o.vehicleId, kind: 'brb_expiring' });
    expect(push!.body.message.apns.payload.aps.category).toBe('PS_BRB');
    // The actions call the same endpoints as the app.
    expect((await extend(o)).statusCode).toBe(200);
    const end = await h.app.inject({
      method: 'DELETE',
      url: `/v1/vehicles/${o.vehicleId}/status`,
      headers: o.app,
    });
    expect(end.statusCode).toBe(200);
    expect((await getStatus(o)).status).toBeNull();
    expect((await scanPage(o.code)).vehicleStatus).toBeNull();
  });

  it('limits status changes to 30 per vehicle and hour, and checks ownership', async () => {
    const o = await owner();
    const other = await owner('other@example.de', 'fcm-token-brb-000000000002');
    const foreign = await h.app.inject({
      method: 'PUT',
      url: `/v1/vehicles/${o.vehicleId}/status`,
      headers: other.app,
      payload: { presetKey: 'BACK_FEW_MIN' },
    });
    expect(foreign.statusCode).toBe(404);
    await setSetting(h, 'ratelimit.vehicle_status.change', { max: 2, windowSeconds: 3600 });
    expect((await put(o, { presetKey: 'BACK_FEW_MIN' })).statusCode).toBe(200);
    expect((await put(o, { presetKey: 'PLEASE_WAIT' })).statusCode).toBe(200);
    expect((await put(o, { presetKey: 'LOADING' })).statusCode).toBe(429);
  });
});

describe('„Ich warte“', () => {
  it('6: notifies the owner once per scanner and status, counts in the badge, never escalates', async () => {
    const o = await owner();
    await put(o, { presetKey: 'BACK_FEW_MIN' });
    const scanner = nextIp();
    const res = await waiting(o.code, scanner);
    expect(res.statusCode, res.body).toBe(201);
    const { alertId, statusToken } = res.json();
    await h.app.get(DispatchService).dispatch(alertId);
    const [push] = await appPushes(h);
    expect(push!.body.message.notification).toEqual({
      title: 'ParkShield',
      body: 'Jemand wartet an Ihrem Fahrzeug.',
    });
    expect(push!.body.message.data).toEqual({ alertId, kind: 'alert' });

    // A second tap of the same scanner during the same status sends nothing.
    const again = await waiting(o.code, scanner);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ already: true });
    expect(await h.db.selectFrom('alerts').select('id').execute()).toHaveLength(1);
    expect((await getStatus(o)).status.waitingCount).toBe(1);

    const list = (
      await h.app.inject({ method: 'GET', url: '/v1/app/alerts', headers: o.app })
    ).json();
    expect(list.unseenCount).toBe(1);
    expect(list.alerts[0]).toMatchObject({ id: alertId, type: { code: 'waiting' } });

    // No reminder push, no SMS, ever.
    const a = await h.db
      .selectFrom('alerts')
      .select(['remind_at', 'sms_due_at', 'custom_message_enc'])
      .where('id', '=', alertId)
      .executeTakeFirstOrThrow();
    expect(a).toEqual({ remind_at: null, sms_due_at: null, custom_message_enc: null });
    await sql`UPDATE alerts SET created_at = now() - interval '40 minutes'`.execute(h.db);
    await escalationDue(h);
    expect(await runEscalation(h)).toEqual({ reminders: 0, sms: 0 });
    expect(await smsInbox(h)).toEqual([]);

    // „Ich komme“ reaches the scanner live (status endpoint).
    const ack = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${alertId}/ack`,
      headers: o.app,
      payload: { reply: 'coming' },
    });
    expect(ack.statusCode, ack.body).toBe(200);
    const seen = await h.app.inject({
      method: 'GET',
      url: `/v1/alerts/${alertId}/status`,
      headers: { 'x-status-token': statusToken },
    });
    expect(seen.json()).toMatchObject({
      status: 'acknowledged',
      ownerReply: 'coming',
      type: 'waiting',
    });

    // A new status is a new session: the same scanner may signal again.
    await put(o, { presetKey: 'PLEASE_WAIT' });
    expect((await waiting(o.code, scanner)).statusCode).toBe(201);
    expect((await getStatus(o)).status.waitingCount).toBe(1);
  });

  it('6: counts toward the alert limits; without a status it answers no_status', async () => {
    const o = await owner();
    expect((await waiting(o.code, nextIp())).json()).toEqual({ error: 'no_status' });
    await put(o, { presetKey: 'BACK_FEW_MIN' });
    await setSetting(h, 'ratelimit.alert.vehicle', { max: 1, windowSeconds: 86_400 });
    expect((await waiting(o.code, nextIp())).statusCode).toBe(201);
    const limited = await waiting(o.code, nextIp());
    expect(limited.statusCode).toBe(429);
    expect(limited.json().limit).toBe('alert.vehicle');
    // The normal alert route never takes the type.
    const direct = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${o.code}/alerts`,
      remoteAddress: nextIp(),
      payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'waiting' },
    });
    expect(direct.statusCode).toBe(400);
  });

  it('7: a normal alert during an active status escalates exactly as before', async () => {
    const o = await owner();
    await put(o, { presetKey: 'BACK_FEW_MIN' });
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${o.code}/alerts`,
      remoteAddress: nextIp(),
      payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'blocking' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const a = await h.db
      .selectFrom('alerts')
      .select(['remind_at', 'sms_due_at'])
      .executeTakeFirstOrThrow();
    expect(a.remind_at).not.toBeNull();
    expect(a.sms_due_at).not.toBeNull();
    expect((await getStatus(o)).status.waitingCount).toBe(0);
  });
});

describe('ending and independence', () => {
  it('8: „Sperren“, the end of the subscription and deleting the vehicle remove the status at once', async () => {
    const o = await owner();
    await put(o, { presetKey: 'BACK_FEW_MIN' });
    const revoke = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${o.vehicleId}/tokens/revoke`,
      headers: o.s.headers,
      payload: { confirm: true, reason: 'leaked' },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect(await h.db.selectFrom('vehicle_status').selectAll().execute()).toEqual([]);
    // No code: no status (the scan page shows the inactive state).
    expect((await put(o, { presetKey: 'BACK_FEW_MIN' })).json().error).toBe('vehicle_inactive');

    const p = await owner('sub@example.de', 'fcm-token-brb-000000000003');
    await put(p, { presetKey: 'BACK_FEW_MIN' });
    await sql`UPDATE subscriptions SET status = 'expired' FROM users WHERE users.id = subscriptions.user_id AND users.email = 'sub@example.de'`.execute(
      h.db,
    );
    expect(await h.db.selectFrom('vehicle_status').selectAll().execute()).toEqual([]);
    expect((await put(p, { presetKey: 'BACK_FEW_MIN' })).json().error).toBe(
      'subscription_inactive',
    );

    const q = await owner('del@example.de', 'fcm-token-brb-000000000004');
    await put(q, { presetKey: 'BACK_FEW_MIN' });
    await h.db.deleteFrom('vehicles').where('id', '=', q.vehicleId).execute();
    expect(await h.db.selectFrom('vehicle_status').selectAll().execute()).toEqual([]);
  });

  it('9 + 10: two vehicles are independent; no push carries the plate or the label', async () => {
    const a = await owner('a@example.de', 'fcm-token-brb-00000000000a');
    const b = await owner('b@example.de', 'fcm-token-brb-00000000000b');
    await put(a, { customText: 'Hole nur kurz die Post.', durationMin: 15 });
    expect((await scanPage(b.code)).vehicleStatus).toBeNull();
    expect((await scanPage(a.code)).vehicleStatus).toMatchObject({
      customText: 'Hole nur kurz die Post.',
      presetKey: null,
      minutesLeft: 15,
    });
    const w = await waiting(a.code, nextIp());
    await h.app.get(DispatchService).dispatch(w.json().alertId);
    await svc.prewarn(a.vehicleId, 1);
    await h.app.inject({
      method: 'DELETE',
      url: `/v1/vehicles/${a.vehicleId}/status`,
      headers: a.app,
    });
    await put(b, { presetKey: 'LOADING', durationMin: 5 });
    await sql`UPDATE vehicle_status SET expires_at = now() - interval '1 second', started_at = now() - interval '6 minutes'`.execute(
      h.db,
    );
    await svc.sweep();
    const all = JSON.stringify(await appPushes(h));
    expect(all).not.toContain('XY');
    expect(all).not.toContain(LABEL);
    expect(all).not.toContain('Post');
  });

  it('is off without VEHICLE_STATUS_ENABLED', async () => {
    const off = await createHarness({ VEHICLE_STATUS_ENABLED: 'false' });
    try {
      const o = await owner();
      const got = await off.app.inject({
        method: 'GET',
        url: `/v1/vehicles/${o.vehicleId}/status`,
        headers: o.app,
      });
      expect(got.json()).toEqual({ enabled: false, status: null });
      const set = await off.app.inject({
        method: 'PUT',
        url: `/v1/vehicles/${o.vehicleId}/status`,
        headers: o.app,
        payload: { presetKey: 'BACK_FEW_MIN' },
      });
      expect(set.statusCode).toBe(404);
      expect(set.json().error).toBe('feature_disabled');
      expect(
        (await off.app.inject({ method: 'GET', url: `/v1/scan/${o.code}` })).json().vehicleStatus,
      ).toBeNull();
    } finally {
      await off.close();
    }
  });
});
