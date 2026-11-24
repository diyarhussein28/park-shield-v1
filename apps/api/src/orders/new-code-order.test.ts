import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BillingService } from '../billing/billing.service';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { createHarness, resetState, subscribe, type Harness, type Session } from '../test/harness';
import { VehiclesService } from '../vehicles/vehicles.service';
import { OrdersService, PRINT_TOPIC } from './orders.service';

/**
 * „Neuer Code + gedruckter Aufkleber (3 €)“ (owner decision 2026-11-24, phase 3): Stripe only; the
 * cooldown is checked before the payment page; the payment webhook issues the code exactly once
 * (whatever happened in between); a refund never revokes it.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const address = {
  name: 'Jonas Beispiel',
  line1: 'Domstraße 1',
  postalCode: '50667',
  city: 'Köln',
  country: 'DE',
};

async function setup() {
  const s = await subscribe(h, 'jonas@example.de');
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
    })
  ).json();
  await h.app.inject({
    method: 'PUT',
    url: `/v1/vehicles/${v.id}/decal`,
    headers: s.headers,
    payload: { template: 'night', cta: 'Licht an? Bitte scannen' },
  });
  return { s, vehicleId: v.id as string };
}

async function age(vehicleId: string, days = 11) {
  const by = sql`make_interval(days => ${days})`;
  await sql`UPDATE qr_tokens SET created_at = created_at - ${by}, assigned_at = assigned_at - ${by}
             WHERE vehicle_id = ${vehicleId}`.execute(h.db);
  await sql`UPDATE code_issuances SET issued_at = issued_at - ${by}
             WHERE vehicle_id = ${vehicleId}`.execute(h.db);
}

const orderNewCode = (s: Session, vehicleId: string, payload: object = {}) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/vehicles/${vehicleId}/new-code/order`,
    headers: s.headers,
    payload: { address, personalizationConfirmed: true, ...payload },
  });
const pay = (sessionId: string) =>
  h.app.inject({ method: 'POST', url: '/v1/dev/payments/complete', payload: { sessionId } });
const sessionOf = (url: string) => new URL(url).searchParams.get('session')!;

const tokens = (vehicleId: string) =>
  h.db
    .selectFrom('qr_tokens')
    .select(['id', 'status', 'design_template_id', 'cta_header'])
    .where('vehicle_id', '=', vehicleId)
    .orderBy('created_at')
    .execute();
const ledger = (vehicleId: string) =>
  h.db
    .selectFrom('code_issuances')
    .select(['kind', 'stripe_ref', 'qr_token_id', 'refunded_at'])
    .where('vehicle_id', '=', vehicleId)
    .orderBy('issued_at')
    .execute();

describe('paid new code (3 €, Stripe only)', () => {
  it('is refused inside the cooldown before any payment page opens', async () => {
    const { s, vehicleId } = await setup();
    const res = await orderNewCode(s, vehicleId);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'code_cooldown', cooldownDays: 10 });
    expect(res.json().nextEligibleAt).toBeTruthy();
    expect(await h.db.selectFrom('decal_orders').select('id').execute()).toHaveLength(0);
    // The personalisation step is required (B1).
    await age(vehicleId);
    const unconfirmed = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${vehicleId}/new-code/order`,
      headers: s.headers,
      payload: { address },
    });
    expect(unconfirmed.statusCode).toBe(400);
  });

  it('replaces an active code once paid: new code with the frozen design, printed, audited', async () => {
    const { s, vehicleId } = await setup();
    await age(vehicleId);
    const [old] = await tokens(vehicleId);
    const res = await orderNewCode(s, vehicleId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ priceCents: 300, url: expect.stringContaining('session=') });
    const session = (
      await h.app.inject({
        method: 'GET',
        url: `/v1/dev/payments/sessions/${sessionOf(res.json().url)}`,
      })
    ).json();
    expect(session.amountCents).toBe(300);
    // Nothing changes before the payment.
    expect((await tokens(vehicleId)).map((t) => t.status)).toEqual(['assigned']);
    expect(
      await h.db
        .selectFrom('outbox_events')
        .select('id')
        .where('topic', '=', PRINT_TOPIC)
        .execute(),
    ).toHaveLength(0);

    expect((await pay(sessionOf(res.json().url))).statusCode).toBe(200);
    const after = await tokens(vehicleId);
    expect(after.map((t) => t.status)).toEqual(['revoked', 'assigned']);
    expect(after[0]!.id).toBe(old!.id);
    expect(after[1]).toMatchObject({
      design_template_id: 'night',
      cta_header: 'Licht an? Bitte scannen',
    });
    const order = await h.db
      .selectFrom('decal_orders as o')
      .innerJoin('decal_order_items as i', 'i.order_id', 'o.id')
      .select(['o.id', 'o.status', 'o.new_code', 'o.paid_print', 'i.qr_token_id'])
      .executeTakeFirstOrThrow();
    // The sticker that is printed carries the new code.
    expect(order).toMatchObject({ status: 'paid', new_code: true, paid_print: true });
    expect(order.qr_token_id).toBe(after[1]!.id);
    expect(
      await h.db
        .selectFrom('outbox_events')
        .select('id')
        .where('topic', '=', PRINT_TOPIC)
        .execute(),
    ).toHaveLength(1);
    expect(await ledger(vehicleId)).toEqual([
      expect.objectContaining({ kind: 'initial' }),
      expect.objectContaining({
        kind: 'paid',
        stripe_ref: `order:${order.id}`,
        qr_token_id: after[1]!.id,
      }),
    ]);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select(['actor_kind', 'meta'])
      .where('action', '=', 'qr_code.replaced')
      .where('entity_id', '=', vehicleId)
      .execute();
    expect(audit).toEqual([{ actor_kind: null, meta: expect.objectContaining({ kind: 'paid' }) }]);
    // The cooldown starts again with the paid code.
    const options = (
      await h.app.inject({
        method: 'GET',
        url: `/v1/vehicles/${vehicleId}/new-code`,
        headers: s.headers,
      })
    ).json();
    expect(options).toMatchObject({ reason: 'cooldown', paidAvailable: false });
  });

  it('works after a „Sperren“ when the free code is used up', async () => {
    const { s, vehicleId } = await setup();
    await age(vehicleId);
    const sperren = () =>
      h.app.inject({
        method: 'POST',
        url: `/v1/vehicles/${vehicleId}/tokens/revoke`,
        headers: s.headers,
        payload: { confirm: true },
      });
    await sperren();
    const free = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${vehicleId}/tokens`,
      headers: s.headers,
    });
    expect(free.statusCode).toBe(201);
    await age(vehicleId);
    await sperren();
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/v1/vehicles/${vehicleId}/tokens`,
          headers: s.headers,
        })
      ).statusCode,
    ).toBe(402);
    const res = await orderNewCode(s, vehicleId);
    expect(res.statusCode, res.body).toBe(200);
    await pay(sessionOf(res.json().url));
    expect((await tokens(vehicleId)).map((t) => t.status)).toEqual([
      'revoked',
      'revoked',
      'assigned',
    ]);
    expect((await ledger(vehicleId)).map((r) => r.kind)).toEqual(['initial', 'free', 'paid']);
  });

  it('issues exactly one code per payment, also for repeated webhooks, and always once paid', async () => {
    const { s, vehicleId } = await setup();
    await age(vehicleId);
    const res = await orderNewCode(s, vehicleId);
    const orderId = res.json().id as string;
    // Between the order and the payment staff issued a code: the cooldown runs again, the payment
    // is still honoured.
    const vehicles = h.app.get(VehiclesService);
    const staffId = (
      await h.db.selectFrom('users').select('id').where('email', '=', 'jonas@example.de').execute()
    )[0]!.id;
    await vehicles.overrideNewCode(staffId, vehicleId, 'Aufkleber gestohlen');
    await pay(sessionOf(res.json().url));
    // payment_intent.succeeded after checkout.session.completed: the same payment, no second code.
    const billing = h.app.get(BillingService);
    await billing.handle({
      kind: 'payment_completed',
      eventId: 'evt_duplicate_pi',
      paymentIntentId: 'pi_duplicate',
      metadata: { orderId, userId: 'x', kind: 'new_code' },
      amountCents: 300,
    });
    expect(await h.app.get(OrdersService).markPaid(orderId, null)).toBe(false);
    expect((await ledger(vehicleId)).map((r) => r.kind)).toEqual([
      'initial',
      'ops_override',
      'paid',
    ]);
    expect((await tokens(vehicleId)).filter((t) => t.status !== 'revoked')).toHaveLength(1);
  });

  it('a refund never revokes the code: recorded and audited once', async () => {
    const { s, vehicleId } = await setup();
    await age(vehicleId);
    const res = await orderNewCode(s, vehicleId);
    await pay(sessionOf(res.json().url));
    const { stripe_payment_intent: pi } = await h.db
      .selectFrom('decal_orders')
      .select('stripe_payment_intent')
      .where('id', '=', res.json().id)
      .executeTakeFirstOrThrow();
    const billing = h.app.get(BillingService);
    for (const eventId of ['evt_refund_1', 'evt_refund_2'])
      await billing.handle({
        kind: 'charge_refunded',
        eventId,
        paymentIntentId: pi,
        amountRefundedCents: 300,
      });
    const active = (await tokens(vehicleId)).filter((t) => t.status === 'assigned');
    expect(active).toHaveLength(1);
    const paid = (await ledger(vehicleId)).find((r) => r.kind === 'paid')!;
    expect(paid.qr_token_id).toBe(active[0]!.id);
    expect(paid.refunded_at).not.toBeNull();
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('meta')
      .where('action', '=', 'qr_code.payment_refunded')
      .where('entity_id', '=', vehicleId)
      .execute();
    expect(audit).toEqual([
      { meta: { orderId: res.json().id, refundedCents: 300, codeKept: true } },
    ]);
    // The scanner still reaches the owner.
    const { code_enc } = await h.db
      .selectFrom('qr_tokens')
      .select('code_enc')
      .where('id', '=', active[0]!.id)
      .executeTakeFirstOrThrow();
    const code = h.app.get<FieldCrypto>(CRYPTO).decrypt(code_enc);
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${code}` })).statusCode).toBe(200);
  });
});
