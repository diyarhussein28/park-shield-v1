import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  createHarness,
  resetState,
  setSetting,
  signIn,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';

let h: Harness;
let crypto: FieldCrypto;
beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

async function owner(email = 'owner@example.de') {
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
const send = (code: string, ip: string, payload: Record<string, unknown> = { type: 'lights_on' }) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: ip,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', ...payload },
  });
const history = (s: Session) =>
  h.app
    .inject({ method: 'GET', url: '/v1/alerts', headers: s.headers })
    .then((r) => r.json().alerts);
const report = (
  s: Session,
  id: string,
  payload: Record<string, unknown> = { reason: 'harassment' },
) => h.app.inject({ method: 'POST', url: `/v1/alerts/${id}/report`, headers: s.headers, payload });

describe('alert history (US-31, OW-08)', () => {
  it('lists the owner’s alerts with message, reply, channels and mute reason', async () => {
    const { s, code } = await owner();
    const a = (
      await send(code, '198.51.100.1', { type: 'custom', message: 'Kofferraum offen' })
    ).json();
    await h.app.get(DispatchService).dispatch(a.alertId);
    await h.app.inject({
      method: 'POST',
      url: '/v1/quiet-hours',
      headers: s.headers,
      payload: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' },
    });
    const b = (await send(code, '198.51.101.1')).json();
    await h.app.get(DispatchService).dispatch(b.alertId);
    const blocked = await send(code, '198.51.102.1', {
      type: 'custom',
      message: 'Ruf an 0171 2345678',
    });
    expect(blocked.statusCode).toBe(422);

    const list = await history(s);
    expect(list).toHaveLength(2); // filtered texts never reached the owner
    expect(list[0]).toMatchObject({
      id: b.alertId,
      muted: 'quiet_hours',
      status: 'dispatched',
      canBlock: true,
      reported: false,
    });
    expect(list[1]).toMatchObject({
      id: a.alertId,
      message: 'Kofferraum offen',
      status: 'delivered',
      deliveries: [{ channel: 'email', status: 'sent', reason: null }],
    });

    const other = await owner('other@example.de');
    expect(await history(other.s)).toEqual([]);
  });

  it('a report blocks that scanner for this vehicle for 30 days and reaches the abuse centre', async () => {
    const { s, code } = await owner();
    const a = (await send(code, '198.51.100.1')).json();
    const r = await report(s, a.alertId, { reason: 'harassment', note: 'Jede Nacht' });
    expect(r.json()).toEqual({ reported: true, blocked: true });
    expect((await report(s, a.alertId)).statusCode).toBe(409);
    const ab = await h.db.selectFrom('abuse_reports').selectAll().executeTakeFirstOrThrow();
    expect(ab).toMatchObject({
      kind: 'owner_report',
      alert_id: a.alertId,
      reason: 'harassment',
      note: 'Jede Nacht',
      status: 'open',
    });
    const block = await h.db.selectFrom('scanner_blocks').selectAll().executeTakeFirstOrThrow();
    expect(block.expires_at.getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000);

    // Same person again (after the per-scanner limit): silently dropped, the owner is not disturbed.
    await h.valkey.flushdb();
    const again = await send(code, '198.51.100.1');
    expect(again.statusCode).toBe(201);
    const row = await h.db
      .selectFrom('alerts')
      .select('status')
      .where('id', '=', again.json().alertId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('blocked');
    // Somebody else still gets through.
    const stranger = await send(code, '203.0.113.50');
    const ok = await h.db
      .selectFrom('alerts')
      .select('status')
      .where('id', '=', stranger.json().alertId)
      .executeTakeFirstOrThrow();
    expect(ok.status).toBe('dispatched');
  });

  it('older than 30 days: report only, no block; tests and other owners’ alerts cannot be reported', async () => {
    const { s, v, code } = await owner();
    const a = (await send(code, '198.51.100.1')).json();
    await sql`UPDATE alerts SET created_at = now() - interval '31 days'`.execute(h.db);
    expect((await history(s))[0].canBlock).toBe(false);
    expect((await report(s, a.alertId)).json()).toEqual({ reported: true, blocked: false });
    expect(await h.db.selectFrom('scanner_blocks').selectAll().execute()).toHaveLength(0);

    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/test-window`,
      headers: s.headers,
    });
    const test = (await send(code, '198.51.101.1')).json();
    expect((await report(s, test.alertId)).statusCode).toBe(404);
    const other = await signIn(h, 'other@example.de');
    const fresh = (await send(code, '198.51.102.1')).json();
    expect((await report(other, fresh.alertId)).statusCode).toBe(404);
  });
});

describe('"I didn’t get the alert" (SP-05)', () => {
  it('shows the latest attempts with reasons, and what is set up', async () => {
    const { s, code } = await owner();
    await setSetting(h, 'channels.webpush.enabled', false);
    await h.app.inject({
      method: 'POST',
      url: '/v1/quiet-hours',
      headers: s.headers,
      payload: { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' },
    });
    const a = (await send(code, '198.51.100.1')).json();
    await h.app.get(DispatchService).dispatch(a.alertId);
    const r = (
      await h.app.inject({ method: 'GET', url: '/v1/me/deliveries', headers: s.headers })
    ).json();
    expect(r.attempts[0]).toMatchObject({
      alertId: a.alertId,
      status: 'suppressed',
      reason: 'quiet_hours',
      nickname: 'Der Blaue',
    });
    expect(r.setup).toMatchObject({
      pushDevices: 0,
      whatsapp: false,
      quietHours: 1,
      decalTested: false,
      switchedOff: ['webpush'],
    });
  });
});
