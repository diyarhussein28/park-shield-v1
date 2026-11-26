import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WithdrawalsService } from '../legal/withdrawals.service';
import { BillingService } from './billing.service';
import { parseSubscriber } from '../providers/revenuecat';
import { storeStatus } from './store-sync.service';
import { unifiedStatus } from './unified-status';
import {
  completeProfile,
  createHarness,
  lastMail,
  resetState,
  signIn,
  verifyPhone,
  type Harness,
  type Session,
} from '../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const ORDER = { plan: 'standard', immediateStart: true, immediateStartVersion: 1, termsVersion: 1 };

async function buyLifetime(email: string): Promise<Session> {
  const s = await signIn(h, email);
  await completeProfile(h, s);
  await verifyPhone(h, s);
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/billing/checkout',
    headers: s.headers,
    payload: { ...ORDER, term: 'lifetime' },
  });
  expect(res.statusCode, res.body).toBe(200);
  const sessionId = new URL(res.json().url).searchParams.get('session')!;
  const session = await h.app.inject({
    method: 'GET',
    url: `/v1/dev/payments/sessions/${sessionId}`,
  });
  expect(session.json().amountCents).toBe(2999);
  expect(session.json().title).toMatch(/einmalig/);
  const done = await h.app.inject({
    method: 'POST',
    url: '/v1/dev/payments/complete',
    payload: { sessionId },
  });
  expect(done.statusCode, done.body).toBe(200);
  return s;
}

describe('lifetime plan (owner decision 2026-11-26)', () => {
  it('lists the lifetime price next to the yearly one', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/plans' });
    expect(res.json()[0]).toMatchObject({
      priceYearGrossCents: 1999,
      priceLifetimeGrossCents: 2999,
    });
  });

  it('is paid once on Stripe and becomes a contract without end, renewal or cancellation', async () => {
    const s = await buyLifetime('lifetime@example.de');
    const view = await h.app.inject({
      method: 'GET',
      url: '/v1/billing/subscription',
      headers: s.headers,
    });
    const sub = view.json().subscription;
    expect(sub).toMatchObject({
      plan: 'standard',
      status: 'active',
      lifetime: true,
      willRenew: false,
      unifiedStatus: 'ACTIVE',
      currentPeriodEnd: null,
      interval: 'lifetime',
    });
    expect(sub.contractNo).toMatch(/^PS-/);

    const text = (await lastMail(h, 'contract_confirmation'))?.text.replace(/\u00a0/g, ' ');
    expect(text).toContain('29,99 € einmalig');
    expect(text).toContain('dauerhaft, ohne Verlängerung');
    expect(text).toContain('nichts zu kündigen');
    expect(text).not.toContain('/ Jahr');

    // Nothing renews: the renewal jobs and the expiry sweep never touch it.
    const billing = h.app.get(BillingService);
    await billing.expireEnded();
    const row = await h.db
      .selectFrom('subscriptions')
      .select(['status', 'interval', 'stripe_payment_intent', 'current_period_end'])
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'active', interval: 'lifetime', current_period_end: null });
    expect(row.stripe_payment_intent).toMatch(/^pi_fake_/);

    // A second purchase is refused like for the yearly plan.
    const again = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: s.headers,
      payload: { ...ORDER, term: 'lifetime' },
    });
    expect(again.statusCode).toBe(409);

    // A cancellation finds no contract to end (there is nothing to cancel).
    const cancel = await h.app.inject({
      method: 'POST',
      url: '/v1/legal/cancellations',
      payload: {
        type: 'ordinary',
        name: 'Lena Life',
        email: 'lifetime@example.de',
        contractNo: sub.contractNo,
      },
    });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const req = await h.db
      .selectFrom('cancellation_requests')
      .select(['status', 'subscription_id'])
      .executeTakeFirstOrThrow();
    expect(req).toEqual({ status: 'needs_review', subscription_id: null });
    expect(
      (
        await h.db
          .selectFrom('subscriptions')
          .select('cancel_at_period_end')
          .executeTakeFirstOrThrow()
      ).cancel_at_period_end,
    ).toBe(false);
  });

  it('takes no promo code (coupons belong to the yearly plan)', async () => {
    const s = await signIn(h, 'promo-life@example.de');
    await completeProfile(h, s);
    await verifyPhone(h, s);
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: s.headers,
      payload: { ...ORDER, term: 'lifetime', promoCode: 'START' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('promo_invalid');
  });

  it('can be withdrawn: refund from the one-time payment, contract withdrawn', async () => {
    await buyLifetime('widerruf-life@example.de');
    const { contract_no } = await h.db
      .selectFrom('subscriptions')
      .select('contract_no')
      .executeTakeFirstOrThrow();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/legal/withdrawals',
      payload: { name: 'Lea Lang', contractRef: contract_no!, email: 'widerruf-life@example.de' },
    });
    expect(res.statusCode).toBe(200);
    const { id } = await h.db
      .selectFrom('withdrawal_requests')
      .select('id')
      .executeTakeFirstOrThrow();
    await h.app.get(WithdrawalsService).process(id);
    const sub = await h.db.selectFrom('subscriptions').select('status').executeTakeFirstOrThrow();
    expect(sub.status).toBe('withdrawn');
    const refund = await h.db
      .selectFrom('refunds')
      .select('refund_gross_cents')
      .executeTakeFirstOrThrow();
    expect(refund.refund_gross_cents).toBeGreaterThan(0);
    expect(refund.refund_gross_cents).toBeLessThanOrEqual(2999);
  });
});

describe('lifetime from the stores (pure)', () => {
  const body = (store = 'app_store') => ({
    subscriber: {
      entitlements: { parkshield_pro: { product_identifier: 'lifetime', expires_date: null } },
      subscriptions: {},
      non_subscriptions: {
        lifetime: [
          {
            id: 'np_1',
            purchase_date: '2026-11-26T10:00:00Z',
            original_purchase_date: '2026-11-26T10:00:00Z',
            store,
            is_sandbox: true,
            store_transaction_id: '2000000123',
            price: { amount: 29.99, currency: 'EUR' },
          },
        ],
      },
      management_url: null,
    },
  });

  it('reads the non-consumable as a lifetime entitlement that never expires', () => {
    const sub = parseSubscriber('u1', body(), 'parkshield_pro')!;
    expect(sub).toMatchObject({
      store: 'app_store',
      productId: 'lifetime',
      lifetime: true,
      willRenew: false,
      priceCents: 2999,
      transactionId: '2000000123',
    });
    const far = new Date('2099-01-01');
    expect(storeStatus(sub, undefined, far).status).toBe('active');
    expect(storeStatus({ ...sub, refundedAt: new Date() }, undefined).status).toBe('expired');
  });

  it('a lifetime contract is ACTIVE, never „cancellation scheduled“', () => {
    expect(
      unifiedStatus({
        status: 'active',
        cancel_at_period_end: false,
        will_renew: false,
        refunded_at: null,
        withdrawn_at: null,
        interval: 'lifetime',
      }),
    ).toBe('ACTIVE');
  });
});
