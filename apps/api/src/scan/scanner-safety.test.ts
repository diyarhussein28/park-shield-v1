import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  addConfirmedContact,
  createHarness,
  lastMail,
  resetState,
  setSetting,
  subscribe,
  type Harness,
} from '../test/harness';
import { FOLLOWUP_TOPIC } from './scan.service';

let h: Harness;
let crypto: FieldCrypto;
beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const UA = {
  'user-agent':
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
};

async function vehicle(email: string, nickname = 'Der Blaue') {
  const s = await subscribe(h, email);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname, plate: 'K-AB 1234', color: 'Blau' },
    })
  ).json();
  const t = await h.db
    .selectFrom('qr_tokens')
    .select('code_enc')
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  return { s, v, code: crypto.decrypt(t.code_enc) };
}

const send = (code: string, payload: Record<string, unknown> = {}, ip = '203.0.113.7') =>
  h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    headers: UA,
    remoteAddress: ip,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'lights_on', ...payload },
  });
const status = (id: string, token: string) =>
  h.app.inject({
    method: 'GET',
    url: `/v1/alerts/${id}/status`,
    headers: { 'x-status-token': token },
  });
const waiting = (id: string, token: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/alerts/${id}/waiting`,
    headers: { 'x-status-token': token },
  });

describe('the three scanner limits (US-17)', () => {
  it('allows one alert per scanner and vehicle per 15 minutes and says how long to wait', async () => {
    const { code } = await vehicle('a@example.de');
    expect((await send(code)).statusCode).toBe(201);
    const second = await send(code, { type: 'blocking' });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: 'rate_limited', limit: 'alert.scanner_vehicle' });
    expect(second.json().retryAfterSeconds).toBeGreaterThan(800);
    expect(second.json().retryAfterSeconds).toBeLessThanOrEqual(900);
    // Someone else (another network) can still alert the same car.
    expect((await send(code, {}, '198.51.100.20')).statusCode).toBe(201);
  });

  it('limits one scanner across vehicles, all or nothing', async () => {
    await setSetting(h, 'ratelimit.alert.scanner_global', { max: 2, windowSeconds: 3600 });
    const a = await vehicle('a@example.de', 'A');
    const b = await vehicle('b@example.de', 'B');
    const c = await vehicle('c@example.de', 'C');
    expect((await send(a.code)).statusCode).toBe(201);
    expect((await send(b.code)).statusCode).toBe(201);
    const third = await send(c.code);
    expect(third.statusCode).toBe(429);
    expect(third.json().limit).toBe('alert.scanner_global');
    // The rejected attempt did not count against vehicle C: another scanner's alert there is fine,
    // and C's own per-vehicle counter is still at zero.
    const keys = await h.valkey.keys('rl:alert.vehicle:*');
    const counts = await Promise.all(keys.map((k) => h.valkey.get(k)));
    expect(counts.map(Number).sort()).toEqual([1, 1]);
  });

  it('limits alerts per vehicle from everyone', async () => {
    await setSetting(h, 'ratelimit.alert.vehicle', { max: 2, windowSeconds: 86_400 });
    const { code } = await vehicle('a@example.de');
    expect((await send(code, {}, '198.51.100.1')).statusCode).toBe(201);
    expect((await send(code, {}, '198.51.101.1')).statusCode).toBe(201);
    const third = await send(code, {}, '198.51.102.1');
    expect(third.statusCode).toBe(429);
    expect(third.json().limit).toBe('alert.vehicle');
  });

  it('does not count blocked messages, and test alerts are exempt', async () => {
    const { s, v, code } = await vehicle('a@example.de');
    const blocked = await send(code, { type: 'custom', message: 'Ruf an: 0171 2345678' });
    expect(blocked.statusCode).toBe(422);
    expect((await send(code)).statusCode).toBe(201);

    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/test-window`,
      headers: s.headers,
    });
    const test = await send(code);
    expect(test.statusCode).toBe(201);
    expect((await status(test.json().alertId, test.json().statusToken)).json().isTest).toBe(true);
  });

  it('never stores the full IP, only the country, which is gone after 24 h', async () => {
    const { code } = await vehicle('a@example.de');
    const res = await send(code, {}, '85.214.132.117');
    const s = (await status(res.json().alertId, res.json().statusToken)).json();
    expect(s.country).toBe('DE');
    const row = await h.db.selectFrom('alerts').selectAll().executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain('85.214');
    await sql`UPDATE alerts SET created_at = now() - interval '25 hours'`.execute(h.db);
    await sql`SELECT run_retention()`.execute(h.db);
    const after = await h.db
      .selectFrom('alerts')
      .select(['scanner_country', 'scanner_ref'])
      .executeTakeFirstOrThrow();
    expect(after).toEqual({ scanner_country: null, scanner_ref: null });
  });
});

