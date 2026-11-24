import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpsApp } from '../apps';
import { loadEnv } from '../config/env';
import { createLogger } from '../core/logger';
import { StaffService } from '../ops/staff.service';
import {
  createHarness,
  resetState,
  setSetting,
  signIn,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { subscriptionYearStart } from './code-rules';

/**
 * New-code rules (owner decision 2026-11-24): a new code at most every 10 days per vehicle (counted
 * from the newest code, the first one included); free once per subscription year after a „Sperren“,
 * else 402 `payment_required` (the 3 € printed sticker, phase 3); staff may override (audited).
 */
let h: Harness;
let ops: NestFastifyApplication;
let staff: StaffService;

beforeAll(async () => {
  h = await createHarness();
  const env = loadEnv({
    MAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    TWILIO_ACCOUNT_SID: '',
    PRINT_PARTNER: '',
  });
  ops = await buildOpsApp(env, createLogger(env));
  await ops.init();
  await ops.getHttpAdapter().getInstance().ready();
  staff = ops.get(StaffService);
});
afterAll(async () => {
  await ops.close();
  await h.close();
});
beforeEach(() => resetState(h));

const DAY = 86_400_000;

async function owner(email = 'neu@example.de') {
  const s = await subscribe(h, email);
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/vehicles',
    headers: s.headers,
    payload: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { s, vehicleId: res.json().id as string };
}

/** Moves every code of the vehicle (and its ledger rows) `days` into the past. */
async function age(vehicleId: string, days: number) {
  const by = sql`make_interval(secs => ${days * 86_400})`;
  await sql`UPDATE qr_tokens SET created_at = created_at - ${by},
              assigned_at = assigned_at - ${by} WHERE vehicle_id = ${vehicleId}`.execute(h.db);
  await sql`UPDATE code_issuances SET issued_at = issued_at - ${by}
             WHERE vehicle_id = ${vehicleId}`.execute(h.db);
}

const options = async (s: Session, vehicleId: string) => {
  const r = await h.app.inject({
    method: 'GET',
    url: `/v1/vehicles/${vehicleId}/new-code`,
    headers: s.headers,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const sperren = (s: Session, vehicleId: string) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/vehicles/${vehicleId}/tokens/revoke`,
    headers: s.headers,
    payload: { confirm: true, reason: 'leaked' },
  });
const newCode = (s: Session, vehicleId: string) =>
  h.app.inject({ method: 'POST', url: `/v1/vehicles/${vehicleId}/tokens`, headers: s.headers });

const kinds = async (vehicleId: string) =>
  (
    await h.db
      .selectFrom('code_issuances')
      .select('kind')
      .where('vehicle_id', '=', vehicleId)
      .orderBy('issued_at')
      .execute()
  ).map((r) => r.kind);

describe('subscriptionYearStart', () => {
  const at = (s: string) => new Date(s);
  it('is the anchor plus the whole years that have passed', () => {
    const anchor = at('2026-03-15T10:00:00Z');
    expect(subscriptionYearStart(anchor, at('2026-03-15T10:00:00Z'))).toEqual(anchor);
    expect(subscriptionYearStart(anchor, at('2027-03-15T09:59:59Z'))).toEqual(anchor);
    expect(subscriptionYearStart(anchor, at('2027-03-15T10:00:00Z'))).toEqual(
      at('2027-03-15T10:00:00Z'),
    );
    expect(subscriptionYearStart(anchor, at('2029-01-01T00:00:00Z'))).toEqual(
      at('2028-03-15T10:00:00Z'),
    );
  });
});

describe('new-code rules (2026-11-24)', () => {
  it('records the first code and starts the 10-day cooldown with it', async () => {
    const { s, vehicleId } = await owner();
    expect(await kinds(vehicleId)).toEqual(['initial']);
    const o = await options(s, vehicleId);
    expect(o).toMatchObject({
      freeAvailable: false,
      paidAvailable: false,
      reason: 'cooldown',
      cooldownDays: 10,
      priceCents: 300,
      freePerYear: 1,
      freeUsed: 0,
      hasActiveCode: true,
    });
    const next = new Date(o.nextEligibleAt).getTime();
    const issued = new Date(o.lastIssuedAt).getTime();
    expect(next - issued).toBe(10 * DAY);

    // „Sperren“ is always possible at once; a new code has to wait for the date.
    expect((await sperren(s, vehicleId)).statusCode).toBe(200);
    const refused = await newCode(s, vehicleId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'code_cooldown', cooldownDays: 10 });
    expect(new Date(refused.json().nextEligibleAt).getTime()).toBe(next);
  });

  it('respects the exact boundary of the cooldown', async () => {
    const { s, vehicleId } = await owner();
    await sperren(s, vehicleId);
    await age(vehicleId, 10 - 60 / 86_400); // one minute short of 10 days
    expect((await newCode(s, vehicleId)).statusCode).toBe(409);
    await age(vehicleId, 120 / 86_400); // one minute past
    const ok = await newCode(s, vehicleId);
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it('gives one free code per subscription year after a „Sperren“, then asks for the 3 € print', async () => {
    const { s, vehicleId } = await owner();
    await age(vehicleId, 11);
    expect(await options(s, vehicleId)).toMatchObject({
      freeAvailable: false,
      paidAvailable: true,
      reason: 'code_active',
      nextEligibleAt: null,
    });
    // With an active code there is no free one: the owner locks first.
    expect((await newCode(s, vehicleId)).json()).toEqual({ error: 'code_active' });
    await sperren(s, vehicleId);
    expect(await options(s, vehicleId)).toMatchObject({ freeAvailable: true, reason: null });
    const free = await newCode(s, vehicleId);
    expect(free.statusCode, free.body).toBe(201);
    expect(free.json().decal).toMatchObject({ status: 'assigned' });
    expect(await kinds(vehicleId)).toEqual(['initial', 'free']);
    const [audit] = await h.db
      .selectFrom('audit_logs')
      .select(['actor_kind', 'meta'])
      .where('action', '=', 'qr_code.replaced')
      .where('entity_id', '=', vehicleId)
      .execute();
    expect(audit).toMatchObject({ actor_kind: 'customer', meta: { kind: 'free' } });

    // Ten days later the stolen-again sticker is locked once more: the free code is used up.
    await age(vehicleId, 11);
    await sperren(s, vehicleId);
    expect(await options(s, vehicleId)).toMatchObject({
      freeAvailable: false,
      paidAvailable: true,
      reason: 'free_used',
      freeUsed: 1,
    });
    const pay = await newCode(s, vehicleId);
    expect(pay.statusCode).toBe(402);
    expect(pay.json()).toEqual({ error: 'payment_required', priceCents: 300 });

    // A new subscription year brings a new free code.
    await sql`UPDATE subscriptions SET original_purchase_at = now() - interval '366 days',
                created_at = now() - interval '366 days'`.execute(h.db);
    expect(await options(s, vehicleId)).toMatchObject({ freeAvailable: true, freeUsed: 0 });
    expect((await newCode(s, vehicleId)).statusCode).toBe(201);
  });

  it('reads cooldown and free quota from the settings', async () => {
    await setSetting(h, 'codes.reissue_cooldown_days', 0);
    await setSetting(h, 'codes.free_reissues_per_year', 2);
    const { s, vehicleId } = await owner();
    for (let i = 0; i < 2; i++) {
      await sperren(s, vehicleId);
      expect((await newCode(s, vehicleId)).statusCode).toBe(201);
    }
    await sperren(s, vehicleId);
    expect((await newCode(s, vehicleId)).statusCode).toBe(402);
  });

  it('issues exactly one code when two requests race', async () => {
    const { s, vehicleId } = await owner();
    await age(vehicleId, 11);
    await sperren(s, vehicleId);
    const results = await Promise.all([newCode(s, vehicleId), newCode(s, vehicleId)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const active = await h.db
      .selectFrom('qr_tokens')
      .select('id')
      .where('vehicle_id', '=', vehicleId)
      .where('status', '<>', 'revoked')
      .execute();
    expect(active).toHaveLength(1);
    expect(await kinds(vehicleId)).toEqual(['initial', 'free']);
  });

  it('needs a subscription', async () => {
    const { s, vehicleId } = await owner();
    await sql`UPDATE subscriptions SET status = 'canceled'`.execute(h.db);
    expect(await options(s, vehicleId)).toMatchObject({
      freeAvailable: false,
      paidAvailable: false,
      reason: 'subscription_required',
    });
    expect((await newCode(s, vehicleId)).statusCode).toBe(403);
    const other = await signIn(h, 'fremd@example.de');
    const foreign = await h.app.inject({
      method: 'GET',
      url: `/v1/vehicles/${vehicleId}/new-code`,
      headers: other.headers,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('staff with codes.override_cooldown issue a code despite the cooldown, audited', async () => {
    const { s, vehicleId } = await owner();
    const as = async (email: string, roles: string[]) => {
      const { userId } = await staff.invite(null, { email, name: email.split('@')[0]!, roles });
      const session = await staff.createSession(userId, 'Chrome · Windows');
      return {
        userId,
        headers: {
          cookie: `ps_ops_session=${session.token}; ps_ops_csrf=${session.csrf}`,
          'x-csrf-token': session.csrf,
        },
      };
    };
    const call = (who: { headers: Record<string, string> }, reason = 'Aufkleber gestohlen') =>
      ops.inject({
        method: 'POST',
        url: `/ops/v1/vehicles/${vehicleId}/new-code`,
        headers: who.headers,
        payload: { reason },
      });
    const support = await as('support@parkshield.de', ['support']);
    expect((await call(support)).statusCode).toBe(403);
    const admin = await as('admin@parkshield.de', ['admin']);
    expect((await call(admin, 'x')).statusCode).toBe(400);
    const res = await call(admin);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().codeHint).toMatch(/^[0-9A-Z]{4}$/);
    // The old code stopped, the new one is active, both inside the owner's cooldown.
    const tokens = await h.db
      .selectFrom('qr_tokens')
      .select('status')
      .where('vehicle_id', '=', vehicleId)
      .orderBy('created_at')
      .execute();
    expect(tokens.map((t) => t.status)).toEqual(['revoked', 'assigned']);
    expect(await kinds(vehicleId)).toEqual(['initial', 'ops_override']);
    const [audit] = await h.db
      .selectFrom('audit_logs')
      .select(['actor_id', 'actor_kind', 'meta'])
      .where('action', '=', 'qr_code.replaced')
      .where('entity_id', '=', vehicleId)
      .execute();
    expect(audit).toMatchObject({
      actor_id: admin.userId,
      actor_kind: 'staff',
      meta: { kind: 'ops_override', reason: 'Aufkleber gestohlen' },
    });
    expect((await options(s, vehicleId)).reason).toBe('cooldown');
  });
});
