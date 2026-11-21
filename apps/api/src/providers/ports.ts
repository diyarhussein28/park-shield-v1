export const MAILER = Symbol('MAILER');
export const CAPTCHA = Symbol('CAPTCHA');
export const PAYMENTS = Symbol('PAYMENTS');
export const PRINT = Symbol('PRINT');
export const PUSH = Symbol('PUSH');
export const APP_PUSH = Symbol('APP_PUSH');
export const SMS = Symbol('SMS');
export const AUDIT_BUCKET = Symbol('AUDIT_BUCKET');
export const SUPPORT_DESK = Symbol('SUPPORT_DESK');

/**
 * Write-once object storage for the audit stream (AD-17): S3 with Object Lock in COMPLIANCE mode.
 * `put` never replaces an object: the same content again is "exists", different content an error.
 */
export interface AuditBucket {
  put(key: string, body: Buffer, retainUntil: Date): Promise<'created' | 'exists'>;
  get(key: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
}

export interface SupportTicket {
  email: string;
  name: string | null;
  subject: string;
  body: string;
  /** e.g. "plus" for the 48 h reply promise, the topic, "signed_in". */
  tags: string[];
  locale: 'de' | 'en';
}

/** Zammad is the only ticket store (AD-20): the contact form creates the ticket there directly. */
export interface SupportDesk {
  createTicket(ticket: SupportTicket): Promise<{ number: string }>;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Web Push via VAPID (no provider account). Returns the push service's HTTP status. */
export interface PushSender {
  send(
    target: PushTarget,
    payload: string,
    opts: { ttlSeconds: number; urgency: 'normal' | 'high' },
  ): Promise<{ statusCode: number }>;
}

/**
 * One push to the native app (FCM; iOS through APNs). Privacy: only a generic text and ids. Never the
 * scanner's message, a photo, the licence plate or a name: the app loads the details from our API.
 */
export interface AppPushMessage {
  /** FCM registration token of one device. */
  token: string;
  title: string;
  body: string;
  /** String values only (FCM): alertId, type, kind. */
  data: Record<string, string>;
  /** iOS notification category / Android click action that carries the "Ich komme" action button. */
  category?: string;
  /** High priority on Android, time-sensitive on iOS. */
  urgent: boolean;
  ttlSeconds: number;
  /** A reminder replaces the first notification of the same alert. */
  collapseKey?: string;
}

export type AppPushResult =
  { ok: true; messageId: string } | { ok: false; invalidToken: boolean; error: string };

export interface AppPushSender {
  send(msg: AppPushMessage): Promise<AppPushResult>;
}

/** Plain-text SMS through Twilio (NT-07). SMS has no buttons: replies go through the link in the text. */
export interface SmsSender {
  send(input: {
    /** E.164 with the leading "+" */
    to: string;
    body: string;
    /** Template name for the dev inbox and logs; never personal data. */
    tag: string;
  }): Promise<{ messageId: string }>;
}

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  country: 'DE';
}

/** A postal address as the payment provider stores it (any country). */
export interface PostalAddress {
  name: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

export interface PrintJob {
  orderId: string;
  product: 'uv_vinyl_sticker' | 'a6_dashboard_card' | 'nfc_vinyl_sticker';
  quantity: number;
  /** Print-ready PDF: CMYK, 3 mm bleed. */
  pdf: Buffer;
  address: ShippingAddress;
}

/** Print-and-ship partner (API or daily SFTP drop, chosen in Phase 0). */
export interface PrintPartner {
  submit(job: PrintJob): Promise<{ reference: string }>;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Template name; used for provider tagging and the dev inbox, never contains personal data. */
  tag: string;
  /** Where a reply goes (support mails: the customer). */
  replyTo?: string;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

export interface Captcha {
  verify(solution: string | undefined): Promise<boolean>;
}

/** The single all-inclusive plan (owner decision 2026-11-21). */
export type PaidPlan = 'standard';

export interface CheckoutRequest {
  customerId: string;
  plan: PaidPlan;
  locale: 'de' | 'en';
  stripeCouponId?: string | null;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

/** One-time purchase (replacement decal, add-ons). Amount is gross, VAT included. */
export interface PaymentCheckoutRequest {
  customerId: string;
  amountCents: number;
  description: string;
  locale: 'de' | 'en';
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface Invoice {
  id: string;
  number: string;
  createdAt: Date;
  totalCents: number;
  pdfUrl: string | null;
}

/** Provider-neutral billing events, produced from Stripe webhooks (or the local fake). */
export type BillingEvent =
  | {
      kind: 'checkout_completed';
      eventId: string;
      customerId: string;
      subscriptionId: string;
      metadata: Record<string, string>;
      periodStart: Date;
      periodEnd: Date;
    }
  | {
      kind: 'subscription_updated';
      eventId: string;
      subscriptionId: string;
      status: 'active' | 'past_due' | 'canceled' | 'incomplete' | 'expired';
      periodStart: Date | null;
      periodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
      /** Billing interval of the current period, when the provider reports it. */
      interval?: 'year' | 'month';
    }
  | {
      kind: 'payment_failed';
      eventId: string;
      subscriptionId: string;
      attemptCount: number;
      nextAttemptAt: Date | null;
    }
  | {
      kind: 'payment_completed';
      eventId: string;
      paymentIntentId: string | null;
      metadata: Record<string, string>;
    }
  | {
      kind: 'charge_refunded';
      eventId: string;
      paymentIntentId: string | null;
      amountRefundedCents: number;
    }
  | { kind: 'ignored'; eventId: string; type: string };

/** What was paid for a subscription period or a one-time order, and how much went back already. */
export interface Charge {
  paymentIntentId: string;
  amountCents: number;
  refundedCents: number;
}

export interface CouponInput {
  code: string;
  kind: 'percent_off' | 'amount_off';
  value: number;
  maxRedemptions: number | null;
  validUntil: Date | null;
}

export interface Payments {
  /** Latest paid charge of a subscription, or the charge of a one-time payment. */
  findCharge(ref: { subscriptionId: string } | { paymentIntentId: string }): Promise<Charge | null>;
  refund(input: {
    paymentIntentId: string;
    amountCents: number;
    metadata: Record<string, string>;
  }): Promise<{ refundId: string }>;
  /** Withdrawal (AD-12): the subscription ends now, without proration by the provider. */
  cancelNow(subscriptionId: string): Promise<void>;
  /** "Extra months" promo: the next renewal moves to `until`, free of charge. */
  extendPeriod(subscriptionId: string, until: Date): Promise<void>;
  /** AD-13: promo codes are synced to Stripe Coupons (one-off discount on the first year). */
  createCoupon(input: CouponInput): Promise<{ couponId: string }>;
  /** Stops new redemptions; existing discounts stay. */
  deleteCoupon(couponId: string): Promise<void>;
  ensureCustomer(input: { email: string; userId: string; locale: 'de' | 'en' }): Promise<string>;
  /** Prefills name and billing address from the sign-up profile before checkout. */
  updateCustomer(customerId: string, address: PostalAddress): Promise<void>;
  /** Name and billing address the customer entered at checkout (required there); null if none. */
  billingAddress(customerId: string): Promise<PostalAddress | null>;
  /** Account deletion: removes the customer and cancels subscriptions immediately. Idempotent. */
  deleteCustomer(customerId: string): Promise<{ reference: string }>;
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  /**
   * The completed checkout read straight from the provider, for when the customer returns before (or
   * without) the webhook. null while the session is not paid yet. Same event shape as the webhook.
   */
  checkoutCompletion(
    ref: { sessionId: string } | { customerId: string },
  ): Promise<BillingEvent | null>;
  createPaymentCheckout(req: PaymentCheckoutRequest): Promise<{ id: string; url: string }>;
  /** Ends the subscription at `at`, or at the end of the current period when `at` is null. */
  cancelAt(subscriptionId: string, at: Date | null): Promise<{ periodEnd: Date | null }>;
  /** Takes back a scheduled cancellation: the subscription renews again. */
  resume(subscriptionId: string): Promise<void>;
  /**
   * § 309 Nr. 9 BGB: after the current (annual) period the subscription continues month by month at
   * the monthly price of the same plan. Idempotent.
   */
  scheduleMonthly(subscriptionId: string, plan: PaidPlan): Promise<void>;
  listInvoices(customerId: string): Promise<Invoice[]>;
  /** Hosted page where the customer changes the payment method (OW-11). */
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  parseWebhook(rawBody: Buffer, signature: string | undefined): Promise<BillingEvent>;
}
