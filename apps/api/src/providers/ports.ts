export const MAILER = Symbol('MAILER');
export const CAPTCHA = Symbol('CAPTCHA');
export const PAYMENTS = Symbol('PAYMENTS');
export const PRINT = Symbol('PRINT');
export const PUSH = Symbol('PUSH');
export const WHATSAPP = Symbol('WHATSAPP');
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

export type WhatsAppTemplate = 'ps_otp' | 'ps_alert' | 'ps_test' | 'ps_followup';

/** WhatsApp Business utility/authentication templates via the BSP (360dialog). */
export interface WhatsAppSender {
  sendTemplate(input: {
    /** E.164 without the leading "+" */
    to: string;
    template: WhatsAppTemplate;
    lang: 'de' | 'en';
    params: string[];
    /** Quick-reply button payloads, in template button order (NT-02). */
    buttons?: string[];
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
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

export interface Captcha {
  verify(solution: string | undefined): Promise<boolean>;
}

export type PaidPlan = 'plus' | 'premium';

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
  /** Account deletion: removes the customer and cancels subscriptions immediately. Idempotent. */
  deleteCustomer(customerId: string): Promise<{ reference: string }>;
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  createPaymentCheckout(req: PaymentCheckoutRequest): Promise<{ id: string; url: string }>;
  /** Ends the subscription at `at`, or at the end of the current period when `at` is null. */
  cancelAt(subscriptionId: string, at: Date | null): Promise<{ periodEnd: Date | null }>;
  listInvoices(customerId: string): Promise<Invoice[]>;
  /** Hosted page where the customer changes the payment method (OW-11). */
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  parseWebhook(rawBody: Buffer, signature: string | undefined): Promise<BillingEvent>;
}
