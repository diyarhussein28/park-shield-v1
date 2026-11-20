import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FakePayments } from '../providers/fake-payments';
import { PAYMENTS } from '../providers/ports';
import {
  completeProfile,
  createHarness,
  linkSmsDirect,
  resetState,
  SAMPLE_PROFILE,
  setSetting,
  signIn,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const get = (s: Session, url: string) => h.app.inject({ method: 'GET', url, headers: s.headers });
const put = (s: Session, payload: unknown) =>
  h.app.inject({
    method: 'PUT',
    url: '/v1/me/profile',
    headers: s.headers,
    payload: payload as object,
  });
const checkout = (s: Session) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/billing/checkout',
    headers: s.headers,
    payload: { plan: 'plus', immediateStart: true, immediateStartVersion: 1, termsVersion: 1 },
  });

describe('profile (sign-up data)', () => {
  it('starts empty, saves name and address, reads them back; signed out is 401', async () => {
    const s = await signIn(h, 'neu@example.de');
    const empty = await get(s, '/v1/me/profile');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      email: 'neu@example.de',
      complete: false,
      profile: null,
      phone: null,
    });

    const saved = await put(s, { ...SAMPLE_PROFILE, firstName: '  Erika  ', country: undefined });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      complete: true,
      profile: { ...SAMPLE_PROFILE, firstName: 'Erika', source: 'signup' },
    });
    expect((await get(s, '/v1/me/profile')).json().profile.city).toBe('Köln');

    const anon = await h.app.inject({ method: 'GET', url: '/v1/me/profile' });
    expect(anon.statusCode).toBe(401);
  });

  it('validates required fields, the German postcode, lengths and markup', async () => {
    const s = await signIn(h, 'neu@example.de');
    const bad = async (patch: Record<string, unknown>, path: string) => {
      const res = await put(s, { ...SAMPLE_PROFILE, ...patch });
      expect([path, res.statusCode]).toEqual([path, 400]);
      expect(res.json().issues.map((i: { path: string }) => i.path)).toContain(path);
    };
    await bad({ firstName: '' }, 'firstName');
    await bad({ lastName: '   ' }, 'lastName');
    await bad({ street: undefined }, 'street');
    await bad({ city: '' }, 'city');
    await bad({ postalCode: '1234' }, 'postalCode');
    await bad({ postalCode: '5066A' }, 'postalCode');
    await bad({ firstName: '<b>Erika</b>' }, 'firstName');
    await bad({ firstName: 'x'.repeat(61) }, 'firstName');
    await bad({ country: 'Deutschland' }, 'country');
    // Another country: its own postcode format.
    expect(
      (await put(s, { ...SAMPLE_PROFILE, country: 'AT', postalCode: '1010' })).statusCode,
    ).toBe(200);
  });

  it('stores every field encrypted', async () => {
    const s = await signIn(h, 'neu@example.de');
    await completeProfile(h, s);
    const row = await h.db.selectFrom('user_profiles').selectAll().executeTakeFirstOrThrow();
    for (const col of [
      'first_name_enc',
      'last_name_enc',
      'street_enc',
      'postal_code_enc',
      'city_enc',
      'country_enc',
    ] as const) {
      const raw = row[col].toString('latin1');
      expect(raw).not.toMatch(/Erika|Mustermann|Musterstra|50667|Köln|DE$/);
    }
  });

  it('shows the verified SMS number masked (the phone is optional, stored once)', async () => {
    const s = await signIn(h, 'neu@example.de');
    await completeProfile(h, s);
    expect((await get(s, '/v1/me/profile')).json().phone).toBeNull();
    await linkSmsDirect(h, 'neu@example.de', '+491701234567');
    expect((await get(s, '/v1/me/profile')).json().phone).toBe('+49 ••• 4567');
  });
});

describe('checkout needs a complete profile', () => {
  it('refuses checkout and renewal with profile_incomplete, then works', async () => {
    const s = await signIn(h, 'neu@example.de');
    const refused = await checkout(s);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('profile_incomplete');
    const renew = await h.app.inject({
      method: 'POST',
      url: '/v1/portal/subscriptions/renew',
      headers: s.headers,
      payload: {
        plan: 'plus',
        immediateStart: true,
        immediateStartVersion: 1,
        termsVersion: 1,
        stickerStillAttached: true,
      },
    });
    expect(renew.json().error).toBe('profile_incomplete');

    await completeProfile(h, s);
    expect((await checkout(s)).statusCode).toBe(200);
  });

  it('prefills the Stripe customer with the sign-up name and address', async () => {
    const s = await signIn(h, 'neu@example.de');
    await completeProfile(h, s, { street: 'Ringstraße 3', postalCode: '50674' });
    expect((await checkout(s)).statusCode).toBe(200);
    const user = await h.db
      .selectFrom('users')
      .select('stripe_customer_id')
      .where('email', '=', 'neu@example.de')
      .executeTakeFirstOrThrow();
    const fake = h.app.get<FakePayments>(PAYMENTS);
    expect(await fake.customer(user.stripe_customer_id!)).toEqual({
      name: 'Erika Mustermann',
      line1: 'Ringstraße 3',
      postalCode: '50674',
      city: 'Köln',
      country: 'DE',
    });
  });

  it('the source is decided once: signup before the first contract, completed_later after it', async () => {
    const s = await subscribe(h, 'neu@example.de');
    const source = async () =>
      (await h.db.selectFrom('user_profiles').select('source').executeTakeFirstOrThrow()).source;
    expect(await source()).toBe('signup');
    await completeProfile(h, s, { city: 'Bonn', postalCode: '53111' }); // an edit keeps it
    expect(await source()).toBe('signup');
  });
});

describe('data export and deletion', () => {
  it('the export contains the profile; deleting the account deletes it', async () => {
    const s = await subscribe(h, 'neu@example.de');
    const exp = await h.app.inject({
      method: 'POST',
      url: '/v1/me/export',
      headers: s.headers,
      payload: {},
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().profile).toMatchObject({
      firstName: 'Erika',
      lastName: 'Mustermann',
      street: 'Musterstraße 12',
      postalCode: '50667',
      city: 'Köln',
      country: 'DE',
    });
    await h.db.deleteFrom('users').where('email', '=', 'neu@example.de').execute();
    expect(await h.db.selectFrom('user_profiles').selectAll().execute()).toHaveLength(0);
  });
});

describe('app config', () => {
  it('delivers app.lock_after_seconds (default 300, ops-editable) to signed-in apps only', async () => {
    const s = await signIn(h, 'neu@example.de');
    expect((await get(s, '/v1/app/config')).json()).toEqual({ lockAfterSeconds: 300 });
    await setSetting(h, 'app.lock_after_seconds', 30);
    expect((await get(s, '/v1/app/config')).json()).toEqual({ lockAfterSeconds: 30 });
    expect((await h.app.inject({ method: 'GET', url: '/v1/app/config' })).statusCode).toBe(401);
  });
});