describe('"Ich warte noch" and the owner reminder (US-18, SC-14, NT-09)', () => {
  async function acknowledged(minutesAgo: number, type = 'blocking', contact = true) {
    const { code } = await vehicle('owner@example.de');
    if (contact) await addConfirmedContact(h, 'owner@example.de');
    const res = await send(code, { type });
    const { alertId, statusToken } = res.json();
    await h.db
      .updateTable('alerts')
      .set({
        status: 'acknowledged',
        acknowledged_at: sql`now() - make_interval(mins => ${minutesAgo})`,
      })
      .where('id', '=', alertId)
      .execute();
    return { alertId, statusToken };
  }

  it('is offered 15 minutes after acknowledgement, not before', async () => {
    const early = await acknowledged(5);
    const s = (await status(early.alertId, early.statusToken)).json();
    expect(new Date(s.waitingAvailableAt).getTime()).toBeGreaterThan(Date.now());
    const res = await waiting(early.alertId, early.statusToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not_available_yet');
  });

  it('sends one reminder, works once, and brings escalation forward to at most 5 minutes', async () => {
    const { alertId, statusToken } = await acknowledged(16);
    expect((await waiting(alertId, 'wrong')).statusCode).toBe(404);
    expect((await waiting(alertId, statusToken)).statusCode).toBe(200);
    const again = await waiting(alertId, statusToken);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_sent');

    const alert = await h.db
      .selectFrom('alerts')
      .select(['scanner_waiting_at', 'escalate_at'])
      .executeTakeFirstOrThrow();
    expect(alert.scanner_waiting_at).not.toBeNull();
    expect(alert.escalate_at!.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 2000);
    const events = await h.db.selectFrom('outbox_events').select(['topic', 'payload']).execute();
    expect(events.filter((e) => e.topic === FOLLOWUP_TOPIC)).toEqual([
      { topic: FOLLOWUP_TOPIC, payload: { alertId } },
    ]);

    // Without push or WhatsApp, the reminder goes by e-mail, exactly once.
    const dispatch = h.app.get(DispatchService);
    await dispatch.followup(alertId);
    await dispatch.followup(alertId);
    const mail = await lastMail(h, 'alert_followup');
    expect(mail?.subject).toBe('Erinnerung: Jemand wartet an „Der Blaue“');
    const s = (await status(alertId, statusToken)).json();
    expect(s.waitingAvailableAt).toBeNull();
    expect(s.waitingSentAt).not.toBeNull();
  });

  it('does not invent an escalation for types that never escalate', async () => {
    const { alertId, statusToken } = await acknowledged(16, 'lights_on');
    expect((await waiting(alertId, statusToken)).statusCode).toBe(200);
    const a = await h.db.selectFrom('alerts').select('escalate_at').executeTakeFirstOrThrow();
    expect(a.escalate_at).toBeNull();
  });

  it('does not schedule an escalation without a confirmed emergency contact', async () => {
    const { alertId, statusToken } = await acknowledged(16, 'blocking', false);
    expect((await waiting(alertId, statusToken)).statusCode).toBe(200);
    const a = await h.db.selectFrom('alerts').select('escalate_at').executeTakeFirstOrThrow();
    expect(a.escalate_at).toBeNull();
  });
});

describe('suspicious decal report (US-19, SC-15)', () => {
  it('lands in the abuse centre with the code, without personal data, and is limited', async () => {
    const { v, code } = await vehicle('a@example.de');
    const report = (note?: string) =>
      h.app.inject({
        method: 'POST',
        url: `/v1/scan/${code}/report-fake`,
        headers: UA,
        remoteAddress: '203.0.113.9',
        payload: { captcha: DEV_CAPTCHA_SOLUTION, ...(note ? { note } : {}) },
      });
    expect((await report('QR-Code überklebt, andere Domain')).statusCode).toBe(202);
    const rows = await h.db.selectFrom('abuse_reports').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'fake_decal',
      qr_token_id: v.decal.tokenId,
      alert_id: null,
      reported_by: null,
      note: 'QR-Code überklebt, andere Domain',
    });
    for (let i = 0; i < 4; i++) expect((await report()).statusCode).toBe(202);
    expect((await report()).statusCode).toBe(429);

    const bad = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${code}/report-fake`,
      headers: UA,
      payload: { captcha: 'nope' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
