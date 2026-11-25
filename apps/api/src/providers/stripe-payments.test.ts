import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { PRICE_MISMATCH } from './ports';
import { StripePayments } from './stripe-payments';

/** A stub of the few Stripe calls `createCheckout` makes; no network. */
function stub(unitAmount: number) {
  const retrieve = vi.fn(async () => ({ unit_amount: unitAmount, currency: 'eur' }));
  const create = vi.fn(async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/x' }));
  const client = { prices: { retrieve }, checkout: { sessions: { create } } } as unknown as Stripe;
  return {
    payments: new StripePayments('sk_test_x', 'whsec_x', 'price_year', '', client),
    retrieve,
    create,
  };
}

const req = {
  customerId: 'cus_1',
  plan: 'standard' as const,
  locale: 'de' as const,
  successUrl: 'https://x/ok',
  cancelUrl: 'https://x/no',
  metadata: {},
};

describe('Stripe checkout charges exactly the displayed price (2026-11-25, 19,99 €)', () => {
  it('creates the session when the Stripe price matches, and reads the price only once', async () => {
    const s = stub(1999);
    await expect(s.payments.createCheckout({ ...req, expectedAmountCents: 1999 })).resolves.toEqual(
      {
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/x',
      },
    );
    await s.payments.createCheckout({ ...req, expectedAmountCents: 1999 });
    expect(s.retrieve).toHaveBeenCalledTimes(1);
    expect(s.create).toHaveBeenCalledTimes(2);
  });

  it('refuses an old 20,00 € price while the app shows 19,99 €, before any session exists', async () => {
    const s = stub(2000);
    await expect(
      s.payments.createCheckout({ ...req, expectedAmountCents: 1999 }),
    ).rejects.toMatchObject({ code: PRICE_MISMATCH });
    expect(s.create).not.toHaveBeenCalled();
  });
});
