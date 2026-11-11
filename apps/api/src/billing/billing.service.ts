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
import { normalizeEmail, randomCrockford, sha256 } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { DB, ENV, LOGGER, VALKEY } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { OrdersService } from '../orders/orders.service';
import {
  CAPTCHA,
  PAYMENTS,
  type BillingEvent,
  type Captcha,
  type PaidPlan,
  type Payments,
} from '../providers/ports';

const LIVE = ['active', 'past_due'] as const;
const PLAN_NAMES: Record<PaidPlan, string> = { plus: 'Plus', premium: 'Premium' };

export interface CancelReceipt {
  receivedAt: Date;
  found: boolean;
  contractNo?: string;
  endsAt?: Date | null;
}

export interface CancelDetails {
  kind: 'ordinary' | 'extraordinary';
  reason?: string;
}

const DAY_MS = 86_400_000;

/**
 * §309 Nr. 9 BGB: in the initial one-year term the subscription ends with the paid year. After it has
 * renewed, the customer may cancel at any time with one month's notice (pro-rata refund via AD-12).
 */
export function cancellationDate(
  sub: { created_at: Date; current_period_start: Date | null; current_period_end: Date | null },
  now = new Date(),
): Date | null {
  const end = sub.current_period_end;
  const renewed =
    sub.current_period_start !== null &&
    sub.current_period_start.getTime() - sub.created_at.getTime() > 300 * DAY_MS;
  if (!renewed) return end;
  const oneMonth = new Date(now);
  oneMonth.setUTCMonth(oneMonth.getUTCMonth() + 1);
  return end && end < oneMonth ? end : oneMonth;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(CAPTCHA) private readonly captcha: Captcha,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(OrdersService) private readonly orders: OrdersService,
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
    return {
      plan: s.plan,
      status: s.status,
      contractNo: s.contract_no,
      currentPeriodEnd: s.current_period_end,
      cancelAtPeriodEnd: s.cancel_at_period_end,
      canceledAt: s.canceled_at,
    };
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
    input: { plan: PaidPlan; promoCode?: string },
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

    const metadata: Record<string, string> = {
      userId: user.userId,
      plan: input.plan,
      // The customer ticked "immediate start" (required by the checkout form); recorded for withdrawal law.
      waiverAt: new Date().toISOString(),
    };
    if (promo) metadata.promoCodeId = promo.id;

    return this.payments.createCheckout({
      customerId,
      plan: input.plan,
      locale: user.preferredLang,
      stripeCouponId: promo?.stripe_coupon_id ?? null,
      successUrl: `${this.env.WEB_BASE_URL}/konto?checkout=success`,
      cancelUrl: `${this.env.WEB_BASE_URL}/konto?checkout=canceled`,
      metadata,
    });
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
        current_period_start: e.periodStart,
        current_period_end: periodEnd,
        contract_no: contractNo,
      })
      .onConflict((oc) => oc.column('stripe_subscription_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return;
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
    await this.mail.send({
      to: user.email,
      template: 'subscription_started',
      locale: user.preferred_lang,
      values: { plan: PLAN_NAMES[plan], periodEnd, contractNo },
      actionUrl: `${this.env.WEB_BASE_URL}/konto`,
    });
  }

  private async onSubscriptionUpdated(e: Extract<BillingEvent, { kind: 'subscription_updated' }>) {
    await this.db
      .updateTable('subscriptions')
      .set({
        status: e.status,
        cancel_at_period_end: e.cancelAtPeriodEnd,
        ...(e.periodStart ? { current_period_start: e.periodStart } : {}),
        ...(e.periodEnd ? { current_period_end: e.periodEnd } : {}),
        ...(e.status === 'canceled' ? { canceled_at: sql`coalesce(canceled_at, now())` } : {}),
      })
      .where('stripe_subscription_id', '=', e.subscriptionId)
      .execute();
  }

  /** US-07: ends the subscription at the end of the paid period; protection stays active until then. */
  async cancel(
    userId: string,
    details: CancelDetails = { kind: 'ordinary' },
  ): Promise<CancelReceipt> {
    const sub = await this.liveSubscription(userId);
    if (!sub) throw new NotFoundException({ error: 'no_subscription' });
    return this.cancelSubscription(sub.id, details);
  }

  private async cancelSubscription(
    subscriptionId: string,
    details: CancelDetails,
  ): Promise<CancelReceipt> {
    const sub = await this.db
      .selectFrom('subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id',
        's.stripe_subscription_id',
        's.contract_no',
        's.created_at',
        's.current_period_start',
        's.current_period_end',
        'u.email',
        'u.preferred_lang',
      ])
      .where('s.id', '=', subscriptionId)
      .executeTakeFirstOrThrow();
    const receivedAt = new Date();
    let endsAt = cancellationDate(sub, receivedAt);
    const atPeriodEnd = endsAt?.getTime() === sub.current_period_end?.getTime();
    if (sub.stripe_subscription_id) {
      const r = await this.payments.cancelAt(
        sub.stripe_subscription_id,
        atPeriodEnd ? null : endsAt,
      );
      if (atPeriodEnd) endsAt = r.periodEnd ?? endsAt;
    }
    await this.db
      .updateTable('subscriptions')
      .set({
        cancel_at_period_end: true,
        canceled_at: sql`coalesce(canceled_at, now())`,
        ...(atPeriodEnd ? {} : { current_period_end: endsAt }),
      })
      .where('id', '=', sub.id)
      .execute();
    if (details.kind === 'extraordinary') {
      // Extraordinary cancellations need a human decision (refund, immediate end); support picks them up.
      await this.db
        .insertInto('outbox_events')
        .values({
          topic: 'support.extraordinary_cancellation',
          payload: JSON.stringify({ subscriptionId: sub.id, reason: details.reason ?? '' }),
        })
        .execute();
    }
    await this.mail.send({
      to: sub.email,
      template: 'cancel_received',
      locale: sub.preferred_lang,
      values: { receivedAt, contractNo: sub.contract_no ?? '', endsAt: endsAt ?? receivedAt },
    });
    return { receivedAt, found: true, contractNo: sub.contract_no ?? undefined, endsAt };
  }

  /** §312k BGB: cancellation without signing in, by e-mail address + contract number. */
  async cancelWithoutLogin(input: {
    email: string;
    contractNo: string;
    captcha?: string;
    locale: 'de' | 'en';
    ipPrefix: string;
    kind: CancelDetails['kind'];
    reason?: string;
  }): Promise<CancelReceipt> {
    if (!(await this.captcha.verify(input.captcha))) {
      throw new BadRequestException({ error: 'captcha_failed' });
    }
    const email = normalizeEmail(input.email);
    await this.limits.enforce('cancel.ip', input.ipPrefix);
    await this.limits.enforce('cancel.email', sha256(email).toString('hex'));

    const sub = await this.db
      .selectFrom('subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select('s.id')
      .where('u.email', '=', email)
      .where('s.contract_no', '=', input.contractNo.trim().toUpperCase())
      .where('s.status', 'in', LIVE)
      .executeTakeFirst();
    if (sub) return this.cancelSubscription(sub.id, { kind: input.kind, reason: input.reason });

    const receivedAt = new Date();
    await this.mail.send({
      to: email,
      template: 'cancel_not_found',
      locale: input.locale,
      values: { receivedAt },
    });
    return { receivedAt, found: false };
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
      .set({ status: 'past_due' })
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
   * makes their decals inactive (US-08). Cancelled ones after one day, any others after a 21-day grace.
   */
  async expireEnded(): Promise<number> {
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
          eb('current_period_end', '<', sql<Date>`now() - interval '21 days'`),
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
