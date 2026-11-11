import { sql } from 'kysely';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { StripePayments } from '../providers/stripe-payments';
import { createHarness, lastMail, resetState, subscribe, type Harness } from '../test/harness';
import { BillingService } from './billing.service';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const sub = () => h.db.selectFrom('subscriptions').selectAll().executeTakeFirstOrThrow();

describe('subscription sync and dunning (US-08)', () => {
  it('marks a failed renewal past_due and reminds the customer with the next attempt', async () => {
    await subscribe(h, 'late@example.de');
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/dev/payments/fail',
      payload: { email: 'late@example.de' },
    });
    expect(res.statusCode).toBe(200);
    expect((await sub()).status).toBe('past_due');
    const mail = await lastMail(h, 'payment_failed');
    expect(mail?.text).toMatch(/Wir versuchen es am \d+\. \w+ \d{4} erneut/);

    await h.app.inject({
      method: 'POST',
      url: '/v1/dev/payments/fail',
      payload: { email: 'late@example.de', final: true },
    });
    expect((await lastMail(h, 'payment_failed_final'))?.to).toBe('late@example.de');
  });

  it('expires ended subscriptions, which removes access', async () => {
    const s = await subscribe(h, 'ended@example.de');
    await sql`UPDATE subscriptions SET cancel_at_period_end = true, current_period_end = now() - interval '2 days'`.execute(
      h.db,
    );
    expect(await h.app.get(BillingService).expireEnded()).toBe(1);
    expect((await sub()).status).toBe('expired');
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'X', plate: 'K-X 1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('keeps a renewing subscription that is only briefly past its period end', async () => {
    await subscribe(h, 'renewing@example.de');
    await sql`UPDATE subscriptions SET current_period_end = now() - interval '2 days'`.execute(
      h.db,
    );
    expect(await h.app.get(BillingService).expireEnded()).toBe(0);
  });
});

describe('Stripe webhook mapping', () => {
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- test fixture, not a real key
  const secret = 'whsec_test_secret';
  const retrieved: Record<string, unknown> = {
    id: 'sub_123',
    status: 'past_due',
    cancel_at_period_end: false,
    cancel_at: null,
    items: { data: [{ current_period_start: 1_800_000_000, current_period_end: 1_831_536_000 }] },
  };
  const real = new Stripe('sk_test_dummy');
  const client = {
    webhooks: real.webhooks,
    subscriptions: { retrieve: async () => retrieved },
  } as unknown as Stripe;
  const payments = new StripePayments(
    'sk_test_dummy',
    secret,
    { plus: 'price_p', premium: '' },
    client,
  );
  const sign = (event: object) => {
    const payload = JSON.stringify(event);
    return {
      raw: Buffer.from(payload),
      sig: real.webhooks.generateTestHeaderString({ payload, secret }),
    };
  };

  it('rejects a bad signature', async () => {
    const { raw } = sign({ id: 'evt_1', type: 'ping', data: { object: {} } });
    await expect(payments.parseWebhook(raw, 't=1,v1=bad')).rejects.toThrow();
  });

  it('re-reads the current subscription instead of trusting a possibly stale payload', async () => {
    const { raw, sig } = sign({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_123', status: 'active' } },
    });
    expect(await payments.parseWebhook(raw, sig)).toEqual({
      kind: 'subscription_updated',
      eventId: 'evt_2',
      subscriptionId: 'sub_123',
      status: 'past_due',
      periodStart: new Date(1_800_000_000_000),
      periodEnd: new Date(1_831_536_000_000),
      cancelAtPeriodEnd: false,
    });
  });

  it('maps failed invoices from both old and new API shapes', async () => {
    for (const invoice of [
      { subscription: 'sub_123', attempt_count: 2, next_payment_attempt: 1_800_100_000 },
      {
        parent: { subscription_details: { subscription: 'sub_123' } },
        attempt_count: 4,
        next_payment_attempt: null,
      },
    ]) {
      const { raw, sig } = sign({
        id: 'evt_3',
        type: 'invoice.payment_failed',
        data: { object: invoice },
      });
      const e = await payments.parseWebhook(raw, sig);
      expect(e).toMatchObject({
        kind: 'payment_failed',
        subscriptionId: 'sub_123',
        attemptCount: invoice.attempt_count,
      });
    }
  });

  it('treats deletion as canceled and ignores unrelated events', async () => {
    const del = sign({
      id: 'evt_4',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_9' } },
    });
    expect(await payments.parseWebhook(del.raw, del.sig)).toMatchObject({
      kind: 'subscription_updated',
      status: 'canceled',
    });
    const other = sign({ id: 'evt_5', type: 'charge.refunded', data: { object: {} } });
    expect(await payments.parseWebhook(other.raw, other.sig)).toEqual({
      kind: 'ignored',
      eventId: 'evt_5',
      type: 'charge.refunded',
    });
  });
});
