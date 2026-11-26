import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import { fakeProviders } from '../config/env';
import type { Db } from '../core/core.module';
import { randomCrockford } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { DB, ENV, LOGGER, VALKEY } from '../core/tokens';
import { ConsentsService } from '../legal/consents.service';
import { LegalTextsService } from '../legal/legal-texts.service';
import { withdrawalOpenUntil } from '../legal/rules';
import { MailService } from '../mail/mail.service';
import { OrdersService } from '../orders/orders.service';
import { TagsService } from '../vehicles/tags.service';
import { TokensService } from '../vehicles/tokens.service';
import { recordIssuance } from '../vehicles/code-rules';
import {
  legalDoc,
  LEGAL_DOC_VERSION,
  LIFETIME_PRICE_CENTS,
  PLAN_PRICE_CENTS,
  type PlanTerm,
  renewalRule,
  STICKER_VALUE_CENTS,
  type LegalSlug,
} from '@parkshield/shared';
import {
  PAYMENTS,
  PRICE_MISMATCH,
  type BillingEvent,
  type PaidPlan,
  type Payments,
} from '../providers/ports';
import { queueWelcomeLetterCheck } from '../letters/trigger';
import { ProfileService } from '../profile/profile.service';
import { returnUrls } from './app-return';
import { createHash } from 'node:crypto';
import { CompanyService } from '../letters/company.service';
import { queuePaymentNotification } from './payment-notify.queue';
import { STORE_MANAGE_URL, unifiedStatus } from './unified-status';
import {
  contractConfirmationContent,
  contractDate,
  contractPdfName,
  lifetimeBreakdown,
  priceBreakdown,
  renderContractConfirmationPdf,
} from './contract-confirmation';

const LIVE = ['active', 'past_due'] as const;
/** The single plan's name on contracts and confirmations (owner decision 2026-11-21). */

const euro = (cents: number, locale: 'de' | 'en') =>
  new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);

/** A legal page as plain text for the durable-medium contract confirmation (§ 312f BGB). */
export function legalPlainText(
  locale: 'de' | 'en',
  slug: LegalSlug,
  renewalMode: 'annual' | 'monthly_after_first_term',
): string {
  const doc = legalDoc(locale, slug, { renewalMode });
  return [doc.title, ...doc.sections.flatMap((s) => [s.heading, ...s.paragraphs])].join('\n');
}

