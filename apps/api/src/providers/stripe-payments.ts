import Stripe from 'stripe';
import type {
  BillingEvent,
  Charge,
  CheckoutRequest,
  CouponInput,
  Invoice,
  PaidPlan,
  PaymentCheckoutRequest,
  Payments,
} from './ports';

type SubStatus = Extract<BillingEvent, { kind: 'subscription_updated' }>['status'];

function mapStatus(s: string): SubStatus {
  if (s === 'active' || s === 'trialing') return 'active';
  if (s === 'past_due' || s === 'unpaid') return 'past_due';
  if (s === 'canceled') return 'canceled';
  if (s === 'incomplete_expired') return 'expired';
  return 'incomplete';
}

const toDate = (sec: number | null | undefined) => (sec ? new Date(sec * 1000) : null);

// Recent API versions moved the billing period from the subscription onto its items.
function period(sub: Record<string, unknown>): { start: Date | null; end: Date | null } {
  const item = (sub.items as { data?: Record<string, unknown>[] } | undefined)?.data?.[0] ?? {};
  const start = (sub.current_period_start ?? item.current_period_start) as number | undefined;
  const end = (sub.current_period_end ?? item.current_period_end) as number | undefined;
  return { start: toDate(start), end: toDate(end) };
}

export class StripePayments implements Payments {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly prices: Record<PaidPlan, string>,
    client?: Stripe,
  ) {
    this.stripe = client ?? new Stripe(secretKey);
  }

  async findCharge(
    ref: { subscriptionId: string } | { paymentIntentId: string },
  ): Promise<Charge | null> {
    let pi: string | null;
    if ('paymentIntentId' in ref) pi = ref.paymentIntentId;
    else {
      const invoices = await this.stripe.invoices.list({
        subscription: ref.subscriptionId,
        status: 'paid',
        limit: 1,
      });
      const invoice = invoices.data[0];
      if (!invoice?.id) return null;
      // Since the 2025 API versions an invoice's payments are their own resource.
      const payments = await this.stripe.invoicePayments.list({ invoice: invoice.id, limit: 1 });
      const intent = payments.data[0]?.payment.payment_intent;
      pi = typeof intent === 'string' ? intent : (intent?.id ?? null);
    }
    if (!pi) return null;
    const intent = await this.stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] });
    const charge = intent.latest_charge as Stripe.Charge | string | null;
    return {
      paymentIntentId: pi,
      amountCents: intent.amount_received,
      refundedCents: typeof charge === 'object' && charge ? charge.amount_refunded : 0,
    };
  }

  async refund(input: {
    paymentIntentId: string;
    amountCents: number;
    metadata: Record<string, string>;
  }): Promise<{ refundId: string }> {
    const r = await this.stripe.refunds.create({
      payment_intent: input.paymentIntentId,
      amount: input.amountCents,
      reason: 'requested_by_customer',
      metadata: input.metadata,
    });
    return { refundId: r.id };
  }

  async cancelNow(subscriptionId: string): Promise<void> {
    try {
      await this.stripe.subscriptions.cancel(subscriptionId, { prorate: false });
    } catch (err) {
      if ((err as { code?: string }).code !== 'resource_missing') throw err;
    }
  }

  async extendPeriod(subscriptionId: string, until: Date): Promise<void> {
    // A trial on a running subscription moves the next invoice to its end without charging now.
    await this.stripe.subscriptions.update(subscriptionId, {
      trial_end: Math.floor(until.getTime() / 1000),
      proration_behavior: 'none',
    });
  }

  async createCoupon(input: CouponInput): Promise<{ couponId: string }> {
    const c = await this.stripe.coupons.create({
      name: input.code,
      duration: 'once',
      ...(input.kind === 'percent_off'
        ? { percent_off: input.value }
        : { amount_off: input.value, currency: 'eur' }),
      ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
      ...(input.validUntil ? { redeem_by: Math.floor(input.validUntil.getTime() / 1000) } : {}),
      metadata: { promoCode: input.code },
    });
    return { couponId: c.id };
  }

  async deleteCoupon(couponId: string): Promise<void> {
    try {
      await this.stripe.coupons.del(couponId);
    } catch (err) {
      if ((err as { code?: string }).code !== 'resource_missing') throw err;
    }
  }

  async portalUrl(customerId: string, returnUrl: string): Promise<string> {
    const s = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return s.url;
  }

  async ensureCustomer(input: {
    email: string;
    userId: string;
    locale: 'de' | 'en';
  }): Promise<string> {
    const c = await this.stripe.customers.create({
      email: input.email,
      preferred_locales: [input.locale],
      metadata: { userId: input.userId },
    });
    return c.id;
  }

  /**
   * GDPR erasure at Stripe (AD-11): deleting the customer cancels open subscriptions at once and removes
   * payment methods. Invoices stay with Stripe for the statutory retention (§ 147 AO).
   */
  async deleteCustomer(customerId: string): Promise<{ reference: string }> {
    try {
      const r = await this.stripe.customers.del(customerId);
      return { reference: `stripe:${r.id}:deleted` };
    } catch (err) {
      // Already deleted (e.g. a retried step) counts as done.
      if ((err as { code?: string }).code === 'resource_missing') {
        return { reference: `stripe:${customerId}:missing` };
      }
      throw err;
    }
  }

  async createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }> {
    const price = this.prices[req.plan];
    if (!price) throw new Error(`No Stripe price configured for plan ${req.plan}`);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: req.customerId,
      line_items: [{ price, quantity: 1 }],
      discounts: req.stripeCouponId ? [{ coupon: req.stripeCouponId }] : undefined,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      locale: req.locale,
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      billing_address_collection: 'required',
      metadata: req.metadata,
      subscription_data: { metadata: req.metadata },
    });
    if (!session.url) throw new Error('Stripe returned no checkout URL');
    return { id: session.id, url: session.url };
  }

  async createPaymentCheckout(req: PaymentCheckoutRequest): Promise<{ id: string; url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: req.customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: req.amountCents,
            tax_behavior: 'inclusive', // consumer prices include VAT (PAngV)
            product_data: { name: req.description },
          },
        },
      ],
      invoice_creation: { enabled: true },
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      locale: req.locale,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      metadata: req.metadata,
      payment_intent_data: { metadata: req.metadata },
    });
    if (!session.url) throw new Error('Stripe returned no checkout URL');
    return { id: session.id, url: session.url };
  }

  async cancelAt(subscriptionId: string, at: Date | null): Promise<{ periodEnd: Date | null }> {
    const sub = await this.stripe.subscriptions.update(
      subscriptionId,
      at ? { cancel_at: Math.floor(at.getTime() / 1000) } : { cancel_at_period_end: true },
    );
    return { periodEnd: period(sub as unknown as Record<string, unknown>).end };
  }

  async listInvoices(customerId: string): Promise<Invoice[]> {
    const list = await this.stripe.invoices.list({ customer: customerId, limit: 24 });
    return list.data.map((i) => ({
      id: i.id ?? '',
      number: i.number ?? '',
      createdAt: new Date(i.created * 1000),
      totalCents: i.total,
      pdfUrl: i.invoice_pdf ?? null,
    }));
  }

  async parseWebhook(rawBody: Buffer, signature: string | undefined): Promise<BillingEvent> {
    if (!signature) throw new Error('missing Stripe-Signature');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const obj = event.data.object as unknown as Record<string, unknown>;

    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
      const sub = await this.stripe.subscriptions.retrieve(String(obj.subscription));
      const p = period(sub as unknown as Record<string, unknown>);
      return {
        kind: 'checkout_completed',
        eventId: event.id,
        customerId: String(obj.customer),
        subscriptionId: sub.id,
        metadata: (obj.metadata as Record<string, string>) ?? {},
        periodStart: p.start ?? new Date(),
        periodEnd: p.end ?? new Date(),
      };
    }
    if (event.type === 'checkout.session.completed' && obj.mode === 'payment') {
      return {
        kind: 'payment_completed',
        eventId: event.id,
        paymentIntentId: (obj.payment_intent as string | null) ?? null,
        metadata: (obj.metadata as Record<string, string>) ?? {},
      };
    }
    if (event.type === 'customer.subscription.deleted') {
      const p = period(obj);
      return {
        kind: 'subscription_updated',
        eventId: event.id,
        subscriptionId: String(obj.id),
        status: 'canceled',
        periodStart: p.start,
        periodEnd: p.end,
        cancelAtPeriodEnd: true,
      };
    }
    if (event.type === 'customer.subscription.updated' || event.type === 'invoice.paid') {
      // Webhooks can arrive out of order: read the current state instead of trusting the payload.
      const id = event.type === 'invoice.paid' ? invoiceSubscription(obj) : String(obj.id);
      if (!id) return { kind: 'ignored', eventId: event.id, type: event.type };
      return { ...(await this.currentState(id)), eventId: event.id };
    }
    if (event.type === 'invoice.payment_failed') {
      const subscriptionId = invoiceSubscription(obj);
      if (subscriptionId) {
        return {
          kind: 'payment_failed',
          eventId: event.id,
          subscriptionId,
          attemptCount: Number(obj.attempt_count ?? 1),
          nextAttemptAt: toDate(obj.next_payment_attempt as number | null | undefined),
        };
      }
    }
    return { kind: 'ignored', eventId: event.id, type: event.type };
  }

  private async currentState(
    subscriptionId: string,
  ): Promise<Omit<Extract<BillingEvent, { kind: 'subscription_updated' }>, 'eventId'>> {
    const sub = (await this.stripe.subscriptions.retrieve(subscriptionId)) as unknown as Record<
      string,
      unknown
    >;
    const p = period(sub);
    return {
      kind: 'subscription_updated',
      subscriptionId,
      status: mapStatus(String(sub.status)),
      periodStart: p.start,
      periodEnd: p.end,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end) || Boolean(sub.cancel_at),
    };
  }
}

function invoiceSubscription(invoice: Record<string, unknown>): string | undefined {
  const parent = invoice.parent as { subscription_details?: { subscription?: string } } | undefined;
  return (invoice.subscription as string | undefined) ?? parent?.subscription_details?.subscription;
}
