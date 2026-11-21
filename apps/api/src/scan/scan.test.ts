import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  appPushes,
  createHarness,
  mailbox,
  registerAppDevice,
  resetState,
  subscribe,
  type Harness,
} from '../test/harness';
import { DISPATCH_TOPIC } from './scan.service';
import { WELCOME_LETTER_TOPIC } from '../letters/trigger';

let h: Harness;
let crypto: FieldCrypto;
beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const SCANNER = {
  'user-agent':
    'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
};

async function vehicleWithCode(email = 'owner@example.de', nickname = 'Der Blaue') {
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

const send = (code: string, payload: Record<string, unknown>, ip = '203.0.113.7') =>
  h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    headers: SCANNER,
    remoteAddress: ip,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', ...payload },
  });
const status = (id: string, token: string) =>
  h.app.inject({
    method: 'GET',
    url: `/v1/alerts/${id}/status`,
    headers: { 'x-status-token': token },
  });

describe('scanner page data (US-14, SC-07)', () => {
  it('shows nickname, colour and alert types, nothing personal, and sets no cookies', async () => {
    const { code } = await vehicleWithCode();
    const res = await h.app.inject({ method: 'GET', url: `/v1/scan/${code}`, headers: SCANNER });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    const body = res.json();
    expect(body).toMatchObject({
      nickname: 'Der Blaue',
      color: 'Blau',
      testMode: false,
      backAt: null,
    });
    expect(body.alertTypes.map((t: { code: string }) => t.code)).toEqual([
      'blocking',
      'lights_on',
      'window_open',
      'damage',
      'alarm',
      'towing_risk',
      'custom',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/K-AB|1234|owner@example|Jonas/);
    const t = await h.db
      .selectFrom('qr_tokens')
      .select('last_scanned_at')
      .executeTakeFirstOrThrow();
    expect(t.last_scanned_at).toBeInstanceOf(Date);
  });

  it('accepts look-alike characters and lower case (Crockford)', async () => {
    const { code } = await vehicleWithCode();
    const sloppy = code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l');
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${sloppy}` })).statusCode).toBe(200);
  });

  it('answers identically for unknown, revoked and unpaid decals', async () => {
    const { s, v, code } = await vehicleWithCode();
    const unknown = await h.app.inject({ method: 'GET', url: '/v1/scan/ZZZZZZZZZZ' });
    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/tokens/revoke`,
      headers: s.headers,
      payload: { confirm: true, reason: 'leaked' },
    });
    const revoked = await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` });
    const second = await vehicleWithCode('unpaid@example.de');
    await sql`UPDATE subscriptions SET status = 'expired' FROM users WHERE users.id = subscriptions.user_id AND users.email = 'unpaid@example.de'`.execute(
      h.db,
    );
    const unpaid = await h.app.inject({ method: 'GET', url: `/v1/scan/${second.code}` });
    for (const r of [unknown, revoked, unpaid]) {
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ error: 'inactive' });
    }
  });

  it('limits code guessing to 30 misses per minute per truncated IP', async () => {
    for (let i = 0; i < 30; i++) {
      expect(
        (
          await h.app.inject({
            method: 'GET',
            url: '/v1/scan/ZZZZZZZZZZ',
            remoteAddress: `198.51.100.${i}`,
          })
        ).statusCode,
      ).toBe(404);
    }
    const blocked = await h.app.inject({
      method: 'GET',
      url: '/v1/scan/ZZZZZZZZZZ',
      remoteAddress: '198.51.100.250',
    });
    expect(blocked.statusCode).toBe(429);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: '/v1/scan/ZZZZZZZZZZ',
          remoteAddress: '192.0.2.1',
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('sending an alert (US-14, US-15, US-16)', () => {
  it('needs the captcha', async () => {
    const { code } = await vehicleWithCode();
    expect((await send(code, { type: 'lights_on', captcha: 'nope' })).statusCode).toBe(400);
  });

  it('creates the alert, queues dispatch, and only the status token sees its status', async () => {
    const { code } = await vehicleWithCode();
    await registerAppDevice(h, 'owner@example.de');
    const res = await send(code, { type: 'blocking' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['set-cookie']).toBeUndefined();
    const { alertId, statusToken } = res.json();
    const alert = await h.db.selectFrom('alerts').selectAll().executeTakeFirstOrThrow();
    expect(alert).toMatchObject({
      id: alertId,
      status: 'dispatched',
      severity: 'urgent',
      is_test: false,
    });
    expect(alert.scanner_ref).toHaveLength(32);
    expect(alert.block_ref).toHaveLength(32);
    const events = await h.db
      .selectFrom('outbox_events')
      .select(['topic', 'payload'])
      .where('topic', '<>', WELCOME_LETTER_TOPIC)
      .execute();
    expect(events).toEqual([{ topic: DISPATCH_TOPIC, payload: { alertId } }]);

    expect((await status(alertId, 'wrong-token')).statusCode).toBe(404);
    expect((await status(alertId, statusToken)).json()).toMatchObject({
      status: 'dispatched',
      type: 'blocking',
      deliveredAt: null,
    });

    await h.app.get(DispatchService).dispatch(alertId);
    const after = (await status(alertId, statusToken)).json();
    expect(after.status).toBe('delivered');
    expect(after.deliveredAt).not.toBeNull();
    // App push only (2026-11-21): no e-mail for an alert.
    expect((await appPushes(h)).map((p) => p.body.message.data)).toEqual([
      { alertId, kind: 'alert' },
    ]);

    await h.app.get(DispatchService).dispatch(alertId); // replay
    expect(await appPushes(h)).toHaveLength(1);
    expect((await mailbox(h)).filter((m) => m.tag.startsWith('alert_'))).toHaveLength(0);
  });

  it('uses one daily scanner ref across vehicles but a per-vehicle block ref', async () => {
    const a = await vehicleWithCode('a@example.de', 'A');
    const b = await vehicleWithCode('b@example.de', 'B');
    await send(a.code, { type: 'lights_on' });
    await send(b.code, { type: 'lights_on' });
    const rows = await h.db.selectFrom('alerts').select(['scanner_ref', 'block_ref']).execute();
    expect(rows[0]!.scanner_ref!.equals(rows[1]!.scanner_ref!)).toBe(true);
    expect(rows[0]!.block_ref!.equals(rows[1]!.block_ref!)).toBe(false);
  });

  it('delivers an allowed custom message to the owner', async () => {
    const { s, code } = await vehicleWithCode();
    expect((await send(code, { type: 'custom' })).json()).toEqual({ error: 'message_required' });
    const res = await send(code, { type: 'custom', message: 'Ihr Kofferraum steht offen' });
    await h.app.get(DispatchService).dispatch(res.json().alertId);
    // The owner reads it in the app or the portal (never in a push, never by e-mail).
    const list = (
      await h.app.inject({ method: 'GET', url: '/v1/alerts', headers: s.headers })
    ).json();
    expect(list.alerts[0]).toMatchObject({ message: 'Ihr Kofferraum steht offen' });
    const row = await h.db
      .selectFrom('alerts')
      .select('custom_message_enc')
      .executeTakeFirstOrThrow();
    expect(row.custom_message_enc!.toString('latin1')).not.toContain('Kofferraum');
  });

  it('never sends filtered messages and samples them for review', async () => {
    await h.db
      .updateTable('app_settings')
      .set({ value: JSON.stringify(1) })
      .where('key', '=', 'moderation.sample_rate')
      .execute();
    h.app.get(SettingsService).invalidate();
    try {
      const { code } = await vehicleWithCode();
      const res = await send(code, { type: 'custom', message: 'Ruf mich an 0171 2345678' });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'message_blocked', reason: 'phone' });
      const alert = await h.db
        .selectFrom('alerts')
        .select(['status', 'moderation'])
        .executeTakeFirstOrThrow();
      expect(alert).toEqual({ status: 'blocked', moderation: 'blocked' });
      expect(
        await h.db
          .selectFrom('outbox_events')
          .selectAll()
          .where('topic', '<>', WELCOME_LETTER_TOPIC)
          .execute(),
      ).toHaveLength(0);
      const review = await h.db
        .selectFrom('moderation_reviews')
        .select('rule_hit')
        .executeTakeFirstOrThrow();
      expect(review.rule_hit).toBe('phone');
    } finally {
      await h.db
        .updateTable('app_settings')
        .set({ value: JSON.stringify(0.1) })
        .where('key', '=', 'moderation.sample_rate')
        .execute();
      h.app.get(SettingsService).invalidate();
    }
  });

  it('answers a blocked scanner with the neutral 403 and stores nothing', async () => {
    const { code, v } = await vehicleWithCode();
    const first = await send(code, { type: 'lights_on' });
    const { block_ref } = await h.db
      .selectFrom('alerts')
      .select('block_ref')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('scanner_blocks')
      .values({
        ref: block_ref!,
        qr_token_id: v.decal.tokenId,
        reason: 'owner_report',
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .execute();
    await h.db.deleteFrom('outbox_events').execute();
    const res = await send(code, { type: 'lights_on' });
    // Abuse protection §3: never a hint at the owner or a block, and no shadow alert either.
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: 'not_deliverable',
      message: 'Ihre Nachricht konnte nicht zugestellt werden.',
    });
    expect(
      await h.db
        .selectFrom('outbox_events')
        .selectAll()
        .where('topic', '<>', WELCOME_LETTER_TOPIC)
        .execute(),
    ).toHaveLength(0);
    expect(await h.db.selectFrom('alerts').selectAll().execute()).toHaveLength(1);
    expect(first.statusCode).toBe(201);
  });

  it('shows expired once the 2 h window has passed', async () => {
    const { code } = await vehicleWithCode();
    const { alertId, statusToken } = (await send(code, { type: 'lights_on' })).json();
    await sql`UPDATE alerts SET expires_at = now() - interval '1 minute'`.execute(h.db);
    expect((await status(alertId, statusToken)).json().status).toBe('expired');
  });
});

describe('decal test and code replacement (US-12, US-13)', () => {
  it('the next scan in the test window is a test that activates the decal', async () => {
    const { s, v, code } = await vehicleWithCode();
    await registerAppDevice(h, 'owner@example.de');
    const open = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/test-window`,
      headers: s.headers,
    });
    expect(open.statusCode).toBe(200);
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` })).json().testMode).toBe(
      true,
    );

    const { alertId } = (await send(code, { type: 'lights_on' })).json();
    const token = await h.db.selectFrom('qr_tokens').selectAll().executeTakeFirstOrThrow();
    expect(token).toMatchObject({ status: 'assigned', test_window_until: null });
    expect(token.last_test_at).toBeInstanceOf(Date);
    expect(token.activated_at).toBeInstanceOf(Date);
    await h.app.get(DispatchService).dispatch(alertId);
    const push = (await appPushes(h))[0]!.body.message;
    expect(push.data).toEqual({ alertId, kind: 'test' });
    expect(push.notification.body).toBe('Testwarnung angekommen. So erreichen Sie Warnungen.');

    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` })).json().testMode).toBe(
      false,
    );
    const next = (await send(code, { type: 'lights_on' }, '203.0.113.99')).json();
    expect(
      (
        await h.db
          .selectFrom('alerts')
          .select('is_test')
          .where('id', '=', next.alertId)
          .executeTakeFirstOrThrow()
      ).is_test,
    ).toBe(false);
  });

  it('„Sperren“ revokes the code after explicit confirmation and creates no new one', async () => {
    const { s, v, code } = await vehicleWithCode();
    await h.app.inject({
      method: 'PUT',
      url: `/v1/vehicles/${v.id}/decal`,
      headers: s.headers,
      payload: { template: 'night', cta: 'Licht an? Bitte scannen' },
    });
    const revoke = (payload: Record<string, unknown>) =>
      h.app.inject({
        method: 'POST',
        url: `/v1/vehicles/${v.id}/tokens/revoke`,
        headers: s.headers,
        payload,
      });
    expect((await revoke({ reason: 'leaked' })).statusCode).toBe(400);
    const res = await revoke({ confirm: true, reason: 'leaked' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().decal).toBeNull();
    // The old code is inactive for scanners, and there is no other code.
    const scan = await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` });
    expect(scan.statusCode).toBe(404);
    expect(scan.json()).toEqual({ error: 'inactive' });
    expect(
      await h.db.selectFrom('qr_tokens').select('id').where('status', '<>', 'revoked').execute(),
    ).toHaveLength(0);
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/vehicles/${v.id}`, headers: s.headers })).json()
        .decal,
    ).toBeNull();
    // Nothing left to block.
    expect((await revoke({ confirm: true })).statusCode).toBe(409);
  });

  it('„Neuen Code erstellen“ is free, keeps the design and refuses while a code is active', async () => {
    const { s, v, code } = await vehicleWithCode();
    await h.app.inject({
      method: 'PUT',
      url: `/v1/vehicles/${v.id}/decal`,
      headers: s.headers,
      payload: { template: 'night', cta: 'Licht an? Bitte scannen' },
    });
    const create = () =>
      h.app.inject({ method: 'POST', url: `/v1/vehicles/${v.id}/tokens`, headers: s.headers });
    const busy = await create();
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toEqual({ error: 'code_active' });

    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/tokens/revoke`,
      headers: s.headers,
      payload: { confirm: true, reason: 'leaked' },
    });
    const res = await create();
    expect(res.statusCode, res.body).toBeLessThan(300);
    expect(res.json().decal).toMatchObject({
      template: 'night',
      cta: 'Licht an? Bitte scannen',
      status: 'assigned',
    });
    expect(res.json().decal.codeHint).not.toBe(code.slice(-4));
    // No payment, no order.
    expect(await h.db.selectFrom('decal_orders').select('id').execute()).toHaveLength(0);
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` })).statusCode).toBe(404);
    const fresh = await h.db
      .selectFrom('qr_tokens')
      .select('code_enc')
      .where('status', '<>', 'revoked')
      .executeTakeFirstOrThrow();
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/scan/${crypto.decrypt(fresh.code_enc)}` }))
        .statusCode,
    ).toBe(200);
    expect((await create()).statusCode).toBe(409);
  });
});
