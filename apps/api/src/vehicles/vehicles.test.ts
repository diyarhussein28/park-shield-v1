import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { sha256 } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO } from '../core/tokens';
import {
  createHarness,
  resetState,
  signIn,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { plateKey } from './vehicles.service';

let h: Harness;
let crypto: FieldCrypto;
beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const addVehicle = (s: Session, payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: '/v1/vehicles', headers: s.headers, payload });

describe('vehicles (US-09)', () => {
  it('requires a paid subscription', async () => {
    const s = await signIn(h, 'unpaid@example.de');
    const res = await addVehicle(s, { nickname: 'Der Blaue', plate: 'K-AB 1234' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'subscription_required' });
  });

  it('stores the plate encrypted with a normalised blind index and issues a decal code', async () => {
    const s = await subscribe(h, 'jonas@example.de');
    const res = await addVehicle(s, {
      nickname: 'Der Blaue',
      plate: ' k-ab   1234 ',
      color: 'Blau',
      makeModel: 'VW Golf',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      nickname: 'Der Blaue',
      plate: 'K-AB 1234',
      color: 'Blau',
      decal: { status: 'generated', template: 'classic', cta: 'Kontaktieren Sie mich' },
    });

    const row = await h.db.selectFrom('vehicles').selectAll().executeTakeFirstOrThrow();
    expect(row.plate_enc!.toString('latin1')).not.toContain('1234');
    expect(crypto.decrypt(row.plate_enc!)).toBe('K-AB 1234');
    expect(row.plate_bidx!.equals(crypto.blindIndex('KAB1234', plateKey))).toBe(true);

    const token = await h.db.selectFrom('qr_tokens').selectAll().executeTakeFirstOrThrow();
    const code = crypto.decrypt(token.code_enc);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(token.code_hash.equals(sha256(code))).toBe(true);
    expect(token.code_hint).toBe(code.slice(-4));
    expect(res.json().decal.codeHint).toBe(code.slice(-4));
  });

  it('enforces the plan limit with an upgrade hint, also under concurrent requests', async () => {
    const s = await subscribe(h, 'limit@example.de');
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => addVehicle(s, { nickname: `Auto ${n}`, plate: `K-A ${n}` })),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2);
    const rejected = results.find((r) => r.statusCode === 409)!;
    expect(rejected.json()).toEqual({ error: 'vehicle_limit', limit: 2, plan: 'plus' });
  });

  it('reads limit overrides from app_settings (no hard-coded limits)', async () => {
    await h.db
      .insertInto('app_settings')
      .values({ key: 'limits.plus.vehicles', value: JSON.stringify(3) })
      .execute();
    h.app.get(SettingsService).invalidate();
    try {
      const s = await subscribe(h, 'override@example.de');
      for (const n of [1, 2, 3])
        expect((await addVehicle(s, { nickname: `A${n}`, plate: `B-X ${n}` })).statusCode).toBe(
          201,
        );
      expect((await addVehicle(s, { nickname: 'A4', plate: 'B-X 4' })).statusCode).toBe(409);
    } finally {
      await h.db.deleteFrom('app_settings').where('key', '=', 'limits.plus.vehicles').execute();
      h.app.get(SettingsService).invalidate();
    }
  });

  it('keeps vehicles private to their owner', async () => {
    const owner = await subscribe(h, 'owner@example.de');
    const { id } = (await addVehicle(owner, { nickname: 'Mein Auto', plate: 'M-XY 99' })).json();
    const other = await subscribe(h, 'other@example.de');
    for (const [method, url] of [
      ['GET', `/v1/vehicles/${id}`],
      ['PATCH', `/v1/vehicles/${id}`],
      ['DELETE', `/v1/vehicles/${id}`],
      ['GET', `/v1/vehicles/${id}/decal.svg`],
      ['GET', `/v1/vehicles/${id}/decal.pdf`],
    ] as const) {
      const res = await h.app.inject({
        method,
        url,
        headers: other.headers,
        payload: method === 'PATCH' ? { nickname: 'x' } : undefined,
      });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const list = await h.app.inject({
      method: 'GET',
      url: '/v1/vehicles',
      headers: { cookie: other.cookie },
    });
    expect(list.json()).toEqual({ vehicles: [] });
  });

  it('rejects invalid plates and updates fields', async () => {
    const s = await subscribe(h, 'edit@example.de');
    expect((await addVehicle(s, { nickname: 'X', plate: 'K<script>' })).statusCode).toBe(400);
    const { id } = (await addVehicle(s, { nickname: 'Alt', plate: 'K-AB 1' })).json();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/v1/vehicles/${id}`,
      headers: s.headers,
      payload: { nickname: 'Neu', plate: 'D-CD 22' },
    });
    expect(res.json()).toMatchObject({ nickname: 'Neu', plate: 'D-CD 22' });
  });
});

describe('decal designer (US-10)', () => {
  async function vehicle() {
    const s = await subscribe(h, 'design@example.de');
    const v = (await addVehicle(s, { nickname: 'Der Blaue', plate: 'K-AB 1234' })).json();
    return { s, v };
  }

  it('previews unsaved designs as SVG containing the real decal URL', async () => {
    const { s, v } = await vehicle();
    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/vehicles/${v.id}/decal.svg?template=night&cta=${encodeURIComponent('Licht an? Bitte scannen')}`,
      headers: { cookie: s.cookie },
    });
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('Licht an? Bitte scannen');
    expect(res.body).toMatch(/localhost:3000\/s\/[0-9A-HJKMNP-TV-Z]{6}/);
    expect(res.body).toContain('ParkShield verlangt nie eine Zahlung');
  });

  it('filters the free-text header and saves allowed designs', async () => {
    const { s, v } = await vehicle();
    const bad = await h.app.inject({
      method: 'PUT',
      url: `/v1/vehicles/${v.id}/decal`,
      headers: s.headers,
      payload: { template: 'signal', cta: 'Ruf an 0171 2345678' },
    });
    expect(bad.json()).toEqual({ error: 'cta_not_allowed', reason: 'phone' });
    const good = await h.app.inject({
      method: 'PUT',
      url: `/v1/vehicles/${v.id}/decal`,
      headers: s.headers,
      payload: { template: 'signal', cta: 'Blockiere ich Sie? Bitte scannen' },
    });
    expect(good.json().decal).toMatchObject({
      template: 'signal',
      cta: 'Blockiere ich Sie? Bitte scannen',
    });
    expect(
      (
        await h.app.inject({
          method: 'PUT',
          url: `/v1/vehicles/${v.id}/decal`,
          headers: s.headers,
          payload: { template: 'rainbow', cta: 'x' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('serves the free home-print PDF', async () => {
    const { s, v } = await vehicle();
    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/vehicles/${v.id}/decal.pdf`,
      headers: { cookie: s.cookie },
    });
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