export interface CheckoutConsents {
  immediateStartVersion: number;
  termsVersion: number;
  /** Re-subscription: is the old sticker still on the car? */
  stickerStillAttached?: boolean;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ConsentsService) private readonly consents: ConsentsService,
    @Inject(LegalTextsService) private readonly legalTexts: LegalTextsService,
    @Inject(TagsService) private readonly tags: TagsService,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(CompanyService) private readonly company: CompanyService,
  ) {}

  /** The one plan (kept as a list so old clients keep working). */
  /**
   * Outbox `billing.customer_email` (Konto → „E-Mail ändern“): the Stripe customer gets the account's
   * current e-mail, so receipts and invoices go to the new address. Reads the address at run time, so
   * a retry or a second change in between always ends with the latest one. No customer: nothing to do.
   */
  async syncCustomerEmail(userId: string): Promise<void> {
    const row = await this.db
      .selectFrom('users')
      .select(['email', 'stripe_customer_id'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!row?.stripe_customer_id) return;
    await this.payments.updateCustomerEmail(row.stripe_customer_id, row.email);
  }

  async plans() {
    const rows = await this.db
      .selectFrom('plans')
      .select(['code', 'name', 'availability'])
      .where('is_public', '=', true)
      .execute();
    const price = await this.yearPrice();
    const lifetime = await this.lifetimePrice();
    return rows.map((p) => ({
      code: p.code,
      name: p.name,
      availability: p.availability,
      priceYearGrossCents: price,
      // Lifetime (2026-11-26): the same plan, paid once.
      priceLifetimeGrossCents: lifetime,
      purchasable: p.code === 'standard',
    }));
  }

  /** Yearly gross price in cents (setting `prices.plan_year_cents`, default 19,99 €). */
  /**
   * App Store / Google Play price when RevenueCat does not report one (setting
   * `prices.store_year_cents`, 1999, the same as the Stripe price since 2026-11-25).
   */
  async storeYearPrice(): Promise<number> {
    return Number(await this.settings.get('prices.store_year_cents', 1999));
  }

  /** Lifetime price, paid once (setting `prices.lifetime_cents`, default 29,99 €). */
  async lifetimePrice(): Promise<number> {
    return Number(await this.settings.get('prices.lifetime_cents', LIFETIME_PRICE_CENTS));
  }

  /** Store lifetime price when RevenueCat reports none (setting `prices.store_lifetime_cents`). */
  async storeLifetimePrice(): Promise<number> {
    return Number(await this.settings.get('prices.store_lifetime_cents', LIFETIME_PRICE_CENTS));
  }

  async yearPrice(): Promise<number> {
    return Number(await this.settings.get('prices.plan_year_cents', PLAN_PRICE_CENTS));
  }

  private isPurchasable(plan: string): boolean {
    return plan === 'standard';
  }

  async liveSubscription(userId: string) {
    return this.db
      .selectFrom('subscriptions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('status', 'in', LIVE)
      .executeTakeFirst();
  }

  /** A Google Play subscription the customer paused (no entitlement until `paused_until`). */
  async pausedSubscription(userId: string) {
    return this.db
      .selectFrom('subscriptions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('status', '=', 'expired')
      .where('paused_until', '>', sql<Date>`now()`)
      .where('refunded_at', 'is', null)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
  }

  /** What the portal shows instead of the checkout while a store subscription is paused. */
  async pausedSummary(userId: string) {
    if (await this.liveSubscription(userId)) return null;
    const s = await this.pausedSubscription(userId);
    if (!s || s.provider === 'stripe') return null;
    return {
      provider: s.provider,
      pausedUntil: s.paused_until!,
      contractNo: s.contract_no,
      managementUrl: s.management_url ?? STORE_MANAGE_URL[s.provider],
    };
  }

  async summary(userId: string) {
    const s = await this.liveSubscription(userId);
    if (!s) return null;
    const days = await this.legalTexts.withdrawalDays();
    const openUntil = withdrawalOpenUntil(s.created_at, days);
    const store = s.provider === 'stripe' ? null : s.provider;
    const lifetime = s.interval === 'lifetime';
    return {
      plan: s.plan,
      // Paid once (2026-11-26): no renewal, no period end, nothing to cancel.
      lifetime,
      status: s.status,
      // A4: one record for every provider; the app and the website read only this.
      provider: s.provider,
      unifiedStatus: unifiedStatus(s),
      willRenew: !lifetime && s.will_renew && !s.cancel_at_period_end,
      managementUrl: store ? (s.management_url ?? STORE_MANAGE_URL[store]) : null,
      stickerValueCents: s.sticker_value_cents,
      // A6: Apple/Google decide on withdrawal and refunds of store purchases.
      refundRoute: store === 'app_store' ? 'apple' : store === 'play_store' ? 'google' : null,
      contractNo: s.contract_no,
      currentPeriodEnd: s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      canceledAt: s.canceled_at,
      interval: s.interval,
      renewalMode: s.renewal_mode,
      // § 356a BGB: the portal shows "Vertrag widerrufen" while the period runs.
      withdrawalOpenUntil: s.customer_type === 'b2c' && openUntil > new Date() ? openUntil : null,
    };
  }

  /**
   * The most recent contract that has ended, while nothing is live or paused (2026-11-25: an owner
   * signing in on another phone saw „Sie haben noch kein Abo“ although they had one before). Says why
   * it ended: `withdrawn`, `refunded`, `moved` (the store purchase now belongs to another of our
   * accounts: the same Apple ID / Google account bought there, RevenueCat TRANSFER) or `expired`.
   */
  async endedSummary(userId: string) {
    if (await this.liveSubscription(userId)) return null;
    if (await this.pausedSubscription(userId)) return null;
    const s = await this.db
      .selectFrom('subscriptions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('status', 'in', ['canceled', 'expired', 'withdrawn'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!s) return null;
    const moved = s.store_original_transaction_id?.includes('#moved:') ?? false;
    const reason = s.withdrawn_at
      ? ('withdrawn' as const)
      : s.refunded_at
        ? ('refunded' as const)
        : moved
          ? ('moved' as const)
          : ('expired' as const);
    const endedAt =
      reason === 'withdrawn'
        ? s.withdrawn_at
        : reason === 'refunded'
          ? s.refunded_at
          : reason === 'moved'
            ? s.updated_at
            : (s.current_period_end ?? s.canceled_at ?? s.updated_at);
    return { provider: s.provider, reason, endedAt, contractNo: s.contract_no };
  }

  /** Whether the user had a subscription before (re-subscription asks about the old sticker). */
  async hadSubscription(userId: string): Promise<boolean> {
    const r = await this.db
      .selectFrom('subscriptions')
      .select('id')
      .where('user_id', '=', userId)
      .where('status', 'in', ['canceled', 'expired', 'withdrawn'])
      .executeTakeFirst();
    return Boolean(r);
  }

  private async findPromo(code: string, plan: PaidPlan) {
    const promo = await this.db
      .selectFrom('promo_codes')
      .selectAll()
      .where('code', '=', code.trim())
      .where('is_active', '=', true)
      .where((eb) =>
        eb.or([eb('valid_until', 'is', null), eb('valid_until', '>', sql<Date>`now()`)]),
      )
      .executeTakeFirst();
    if (!promo) return null;
    if (promo.applies_to && !(promo.applies_to as string[]).includes(plan)) return null;
    if (promo.max_redemptions !== null) {
      const { n } = await this.db
        .selectFrom('promo_redemptions')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('promo_code_id', '=', promo.id)
        .executeTakeFirstOrThrow();
      if (Number(n) >= promo.max_redemptions) return null;
    }
    return promo;
  }

  /** Gross price after an optional promo, in cents (used by the local fake checkout). */
  async priceFor(plan: PaidPlan, promoCodeId?: string): Promise<number> {
    if (!this.isPurchasable(plan)) throw new BadRequestException({ error: 'plan_unavailable' });
    const base = await this.yearPrice();
    if (!promoCodeId) return base;
    const promo = await this.db
      .selectFrom('promo_codes')
      .select(['kind', 'value'])
      .where('id', '=', promoCodeId)
      .executeTakeFirst();
    if (promo?.kind === 'percent_off') return Math.round(base * (1 - promo.value / 100));
    if (promo?.kind === 'amount_off') return Math.max(0, base - promo.value);
    return base;
  }

  /** US-06: annual Stripe Checkout. Feature access starts only once the payment event arrives. */
  async checkout(
    user: AuthContext,
    input: {
      plan: PaidPlan;
      /** `lifetime`: paid once (2026-11-26); default `year`. */
      term?: PlanTerm;
      promoCode?: string;
      appReturn?: string;
    } & CheckoutConsents,
    ipHash: Buffer | null = null,
  ): Promise<{ url: string }> {
    if (!this.isPurchasable(input.plan))
      throw new BadRequestException({ error: 'plan_unavailable' });
    if (await this.liveSubscription(user.userId))
      throw new ConflictException({ error: 'already_subscribed' });
    // A Google Play subscription on pause is still the customer's contract: resume it in Play.
    if (await this.pausedSubscription(user.userId))
      throw new ConflictException({ error: 'subscription_paused' });
    // Sign-up before payment (docs/app-redesign.md §7): name and postal address first.
    const address = await this.profiles.postalAddress(user.userId);
    if (!address) throw new ConflictException({ error: 'profile_incomplete' });
    // The verified mobile number is required (escalation SMS, owner decision 2026-11-21).
    if (!(await this.profiles.phoneVerified(user.userId)))
      throw new ConflictException({ error: 'phone_required' });

    const lifetime = input.term === 'lifetime';
    let promo = null;
    // Promo codes (Stripe coupons, extra months) belong to the yearly plan only.
    if (lifetime && input.promoCode) throw new BadRequestException({ error: 'promo_invalid' });
    if (input.promoCode) {
      promo = await this.findPromo(input.promoCode, input.plan);
      if (!promo) throw new BadRequestException({ error: 'promo_invalid' });
      // Extra months are applied after the payment (AD-13); every other kind needs its Stripe coupon.
      if (
        !fakeProviders(this.env).payments &&
        promo.kind !== 'extra_months' &&
        !promo.stripe_coupon_id
      ) {
        throw new BadRequestException({ error: 'promo_invalid' });
      }
    }

    const row = await this.db
      .selectFrom('users')
      .select('stripe_customer_id')
      .where('id', '=', user.userId)
      .executeTakeFirstOrThrow();
    let customerId = row.stripe_customer_id;
    if (!customerId) {
      customerId = await this.payments.ensureCustomer({
        email: user.email,
        userId: user.userId,
        locale: user.preferredLang,
      });
      await this.db
        .updateTable('users')
        .set({ stripe_customer_id: customerId })
        .where('id', '=', user.userId)
        .execute();
    }
    // Prefill Stripe with the sign-up name and address, so nobody types them twice. Checkout still
    // asks for the billing address (customer_update: auto keeps any change made there).
    await this.payments.updateCustomer(customerId, address);

    // Proof of exactly what was agreed (§ 356 Abs. 4, § 357a BGB): the text versions shown, before
    // the payment. The subscription links to the immediate-start consent once it exists.
    const consentAt = new Date();
    const consentId = await this.consents.record({
      userId: user.userId,
      type: 'immediate_start',
      textKey: 'checkout.immediate_start',
      textVersion: input.immediateStartVersion,
      locale: user.preferredLang,
      accepted: true,
      ipHash,
      source: 'checkout',
    });
    for (const type of ['agb', 'privacy_notice'] as const) {
      await this.consents.record({
        userId: user.userId,
        type,
        textKey: 'checkout.terms_ack',
        textVersion: input.termsVersion,
        locale: user.preferredLang,
        accepted: true,
        ipHash,
        source: 'checkout',
      });
    }

    const metadata: Record<string, string> = {
      userId: user.userId,
      plan: input.plan,
      ...(lifetime ? { term: 'lifetime' } : {}),
      waiverAt: consentAt.toISOString(),
      consentId,
    };
    if (promo) metadata.promoCodeId = promo.id;
    if (input.stickerStillAttached !== undefined) {
      metadata.sticker = input.stickerStillAttached ? 'keep' : 'replace';
    }

    // Stripe fills in the session id, so the account page (or the app) can confirm the payment.
    const back = returnUrls(this.env, 'checkout', input.appReturn, {
      success: `${this.env.WEB_BASE_URL}/konto?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel: `${this.env.WEB_BASE_URL}/konto?checkout=canceled`,
    });
    if (lifetime) {
      // One-time Stripe Checkout (no Stripe subscription): the amount is the setting itself, so the
      // customer is always charged exactly what the app showed.
      const amount = await this.lifetimePrice();
      return this.payments.createPaymentCheckout({
        customerId,
        amountCents: amount,
        description: lifetimeBreakdown(
          user.preferredLang,
          euro(amount, user.preferredLang),
          euro(await this.stickerValue(), user.preferredLang),
        ).join(' '),
        locale: user.preferredLang,
        successUrl: back.success,
        cancelUrl: back.cancel,
        metadata,
      });
    }
    const yearPrice = await this.yearPrice();
    try {
      return await this.payments.createCheckout({
        customerId,
        plan: input.plan,
        // B2: the price breakdown on the subscription and every invoice. TODO [LEGAL REVIEW]
        description: priceBreakdown(
          user.preferredLang,
          euro(yearPrice, user.preferredLang),
          euro(await this.stickerValue(), user.preferredLang),
        ).join(' '),
        locale: user.preferredLang,
        stripeCouponId: promo?.stripe_coupon_id ?? null,
        successUrl: back.success,
        cancelUrl: back.cancel,
        metadata,
        expectedAmountCents: yearPrice,
      });
    } catch (err) {
      // Never charge another amount than shown: fail loudly until STRIPE_PRICE_YEARLY is fixed.
      if ((err as { code?: string }).code === PRICE_MISMATCH) {
        this.logger.error({ err }, 'stripe price differs from prices.plan_year_cents');
        throw new ServiceUnavailableException({ error: PRICE_MISMATCH });
      }
      throw err;
    }
  }

  /**
   * The customer is back from Checkout: read the session from the provider and start the subscription
   * now, instead of waiting for the webhook (which may be late, or missing locally without
   * `stripe listen`). Idempotent with the webhook: both end in the same insert on the subscription id.
   */
  async confirmCheckout(
    user: AuthContext,
    sessionId?: string,
  ): Promise<{ status: 'active' | 'pending' }> {
    if (await this.liveSubscription(user.userId)) return { status: 'active' };
    let ref: { sessionId: string } | { customerId: string } | null = sessionId
      ? { sessionId }
      : null;
    if (!ref) {
      const row = await this.db
        .selectFrom('users')
        .select('stripe_customer_id')
        .where('id', '=', user.userId)
        .executeTakeFirst();
      if (!row?.stripe_customer_id) return { status: 'pending' };
      ref = { customerId: row.stripe_customer_id };
    }
    const event = await this.payments.checkoutCompletion(ref).catch((err: unknown) => {
      this.logger.warn({ err: String(err) }, 'checkout session could not be read');
      return null;
    });
    const done =
      event?.kind === 'checkout_completed' ||
      (event?.kind === 'payment_completed' && event.metadata.term === 'lifetime');
    if (!event || !done) return { status: 'pending' };
    // Only the person who paid can confirm their own session.
    if ((event as { metadata: Record<string, string> }).metadata.userId !== user.userId)
      throw new NotFoundException();
    await this.handle(event);
    return { status: (await this.liveSubscription(user.userId)) ? 'active' : 'pending' };
  }

  /** Applies a provider event exactly once (webhooks are retried and may arrive more than once). */
  async handle(event: BillingEvent): Promise<void> {
    // A5: every Stripe event id stored once; a replay of a processed event changes nothing.
    await this.db
      .insertInto('billing_webhook_events')
      .values({ provider: 'stripe', event_id: event.eventId, type: event.kind })
      .onConflict((oc) => oc.columns(['provider', 'event_id']).doNothing())
      .execute();
    const seen = await this.db
      .selectFrom('billing_webhook_events')
      .select('processed_at')
      .where('provider', '=', 'stripe')
      .where('event_id', '=', event.eventId)
      .executeTakeFirst();
    if (seen?.processed_at) return;
    if (event.kind === 'ignored') {
      await this.markStripeProcessed(event.eventId);
      return;
    }
    const claimed = await this.valkey.set(
      `billing:event:${event.eventId}`,
      '1',
      'EX',
      7 * 86_400,
      'NX',
    );
    if (!claimed) return;
    try {
      if (event.kind === 'checkout_completed') await this.onCheckoutCompleted(event);
      if (event.kind === 'subscription_updated') await this.onSubscriptionUpdated(event);
      if (event.kind === 'payment_failed') await this.onPaymentFailed(event);
      if (event.kind === 'charge_refunded') await this.onChargeRefunded(event);
      if (event.kind === 'payment_completed' && event.metadata.term === 'lifetime') {
        await this.onLifetimePaid(event);
      }
      if (event.kind === 'payment_completed' && event.metadata.orderId) {
        // checkout.session.completed and payment_intent.succeeded both report the same payment:
        // only the one that marks the order paid mails payment@.
        if (await this.orders.markPaid(event.metadata.orderId, event.paymentIntentId)) {
          await this.notifyPrintOrder(event);
        }
      }
    } catch (err) {
      await this.valkey.del(`billing:event:${event.eventId}`);
      throw err;
    }
    await this.markStripeProcessed(event.eventId);
  }

  private async markStripeProcessed(eventId: string) {
    await this.db
      .updateTable('billing_webhook_events')
      .set({ processed_at: sql`now()` })
      .where('provider', '=', 'stripe')
      .where('event_id', '=', eventId)
      .execute();
  }

  /**
   * charge.refunded: refunds are normally issued by us (withdrawal, ops) and already recorded. A
   * refund made in the Stripe dashboard on a 3 € order marks the order refunded and, if it was not
   * printed yet, keeps it from being printed. Subscription refunds keep their state (ops decides).
   */
  private async onChargeRefunded(e: Extract<BillingEvent, { kind: 'charge_refunded' }>) {
    this.logger.info(
      { paymentIntentId: e.paymentIntentId, refundedCents: e.amountRefundedCents },
      'charge refunded',
    );
    if (!e.paymentIntentId) return;
    await this.db
      .updateTable('decal_orders')
      .set({ status: 'refunded' })
      .where('stripe_payment_intent', '=', e.paymentIntentId)
      .where('status', 'in', ['pending_payment', 'paid'])
      .where('total_gross_cents', '<=', e.amountRefundedCents)
      .execute();
    // A paid new code (2026-11-24): the code is NEVER revoked on a refund (the car must stay
    // protected); the refund is recorded on its ledger row and audited, once.
    const newCode = await this.db
      .selectFrom('decal_orders as o')
      .innerJoin('code_issuances as c', (j) =>
        j.on('c.stripe_ref', '=', sql<string>`'order:' || o.id::text`),
      )
      .select(['o.id as orderId', 'o.user_id as userId', 'c.id as issuanceId', 'c.vehicle_id'])
      .where('o.stripe_payment_intent', '=', e.paymentIntentId)
      .where('o.new_code', '=', true)
      .where('c.refunded_at', 'is', null)
      .executeTakeFirst();
    if (newCode) {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('code_issuances')
          .set({ refunded_at: sql`now()` })
          .where('id', '=', newCode.issuanceId)
          .execute();
        await trx
          .insertInto('audit_logs')
          .values({
            actor_id: null,
            actor_kind: null,
            action: 'qr_code.payment_refunded',
            entity: 'vehicles',
            entity_id: newCode.vehicle_id,
            meta: JSON.stringify({
              orderId: newCode.orderId,
              refundedCents: e.amountRefundedCents,
              codeKept: true,
            }),
          })
          .execute();
      });
    }
  }

  private async onCheckoutCompleted(e: Extract<BillingEvent, { kind: 'checkout_completed' }>) {
    const plan = e.metadata.plan as PaidPlan | undefined;
    const userId = e.metadata.userId;
    if (!userId || plan !== 'standard') {
      this.logger.error({ eventId: e.eventId }, 'checkout without ParkShield metadata');
      return;
    }
    const promoCodeId = e.metadata.promoCodeId ?? null;
    const promo = promoCodeId
      ? await this.db
          .selectFrom('promo_codes')
          .select(['price_lock_months', 'kind', 'value'])
          .where('id', '=', promoCodeId)
          .executeTakeFirst()
      : undefined;
    const priceLockedUntil = promo?.price_lock_months
      ? new Date(e.periodStart.getTime() + promo.price_lock_months * 30.44 * 86_400_000)
      : null;
    // AD-13 "extra months": the paid year is followed by free months before the first renewal.
    let periodEnd = e.periodEnd;
    if (promo?.kind === 'extra_months') {
      periodEnd = new Date(e.periodEnd);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + promo.value);
      await this.payments.extendPeriod(e.subscriptionId, periodEnd);
    }

    const contractNo = `PS-${randomCrockford(8)}`;
    // The renewal rule in force when the contract was concluded stays the rule of this contract.
    const renewalMode = await this.legalTexts.renewalMode('b2c');
    const inserted = await this.db
      .insertInto('subscriptions')
      .values({
        user_id: userId,
        plan,
        status: 'active',
        stripe_subscription_id: e.subscriptionId,
        promo_code_id: promoCodeId,
        price_locked_until: priceLockedUntil,
        withdrawal_waiver_at: e.metadata.waiverAt ? new Date(e.metadata.waiverAt) : null,
        immediate_start_consent_id: e.metadata.consentId ?? null,
        customer_type: 'b2c',
        renewal_mode: renewalMode,
        current_period_start: e.periodStart,
        current_period_end: periodEnd,
        contract_no: contractNo,
        provider: 'stripe',
        will_renew: true,
        original_purchase_at: e.periodStart,
        sticker_value_cents: await this.stickerValue(),
        withdrawal_notice_version: LEGAL_DOC_VERSION,
      })
      .onConflict((oc) => oc.column('stripe_subscription_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return;
    // Paid: the welcome letter follows once a vehicle exists (or at once, if one already does).
    await queueWelcomeLetterCheck(this.db, userId);
    // payment@: the new subscription, once per Stripe event (2026-11-22).
    await queuePaymentNotification(this.db, {
      eventId: e.eventId,
      kind: 'subscription',
      userId,
      subscriptionId: inserted.id,
      amountCents: e.amountCents || (await this.priceFor(plan, promoCodeId ?? undefined)),
      paymentRef: e.paymentRef ?? e.subscriptionId,
      paidAt: new Date(),
    });
    // Re-subscription (section 4): the old sticker is gone, so its code stops working and the
    // vehicle gets a new one; the replacement sticker is free.
    if (e.metadata.sticker === 'replace') await this.replaceStickers(userId);
    if (promoCodeId) {
      await this.db
        .insertInto('promo_redemptions')
        .values({ promo_code_id: promoCodeId, subscription_id: inserted.id })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    await this.sendContractConfirmation(inserted.id);
  }

  /**
   * Lifetime plan paid on Stripe (one-time Checkout, 2026-11-26): the same contract row as a yearly
   * subscription, but interval `lifetime`, no period end and no renewal. The payment intent is the
   * contract's Stripe reference (unique: webhook and return confirmation end in the same insert).
   */
  private async onLifetimePaid(e: Extract<BillingEvent, { kind: 'payment_completed' }>) {
    const userId = e.metadata.userId;
    if (!userId || e.metadata.plan !== 'standard' || !e.paymentIntentId) {
      this.logger.error({ eventId: e.eventId }, 'lifetime payment without ParkShield metadata');
      return;
    }
    // Never two live contracts: a race (paid twice) keeps the second as `incomplete` for ops to refund.
    const other = await this.liveSubscription(userId);
    if (other && other.stripe_payment_intent === e.paymentIntentId) return;
    const now = new Date();
    const renewalMode = await this.legalTexts.renewalMode('b2c');
    const inserted = await this.db
      .insertInto('subscriptions')
      .values({
        user_id: userId,
        plan: 'standard',
        status: other ? 'incomplete' : 'active',
        interval: 'lifetime',
        stripe_payment_intent: e.paymentIntentId,
        withdrawal_waiver_at: e.metadata.waiverAt ? new Date(e.metadata.waiverAt) : null,
        immediate_start_consent_id: e.metadata.consentId ?? null,
        customer_type: 'b2c',
        renewal_mode: renewalMode,
        current_period_start: now,
        current_period_end: null,
        contract_no: `PS-${randomCrockford(8)}`,
        provider: 'stripe',
        will_renew: false,
        original_purchase_at: now,
        sticker_value_cents: await this.stickerValue(),
        withdrawal_notice_version: LEGAL_DOC_VERSION,
      })
      .onConflict((oc) => oc.column('stripe_payment_intent').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return;
    if (other) {
      this.logger.error(
        { userId, subscriptionId: inserted.id },
        'double contract: lifetime paid while another contract is live',
      );
      return;
    }
    await queueWelcomeLetterCheck(this.db, userId);
    await queuePaymentNotification(this.db, {
      eventId: e.eventId,
      kind: 'subscription',
      userId,
      subscriptionId: inserted.id,
      amountCents: e.amountCents || (await this.lifetimePrice()),
      paymentRef: e.paymentIntentId,
      paidAt: now,
    });
    if (e.metadata.sticker === 'replace') await this.replaceStickers(userId);
    await this.sendContractConfirmation(inserted.id);
  }

  /** Sticker value included in the price (B2, setting `prices.sticker_value_cents`, 300). */
  async stickerValue(): Promise<number> {
    return Number(await this.settings.get('prices.sticker_value_cents', STICKER_VALUE_CENTS));
  }

  /**
   * § 312f BGB: the contract confirmation on a durable medium (2026-11-22) for a NEW subscription of
   * any provider: the e-mail in the one layout and the PDF „Vertragsbestätigung“ with the contract
   * data, the price breakdown (B2), renewal and cancellation rules, the accepted AGB, the
   * Widerrufsbelehrung, the Muster-Widerrufsformular and the immediate-start declaration. Store
   * subscriptions get a „Vertragsbestätigung“ that says the receipt comes from Apple/Google (A6).
   * Once per subscription (`contract_confirmations`); renewals never resend it.
   */
  async sendContractConfirmation(
    subscriptionId: string,
    opts: { resend?: boolean } = {},
  ): Promise<void> {
    // Once per subscription. `resend` (staff only, e.g. a corrected price) sends it again and adds a
    // second `contract_confirmations` row; the first record stays.
    const sent = opts.resend
      ? undefined
      : await this.db
          .selectFrom('contract_confirmations')
          .select('id')
          .where('subscription_id', '=', subscriptionId)
          .executeTakeFirst();
    if (sent) return;
    const sub = await this.db
      .selectFrom('subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id',
        's.plan',
        's.provider',
        's.contract_no',
        's.renewal_mode',
        's.promo_code_id',
        's.immediate_start_consent_id',
        's.current_period_start',
        's.current_period_end',
        's.created_at',
        's.status',
        's.will_renew',
        's.original_purchase_at',
        's.sticker_value_cents',
        's.store_price_cents',
        's.interval',
        's.user_id',
        'u.email',
        'u.preferred_lang',
        'u.customer_no',
      ])
      .where('s.id', '=', subscriptionId)
      .executeTakeFirst();
    if (!sub || !sub.contract_no) return;
    const locale = sub.preferred_lang;
    const store = sub.provider === 'stripe' ? null : sub.provider;
    const consent = sub.immediate_start_consent_id
      ? await this.consents.get(sub.immediate_start_consent_id)
      : null;
    const consentText = consent
      ? await this.legalTexts.version(consent.text_key, consent.locale, consent.text_version)
      : null;
    const lifetime = sub.interval === 'lifetime';
    const price = lifetime
      ? sub.provider === 'stripe'
        ? await this.lifetimePrice()
        : (sub.store_price_cents ?? (await this.storeLifetimePrice()))
      : sub.provider === 'stripe'
        ? await this.priceFor('standard', sub.promo_code_id ?? undefined)
        : (sub.store_price_cents ?? (await this.storeYearPrice()));
    const customerNo = sub.customer_no ?? '–';
    // Contract start = the first purchase; the renewal = the end of the current period as Stripe /
    // Apple / Google report it (never computed here). Store sandbox periods last minutes or hours,
    // so dates then carry the time.
    const startedAt = sub.original_purchase_at ?? sub.current_period_start ?? sub.created_at;
    const renewsAt = lifetime ? null : sub.current_period_end;
    const renews =
      !lifetime && sub.will_renew && ['active', 'past_due', 'trialing'].includes(sub.status);
    const withTime = Boolean(renewsAt && renewsAt.getTime() - startedAt.getTime() < 2 * 86_400_000);
    const renewalMode = sub.renewal_mode as 'annual' | 'monthly_after_first_term';
    const sticker = sub.sticker_value_cents ? euro(sub.sticker_value_cents, locale) : null;
    const company = (await this.company.current()).data;
    const profile = sub.user_id ? await this.profiles.get(sub.user_id) : null;
    const countryName = (code: string) =>
      new Intl.DisplayNames([locale === 'de' ? 'de-DE' : 'en-GB'], { type: 'region' }).of(code) ??
      code;
    const content = contractConfirmationContent({
      locale,
      customerNo,
      contractNo: sub.contract_no,
      customer: profile
        ? {
            name: `${profile.firstName} ${profile.lastName}`,
            address: [
              profile.street,
              `${profile.postalCode} ${profile.city}`,
              countryName(profile.country),
            ],
          }
        : null,
      price: euro(price, locale),
      startedAt,
      renewsAt,
      renews,
      withTime,
      renewalMode,
      docVersion: LEGAL_DOC_VERSION,
      consent: consent && consentText ? { text: consentText.body, at: consent.accepted_at } : null,
      company,
      webBaseUrl: this.env.WEB_BASE_URL,
      stickerValue: sticker,
      store,
      lifetime,
    });
    const pdf = await renderContractConfirmationPdf(content, {
      created: new Date(),
      contractNo: sub.contract_no,
    });
    await this.mail.send({
      to: sub.email,
      template: 'contract_confirmation',
      locale,
      values: {
        contractNo: sub.contract_no,
        customerNo,
        price: euro(price, locale),
        sticker: sticker ? 'yes' : 'no',
        stickerValue: sticker ?? '',
        startedLabel: contractDate(startedAt, locale, withTime),
        renewalLabel: renewsAt ? contractDate(renewsAt, locale, withTime) : '–',
        renews: renews ? 'yes' : 'no',
        lifetime: lifetime ? 'yes' : 'no',
        provider: sub.provider,
        renewalRule: renewalRule(locale, { renewalMode }),
        consent: consent && consentText ? 'yes' : 'no',
        consentLabel: contractDate(consent?.accepted_at ?? startedAt, locale, true),
        consentText: consentText?.body ?? '',
        docVersion: LEGAL_DOC_VERSION,
      },
      actionUrl: `${this.env.WEB_BASE_URL}/app`,
      attachments: [
        {
          filename: contractPdfName(locale, sub.contract_no),
          contentType: 'application/pdf',
          content: pdf,
        },
      ],
    });
    // Which document versions went out with this contract (the PDF is not stored, its hash is).
    await this.db
      .insertInto('contract_confirmations')
      .values({
        subscription_id: sub.id,
        locale,
        legal_doc_version: LEGAL_DOC_VERSION,
        renewal_mode: renewalMode,
        immediate_start_consent_id: sub.immediate_start_consent_id,
        pdf_sha256: createHash('sha256').update(pdf).digest(),
      })
      .execute();
  }

  private async replaceStickers(userId: string): Promise<void> {
    const n = await this.db.transaction().execute(async (trx) => {
      const vehicles = await trx
        .selectFrom('qr_tokens as t')
        .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
        .select(['t.id as tokenId', 'v.id as vehicleId', 't.cta_header', 't.design_template_id'])
        .where('v.owner_user_id', '=', userId)
        .where('t.status', '=', 'assigned')
        .execute();
      for (const v of vehicles) {
        await this.tags.transition(trx, v.tokenId, 'revoked', 'system', 'replaced');
        const fresh = await this.tokens.issue(trx, v.vehicleId, null, 'system');
        await trx
          .updateTable('qr_tokens')
          .set({ cta_header: v.cta_header, design_template_id: v.design_template_id })
          .where('id', '=', fresh.id)
          .execute();
        await recordIssuance(trx, {
          vehicleId: v.vehicleId,
          userId,
          tokenId: fresh.id,
          kind: 'resubscribe',
        });
      }
      if (vehicles.length) {
        await trx
          .updateTable('users')
          .set({ free_replacements: sql`free_replacements + ${vehicles.length}` })
          .where('id', '=', userId)
          .execute();
      }
      return vehicles.length;
    });
    this.logger.info({ userId, replaced: n }, 're-subscription: stickers replaced');
  }

  /**
   * `customer.subscription.updated/deleted` and `invoice.paid`: the provider's current state wins,
   * except over a withdrawal, which is final. `canceled` (deleted) is the only thing that ends the
   * service after a cancellation; submitting one changes nothing until then.
   */
  /** payment@ for a paid 3 € print order (free welcome prints have no payment). */
  private async notifyPrintOrder(e: Extract<BillingEvent, { kind: 'payment_completed' }>) {
    const order = await this.db
      .selectFrom('decal_orders')
      .select(['id', 'user_id', 'total_gross_cents', 'status'])
      .where('id', '=', e.metadata.orderId!)
      .executeTakeFirst();
    if (!order?.user_id || order.status === 'pending_payment') return;
    const amount = e.amountCents || order.total_gross_cents;
    if (!amount) return;
    await queuePaymentNotification(this.db, {
      eventId: e.eventId,
      kind: 'print_order',
      userId: order.user_id,
      orderId: order.id,
      amountCents: amount,
      paymentRef: e.paymentIntentId,
      paidAt: new Date(),
    });
  }

  private async onSubscriptionUpdated(e: Extract<BillingEvent, { kind: 'subscription_updated' }>) {
    // payment@: a paid renewal invoice (the first invoice is the new subscription above).
    if (
      e.invoice &&
      e.invoice.billingReason === 'subscription_cycle' &&
      e.invoice.amountPaidCents
    ) {
      const sub = await this.db
        .selectFrom('subscriptions')
        .select(['id', 'user_id'])
        .where('stripe_subscription_id', '=', e.subscriptionId)
        .executeTakeFirst();
      if (sub?.user_id) {
        await queuePaymentNotification(this.db, {
          eventId: e.eventId,
          kind: 'renewal',
          userId: sub.user_id,
          subscriptionId: sub.id,
          amountCents: e.invoice.amountPaidCents,
          paymentRef: e.invoice.paymentRef,
          paidAt: e.invoice.paidAt,
        });
      }
    }
    await this.db
      .updateTable('subscriptions')
      .set({
        status: e.status,
        cancel_at_period_end: e.cancelAtPeriodEnd,
        will_renew: !e.cancelAtPeriodEnd && e.status !== 'canceled',
        ...(e.interval ? { interval: e.interval } : {}),
        ...(e.periodStart ? { current_period_start: e.periodStart } : {}),
        ...(e.periodEnd ? { current_period_end: e.periodEnd } : {}),
        ...(e.status === 'canceled' ? { canceled_at: sql`coalesce(canceled_at, now())` } : {}),
        ...(e.status === 'past_due'
          ? { past_due_since: sql`coalesce(past_due_since, now())` }
          : { past_due_since: null }),
      })
      .where('stripe_subscription_id', '=', e.subscriptionId)
      .where('status', '<>', 'withdrawn')
      .execute();
    if (e.status === 'canceled') {
      await this.db
        .updateTable('cancellation_requests as c')
        .set({ status: 'completed' })
        .where('c.status', '=', 'scheduled')
        .where((eb) =>
          eb(
            'c.subscription_id',
            'in',
            eb
              .selectFrom('subscriptions')
              .select('id')
              .where('stripe_subscription_id', '=', e.subscriptionId),
          ),
        )
        .execute();
    }
  }

  async invoices(userId: string) {
    const row = await this.db
      .selectFrom('users')
      .select('stripe_customer_id')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    return row.stripe_customer_id ? this.payments.listInvoices(row.stripe_customer_id) : [];
  }

  /** US-08: renewal failed. Stripe retries (Smart Retries, 3 attempts); the customer gets a reminder each time. */
  private async onPaymentFailed(e: Extract<BillingEvent, { kind: 'payment_failed' }>) {
    const sub = await this.db
      .updateTable('subscriptions')
      .set({ status: 'past_due', past_due_since: sql`coalesce(past_due_since, now())` })
      .where('stripe_subscription_id', '=', e.subscriptionId)
      .where('status', 'in', LIVE)
      .returning('user_id')
      .executeTakeFirst();
    if (!sub?.user_id) return;
    const user = await this.db
      .selectFrom('users')
      .select(['email', 'preferred_lang'])
      .where('id', '=', sub.user_id)
      .executeTakeFirstOrThrow();
    await this.mail.send({
      to: user.email,
      template: e.nextAttemptAt ? 'payment_failed' : 'payment_failed_final',
      locale: user.preferred_lang,
      values: e.nextAttemptAt ? { nextAttemptAt: e.nextAttemptAt } : {},
      actionUrl: `${this.env.WEB_BASE_URL}/app`,
    });
  }

  /**
   * Safety net for missed provider events: subscriptions whose paid period ended become `expired`, which
   * makes their decals inactive (US-08). Cancelled ones after one day, any others after the grace period.
   */
  async expireEnded(): Promise<number> {
    const grace = await this.settings.get('scanner.past_due_grace_days', 21);
    const r = await this.db
      .updateTable('subscriptions')
      .set({ status: 'expired' })
      .where('status', 'in', LIVE)
      .where((eb) =>
        eb.or([
          eb.and([
            eb('cancel_at_period_end', '=', true),
            eb('current_period_end', '<', sql<Date>`now() - interval '1 day'`),
          ]),
          eb('current_period_end', '<', sql<Date>`now() - make_interval(days => ${grace})`),
        ]),
      )
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  async portal(userId: string, appReturn?: string): Promise<{ url: string }> {
    const row = await this.db
      .selectFrom('users')
      .select('stripe_customer_id')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (!row.stripe_customer_id) throw new NotFoundException({ error: 'no_customer' });
    const back = returnUrls(this.env, 'portal', appReturn, {
      success: `${this.env.WEB_BASE_URL}/konto`,
      cancel: `${this.env.WEB_BASE_URL}/konto`,
    });
    return { url: await this.payments.portalUrl(row.stripe_customer_id, back.success) };
  }
}
