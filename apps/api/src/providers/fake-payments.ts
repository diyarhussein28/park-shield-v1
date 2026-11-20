import type { Redis } from 'ioredis';
import { randomToken } from '../core/crypto';
import type {
  BillingEvent,
  Charge,
  CheckoutRequest,
  CouponInput,
  Invoice,
  PaymentCheckoutRequest,
  Payments,
  PostalAddress,
} from './ports';

const key = (...parts: string[]) => `dev:payments:${parts.join(':')}`;
const DAY = 86_400_000;

export type FakeSession =
  | (CheckoutRequest & { id: string; kind: 'subscription' })
  | (PaymentCheckoutRequest & { id: string; kind: 'payment' });

/**
 * Local stand-in for Stripe while STRIPE_SECRET_KEY is empty. State lives in Valkey so it survives API
 * restarts. The dev checkout page completes a session, which produces the same BillingEvent a real
 * webhook would, so BillingService code paths are identical.
 */
export class FakePayments implements Payments {
  constructor(
    private readonly valkey: Redis,
    private readonly webBaseUrl: string,
  ) {}

  async ensureCustomer(): Promise<string> {
    return `cus_fake_${randomToken(9)}`;
  }

  async deleteCustomer(customerId: string): Promise<{ reference: string }> {
    return { reference: `fake-deleted:${customerId}` };
  }

  /** Stored like Stripe's customer record, so tests can check the prefill. */
  async updateCustomer(customerId: string, address: PostalAddress): Promise<void> {
    await this.valkey.set(key('customer', customerId), JSON.stringify(address), 'EX', 86_400);
  }

  async customer(customerId: string): Promise<PostalAddress | null> {
    const raw = await this.valkey.get(key('customer', customerId));
    return raw ? (JSON.parse(raw) as PostalAddress) : null;
  }

  /**
   * The fake checkout collects no address: the prefilled one, else a fixed sample stands in for
   * Stripe's billing address.
   */
  async billingAddress(customerId: string): Promise<PostalAddress | null> {
    if (!customerId.startsWith('cus_fake_')) return null;
    const stored = await this.customer(customerId);
    if (stored) return stored;
    return {
      name: 'Erika Mustermann',
      line1: 'Musterstraße 12',
      postalCode: '50667',
      city: 'Köln',
      country: 'DE',
    };
  }

  private async store(session: FakeSession): Promise<{ id: string; url: string }> {
    await this.valkey.set(key('session', session.id), JSON.stringify(session), 'EX', 3600);
    return {
      id: session.id,
      url: `${this.webBaseUrl}/dev/checkout?session=${encodeURIComponent(session.id)}`,
    };
  }

  createCheckout(req: CheckoutRequest) {
    const id = `cs_fake_${randomToken(12)}`;
    return this.store({
      ...req,
      successUrl: req.successUrl.replace('{CHECKOUT_SESSION_ID}', id),
      id,
      kind: 'subscription',
    });
  }

  /** The dev checkout page completes the session synchronously, so there is nothing to pick up. */
  async checkoutCompletion(): Promise<BillingEvent | null> {
    return null;
  }

  createPaymentCheckout(req: PaymentCheckoutRequest) {
    return this.store({ ...req, id: `cs_fake_${randomToken(12)}`, kind: 'payment' });
  }

  async getSession(id: string): Promise<FakeSession | null> {
    const raw = await this.valkey.get(key('session', id));
    return raw ? (JSON.parse(raw) as FakeSession) : null;
  }

  /** Simulates a successful payment, with a PDF invoice. */
  async complete(sessionId: string, amountCents: number): Promise<BillingEvent | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    await this.valkey.del(key('session', sessionId));
    const now = new Date();
    const invoice: Invoice = {
      id: `in_fake_${randomToken(9)}`,
      // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_insecure_random_generator -- display number of a local fake invoice
      number: `DEV-${now.getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`,
      createdAt: now,
      totalCents: amountCents,
      pdfUrl: null,
    };
    await this.valkey.lpush(key('invoices', session.customerId), JSON.stringify(invoice));
    const eventId = `evt_fake_${randomToken(9)}`;
    const paymentIntentId = `pi_fake_${randomToken(9)}`;
    await this.valkey.set(key('charge', paymentIntentId), String(amountCents));
    if (session.kind === 'payment') {
      return { kind: 'payment_completed', eventId, paymentIntentId, metadata: session.metadata };
    }
    const subscriptionId = `sub_fake_${randomToken(9)}`;
    await this.valkey.set(key('subscription-charge', subscriptionId), paymentIntentId);
    return {
      kind: 'checkout_completed',
      eventId,
      customerId: session.customerId,
      subscriptionId,
      metadata: session.metadata,
      periodStart: now,
      periodEnd: new Date(now.getTime() + 365 * DAY),
    };
  }

  async findCharge(
    ref: { subscriptionId: string } | { paymentIntentId: string },
  ): Promise<Charge | null> {
    const pi =
      'paymentIntentId' in ref
        ? ref.paymentIntentId
        : await this.valkey.get(key('subscription-charge', ref.subscriptionId));
    if (!pi) return null;
    const amount = await this.valkey.get(key('charge', pi));
    if (amount === null) return null;
    const refunded = await this.valkey.get(key('refunded', pi));
    return {
      paymentIntentId: pi,
      amountCents: Number(amount),
      refundedCents: Number(refunded ?? 0),
    };
  }

  /** Same rule as Stripe: never more than what is left of the charge. */
  async refund(input: { paymentIntentId: string; amountCents: number }) {
    const charge = await this.findCharge({ paymentIntentId: input.paymentIntentId });
    if (!charge) throw new Error('No such payment_intent');
    const after = await this.valkey.incrby(
      key('refunded', input.paymentIntentId),
      input.amountCents,
    );
    if (after > charge.amountCents) {
      await this.valkey.decrby(key('refunded', input.paymentIntentId), input.amountCents);
      throw new Error('Refund amount is greater than the unrefunded amount of the charge');
    }
    return { refundId: `re_fake_${randomToken(9)}` };
  }

  async cancelNow(): Promise<void> {}

  async extendPeriod(): Promise<void> {}

  async createCoupon(input: CouponInput): Promise<{ couponId: string }> {
    return { couponId: `coupon_fake_${input.code.toLowerCase()}` };
  }

  async deleteCoupon(): Promise<void> {}

  async portalUrl(_customerId: string, returnUrl: string): Promise<string> {
    return `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}portal=dev`;
  }

  async cancelAt(): Promise<{ periodEnd: Date | null }> {
    return { periodEnd: null };
  }

  async resume(): Promise<void> {}

  async scheduleMonthly(): Promise<void> {}

  async listInvoices(customerId: string): Promise<Invoice[]> {
    const rows = await this.valkey.lrange(key('invoices', customerId), 0, 23);
    return rows.map((r) => {
      const i = JSON.parse(r) as Invoice;
      return {
        ...i,
        createdAt: new Date(i.createdAt),
        pdfUrl: `/v1/dev/payments/invoices/${i.id}.pdf`,
      };
    });
  }

  async findInvoice(invoiceId: string): Promise<Invoice | null> {
    for await (const keys of this.valkey.scanStream({ match: key('invoices', '*') })) {
      for (const k of keys as string[]) {
        for (const r of await this.valkey.lrange(k, 0, -1)) {
          const i = JSON.parse(r) as Invoice;
          if (i.id === invoiceId) return { ...i, createdAt: new Date(i.createdAt) };
        }
      }
    }
    return null;
  }

  async parseWebhook(): Promise<BillingEvent> {
    throw new Error('Stripe webhooks are not used in fake mode');
  }
}
