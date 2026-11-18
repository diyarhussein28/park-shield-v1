import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
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
import { legalDoc, LEGAL_DOC_VERSION, renewalRule, type LegalSlug } from '@parkshield/shared';
import { PAYMENTS, type BillingEvent, type PaidPlan, type Payments } from '../providers/ports';
import { queueWelcomeLetterCheck } from '../letters/trigger';

const LIVE = ['active', 'past_due'] as const;
const PLAN_NAMES: Record<PaidPlan, string> = { plus: 'Plus', premium: 'Premium' };

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
  ) {}

  async plans() {
    const rows = await this.db
      .selectFrom('plans')
      .select(['code', 'name', 'availability', 'price_year_gross_cents'])
      .where('is_public', '=', true)
      .orderBy('price_year_gross_cents', (ob) => ob.asc().nullsLast())
      .execute();
    return Promise.all(
      rows.map(async (p) => ({
        code: p.code,
        name: p.name,
        availability: p.availability,
        priceYearGrossCents: p.price_year_gross_cents,
        purchasable: await this.isPurchasable(p.code),
      })),
    );
  }

  private async isPurchasable(plan: string): Promise<boolean> {
    if (plan === 'plus') return true;
    if (plan === 'premium') return this.settings.get('plans.premium.purchasable', false);
    return false;
  }

  async liveSubscription(userId: string) {
    return this.db
      .selectFrom('subscriptions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('status', 'in', LIVE)
      .executeTakeFirst();
  }

  async summary(userId: string) {
    const s = await this.liveSubscription(userId);
    if (!s) return null;
    const days = await this.legalTexts.withdrawalDays();
    const openUntil = withdrawalOpenUntil(s.created_at, days);
    return {
      plan: s.plan,
      status: s.status,
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
    const p = await this.db
      .selectFrom('plans')
      .select('price_year_gross_cents')
      .where('code', '=', plan)
      .executeTakeFirstOrThrow();
    const base = p.price_year_gross_cents ?? 0;
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
    input: { plan: PaidPlan; promoCode?: string } & CheckoutConsents,
    ipHash: Buffer | null = null,
  ): Promise<{ url: string }> {
    if (!(await this.isPurchasable(input.plan)))
      throw new BadRequestException({ error: 'plan_unavailable' });
    if (await this.liveSubscription(user.userId))
      throw new ConflictException({ error: 'already_subscribed' });

    let promo = null;
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
      waiverAt: consentAt.toISOString(),
      consentId,
    };
    if (promo) metadata.promoCodeId = promo.id;
    if (input.stickerStillAttached !== undefined) {
      metadata.sticker = input.stickerStillAttached ? 'keep' : 'replace';
    }

    return this.payments.createCheckout({
      customerId,
      plan: input.plan,
      locale: user.preferredLang,
      stripeCouponId: promo?.stripe_coupon_id ?? null,
      // Stripe fills in the session id, so the account page can confirm the payment on return.
      successUrl: `${this.env.WEB_BASE_URL}/konto?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${this.env.WEB_BASE_URL}/konto?checkout=canceled`,
      metadata,
    });
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
    if (!event || event.kind !== 'checkout_completed') return { status: 'pending' };
    // Only the person who paid can confirm their own session.
    if (event.metadata.userId !== user.userId) throw new NotFoundException();
    await this.handle(event);
    return { status: (await this.liveSubscription(user.userId)) ? 'active' : 'pending' };
  }

  /** Applies a provider event exactly once (webhooks are retried and may arrive more than once). */
  async handle(event: BillingEvent): Promise<void> {
    if (event.kind === 'ignored') return;
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
      if (event.kind === 'charge_refunded') {
        // Refunds are issued by us (withdrawal, ops); Stripe's notice only confirms them.
        this.logger.info(
          { paymentIntentId: event.paymentIntentId, refundedCents: event.amountRefundedCents },
          'charge refunded',
        );
      }
      if (event.kind === 'payment_completed' && event.metadata.orderId) {
        await this.orders.markPaid(event.metadata.orderId, event.paymentIntentId);
      }
    } catch (err) {
      await this.valkey.del(`billing:event:${event.eventId}`);
      throw err;
    }
  }

  private async onCheckoutCompleted(e: Extract<BillingEvent, { kind: 'checkout_completed' }>) {
    const plan = e.metadata.plan as PaidPlan | undefined;
    const userId = e.metadata.userId;
    if (!userId || (plan !== 'plus' && plan !== 'premium')) {
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
      })
      .onConflict((oc) => oc.column('stripe_subscription_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return;
    // Paid: the welcome letter follows once a vehicle exists (or at once, if one already does).
    await queueWelcomeLetterCheck(this.db, userId);
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
    const user = await this.db
      .selectFrom('users')
      .select(['email', 'preferred_lang'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const locale = user.preferred_lang;
    const consent = e.metadata.consentId ? await this.consents.get(e.metadata.consentId) : null;
    const consentText = consent
      ? await this.legalTexts.version(consent.text_key, consent.locale, consent.text_version)
      : null;
    const price = await this.priceFor(plan, promoCodeId ?? undefined);
    // § 312f BGB: the contract confirmation on a durable medium, with the terms and the withdrawal
    // policy as they applied at conclusion and the immediate-start declaration with its time.
    await this.mail.send({
      to: user.email,
      template: 'contract_confirmation',
      locale,
      values: {
        plan: PLAN_NAMES[plan],
        contractNo,
        price: euro(price, locale),
        startedAt: e.periodStart,
        periodEnd,
        renewalRule: renewalRule(locale, { renewalMode }),
        consentAt: consent?.accepted_at ?? e.periodStart,
        consentText: consentText?.body ?? '',
        docVersion: LEGAL_DOC_VERSION,
        agbText: legalPlainText(locale, 'agb', renewalMode),
        widerrufText: legalPlainText(locale, 'widerruf', renewalMode),
      },
      actionUrl: `${this.env.WEB_BASE_URL}/konto`,
    });
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
  private async onSubscriptionUpdated(e: Extract<BillingEvent, { kind: 'subscription_updated' }>) {
    await this.db
      .updateTable('subscriptions')
      .set({
        status: e.status,
        cancel_at_period_end: e.cancelAtPeriodEnd,
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
      actionUrl: `${this.env.WEB_BASE_URL}/konto`,
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

  async portal(userId: string): Promise<{ url: string }> {
    const row = await this.db
      .selectFrom('users')
      .select('stripe_customer_id')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (!row.stripe_customer_id) throw new NotFoundException({ error: 'no_customer' });
    return {
      url: await this.payments.portalUrl(row.stripe_customer_id, `${this.env.WEB_BASE_URL}/konto`),
    };
  }
}
