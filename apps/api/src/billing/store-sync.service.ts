import { timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { LEGAL_DOC_VERSION } from '@parkshield/shared';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { AuthContext } from '../auth/session.service';
import { isTestEnvironment, type Env } from '../config/env';
import type { Db } from '../core/core.module';
import { randomCrockford } from '../core/crypto';
import { DB, ENV, LOGGER } from '../core/tokens';
import { ConsentsService } from '../legal/consents.service';
import { LegalTextsService } from '../legal/legal-texts.service';
import { queueWelcomeLetterCheck } from '../letters/trigger';
import { OrdersService } from '../orders/orders.service';
import { ProfileService } from '../profile/profile.service';
import { STORE_BILLING, type StoreBilling, type StoreSubscriber } from '../providers/ports';
import { BillingService } from './billing.service';
import { queuePaymentNotification } from './payment-notify.queue';

export const STORE_SYNC_TOPIC = 'store.sync';

/** Used only when no REVENUECAT_WEBHOOK_AUTH is set, in test environments (fake store). */
export const DEV_WEBHOOK_AUTH = 'dev-revenuecat-webhook';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The RevenueCat webhook event fields we read (docs: RevenueCat → Integrations → Webhooks). */
export interface RcEvent {
  id: string;
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  transferred_from?: string[];
  transferred_to?: string[];
  cancel_reason?: string | null;
  store?: string;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  product_id?: string;
}

export interface SyncHint {
  eventId?: string;
  type?: string;
  cancelReason?: string | null;
  originalTransactionId?: string | null;
  transactionId?: string | null;
}

/** Unified status from a store subscriber (pure, unit-tested). */
export function storeStatus(
  s: StoreSubscriber,
  hint: SyncHint | undefined,
  now = new Date(),
): { status: 'active' | 'past_due' | 'expired'; refunded: boolean } {
  // RevenueCat reports refunds as CANCELLATION with cancel_reason CUSTOMER_SUPPORT.
  const refunded =
    s.refundedAt !== null ||
    (hint?.type === 'CANCELLATION' && hint.cancelReason === 'CUSTOMER_SUPPORT');
  if (refunded) return { status: 'expired', refunded: true };
  if (s.periodEnd.getTime() > now.getTime()) {
    return { status: s.billingIssueAt ? 'past_due' : 'active', refunded: false };
  }
  return { status: 'expired', refunded: false };
}

const LIVE = ['active', 'past_due'] as const;

/**
 * App Store / Google Play subscriptions through RevenueCat (docs/billing-unified.md, option A): our
 * `subscriptions` table is the entitlement hub. Every webhook event is stored once and synced in the
 * worker by reading the subscriber from RevenueCat's REST API (the truth), never from the payload.
 */
@Injectable()
export class StoreSyncService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(STORE_BILLING) private readonly store: StoreBilling,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ConsentsService) private readonly consents: ConsentsService,
    @Inject(LegalTextsService) private readonly legalTexts: LegalTextsService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
  ) {}

  /** Webhook: verify the Authorization header, store the event id once, queue the sync. */
  async receive(authorization: string | undefined, body: { event?: RcEvent }): Promise<void> {
    const expected =
      this.env.REVENUECAT_WEBHOOK_AUTH || (isTestEnvironment(this.env) ? DEV_WEBHOOK_AUTH : '');
    if (!expected) throw new ServiceUnavailableException();
    const given = Buffer.from(authorization ?? '');
    const want = Buffer.from(expected);
    const bearer = Buffer.from(`Bearer ${expected}`);
    const ok =
      (given.length === want.length && timingSafeEqual(given, want)) ||
      (given.length === bearer.length && timingSafeEqual(given, bearer));
    if (!ok) throw new UnauthorizedException();
    const e = body.event;
    if (!e?.id || !e.type) return;
    const users = await this.usersOf(e);
    const fresh = await this.db
      .insertInto('billing_webhook_events')
      .values({
        provider: 'revenuecat',
        event_id: e.id.slice(0, 255),
        type: e.type.slice(0, 80),
        app_user_id: users[0] ?? null,
      })
      .onConflict((oc) => oc.columns(['provider', 'event_id']).doNothing())
      .returning('event_id')
      .executeTakeFirst();
    if (!fresh) return; // replayed event: already stored and queued once
    if (e.type === 'TEST' || !users.length) {
      await this.markProcessed(e.id);
      return;
    }
    const hint: SyncHint = {
      eventId: e.id,
      type: e.type,
      cancelReason: e.cancel_reason ?? null,
      originalTransactionId: e.original_transaction_id ?? null,
      transactionId: e.transaction_id ?? null,
    };
    await this.db
      .insertInto('outbox_events')
      .values(
        users.map((userId) => ({
          topic: STORE_SYNC_TOPIC,
          payload: JSON.stringify({ userId, hint }),
        })),
      )
      .execute();
  }

  /** Our user ids in an event (TRANSFER: both sides). Only UUIDs of existing accounts. */
  private async usersOf(e: RcEvent): Promise<string[]> {
    const ids = new Set<string>();
    const add = (v: string | null | undefined) => v && UUID.test(v) && ids.add(v.toLowerCase());
    if (e.type === 'TRANSFER') {
      e.transferred_from?.forEach(add);
      e.transferred_to?.forEach(add);
    } else {
      add(e.app_user_id);
      add(e.original_app_user_id);
      e.aliases?.forEach(add);
    }
    if (!ids.size) return [];
    const rows = await this.db
      .selectFrom('users')
      .select('id')
      .where('id', 'in', [...ids])
      .execute();
    return rows.map((r) => r.id);
  }

  private async markProcessed(eventId: string) {
    await this.db
      .updateTable('billing_webhook_events')
      .set({ processed_at: sql`now()` })
      .where('provider', '=', 'revenuecat')
      .where('event_id', '=', eventId)
      .execute();
  }

  /**
   * Before the store purchase sheet opens (A2): the same gates as the web checkout and the
   * immediate-start consent stored exactly as there. Returns the RevenueCat app_user_id (our UUID).
   */
  async prepare(
    user: AuthContext,
    input: { immediateStartVersion: number; termsVersion: number },
    ipHash: Buffer | null,
  ): Promise<{ appUserId: string }> {
    if (await this.billing.liveSubscription(user.userId))
      throw new ConflictException({ error: 'already_subscribed' });
    if (!(await this.profiles.postalAddress(user.userId)))
      throw new ConflictException({ error: 'profile_incomplete' });
    if (!(await this.profiles.phoneVerified(user.userId)))
      throw new ConflictException({ error: 'phone_required' });
    await this.consents.record({
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
    return { appUserId: user.userId };
  }

  /** The latest immediate-start consent of the last 48 h not used by another contract. */
  private async storeConsent(userId: string) {
    return this.db
      .selectFrom('consent_records as c')
      .select(['c.id', 'c.accepted_at'])
      .where('c.user_id', '=', userId)
      .where('c.type', '=', 'immediate_start')
      .where('c.accepted', '=', true)
      .where('c.accepted_at', '>', sql<Date>`now() - interval '48 hours'`)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('subscriptions as s')
              .select('s.id')
              .whereRef('s.immediate_start_consent_id', '=', 'c.id'),
          ),
        ),
      )
      .orderBy('c.accepted_at', 'desc')
      .executeTakeFirst();
  }

  /**
   * Worker (and „Käufe wiederherstellen“): read the subscriber from RevenueCat and bring our record
   * up to date. Idempotent: the same state twice changes nothing and mails nothing.
   */
  async sync(userId: string, hint?: SyncHint): Promise<'active' | 'pending'> {
    const sub = await this.store.getSubscriber(userId);
    const result = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`store:${userId}`}))`.execute(trx);
      const rows = await trx
        .selectFrom('subscriptions')
        .selectAll()
        .where('user_id', '=', userId)
        .where('provider', 'in', ['app_store', 'play_store'])
        .orderBy('created_at', 'desc')
        .execute();

      if (!sub) {
        // No entitlement any more (e.g. transferred to another account): live store rows end.
        await trx
          .updateTable('subscriptions')
          .set({ status: 'expired', will_renew: false })
          .where('user_id', '=', userId)
          .where('provider', 'in', ['app_store', 'play_store'])
          .where('status', 'in', LIVE)
          .execute();
        return { created: null, existing: null, refunded: false, renewal: null, live: false };
      }

      const { status, refunded } = storeStatus(sub, hint);
      const live = status === 'active' || status === 'past_due';
      const same = rows.find(
        (r) =>
          r.provider === sub.store &&
          ((hint?.originalTransactionId &&
            r.store_original_transaction_id === hint.originalTransactionId) ||
            r.original_purchase_at?.getTime() === sub.originalPurchaseAt.getTime()),
      );

      if (same) {
        const renewal =
          hint?.type === 'RENEWAL' &&
          same.current_period_start?.getTime() !== sub.periodStart.getTime()
            ? same.id
            : null;
        // Never two live contracts: an ended store row only comes back while no other one is live.
        const blocked =
          live &&
          !(LIVE as readonly string[]).includes(same.status) &&
          Boolean(
            await trx
              .selectFrom('subscriptions')
              .select('id')
              .where('user_id', '=', userId)
              .where('id', '<>', same.id)
              .where('status', 'in', LIVE)
              .executeTakeFirst(),
          );
        if (same.status !== 'withdrawn' && !blocked) {
          await trx
            .updateTable('subscriptions')
            .set({
              status,
              will_renew: sub.willRenew && live,
              cancel_at_period_end: !sub.willRenew,
              current_period_start: sub.periodStart,
              current_period_end: sub.periodEnd,
              store_product_id: sub.productId,
              store_last_transaction_id: hint?.transactionId ?? sub.transactionId,
              store_price_cents: sub.priceCents ?? (await this.billing.storeYearPrice()),
              management_url: sub.managementUrl,
              ...(hint?.originalTransactionId &&
              same.store_original_transaction_id?.startsWith('rc:')
                ? { store_original_transaction_id: hint.originalTransactionId }
                : {}),
              ...(refunded ? { refunded_at: sql`coalesce(refunded_at, now())` } : {}),
              ...(status === 'past_due'
                ? { past_due_since: sql`coalesce(past_due_since, now())` }
                : { past_due_since: null }),
              ...(!live ? { canceled_at: sql`coalesce(canceled_at, now())` } : {}),
            })
            .where('id', '=', same.id)
            .execute();
        }
        return { created: null, existing: same.id, refunded, renewal, live };
      }

      if (!live) return { created: null, existing: null, refunded, renewal: null, live };

      const originalId =
        hint?.originalTransactionId ?? `rc:${sub.productId}:${sub.originalPurchaseAt.getTime()}`;
      // Transfer (2026-11-24): the same store purchase (one Apple ID / Google account) was recorded
      // for another of our accounts, and RevenueCat moved it to this one (TRANSFER event, or a
      // restore on the other account). The unique key (provider, original transaction) would make
      // the insert below a silent no-op and the app would wait forever. The other account's rows end
      // and keep their history under a marked id; this account gets its own contract.
      const moved = await trx
        .selectFrom('subscriptions')
        .select(['id', 'user_id', 'status', 'store_original_transaction_id'])
        .where('provider', '=', sub.store)
        .where('user_id', '<>', userId)
        .where((eb) =>
          eb.or([
            eb('store_original_transaction_id', '=', originalId),
            eb('original_purchase_at', '=', sub.originalPurchaseAt),
          ]),
        )
        .execute();
      for (const m of moved) {
        const wasLive = (LIVE as readonly string[]).includes(m.status);
        await trx
          .updateTable('subscriptions')
          .set({
            store_original_transaction_id: `${m.store_original_transaction_id ?? originalId}#moved:${m.id}`,
            ...(wasLive ? { status: 'expired', will_renew: false } : {}),
          })
          .where('id', '=', m.id)
          .execute();
      }
      if (moved.length) {
        this.logger.warn(
          { userId, fromUserIds: [...new Set(moved.map((m) => m.user_id))], rows: moved.length },
          'store purchase transferred from another account',
        );
      }

      // A new store contract. An older store contract of this account ends first (re-purchase).
      await trx
        .updateTable('subscriptions')
        .set({ status: 'expired', will_renew: false })
        .where('user_id', '=', userId)
        .where('provider', 'in', ['app_store', 'play_store'])
        .where('status', 'in', LIVE)
        .execute();
      const other = await trx
        .selectFrom('subscriptions')
        .select(['id', 'provider'])
        .where('user_id', '=', userId)
        .where('status', 'in', LIVE)
        .executeTakeFirst();
      const consent = await this.storeConsent(userId);
      const renewalMode = await this.legalTexts.renewalMode('b2c');
      const row = await trx
        .insertInto('subscriptions')
        .values({
          user_id: userId,
          plan: 'standard',
          // Double subscription (bought on the web and in the store): never two live contracts.
          // The store one is kept as `incomplete` for ops to refund; the app hides the purchase
          // button, so this needs a race or an old app version.
          status: other ? 'incomplete' : status,
          provider: sub.store,
          store_original_transaction_id: originalId,
          store_product_id: sub.productId,
          store_last_transaction_id: hint?.transactionId ?? sub.transactionId,
          store_price_cents: sub.priceCents ?? (await this.billing.storeYearPrice()),
          will_renew: sub.willRenew,
          cancel_at_period_end: !sub.willRenew,
          original_purchase_at: sub.originalPurchaseAt,
          current_period_start: sub.periodStart,
          current_period_end: sub.periodEnd,
          management_url: sub.managementUrl,
          customer_type: 'b2c',
          renewal_mode: renewalMode,
          contract_no: `PS-${randomCrockford(8)}`,
          sticker_value_cents: await this.billing.stickerValue(),
          withdrawal_notice_version: LEGAL_DOC_VERSION,
          immediate_start_consent_id: consent?.id ?? null,
          withdrawal_waiver_at: consent?.accepted_at ?? null,
          ...(status === 'past_due' ? { past_due_since: sql`now()` } : {}),
        })
        .onConflict((oc) => oc.doNothing())
        .returning(['id', 'status'])
        .executeTakeFirst();
      if (other) {
        this.logger.error(
          { userId, storeSubscriptionId: row?.id, otherProvider: other.provider },
          'double subscription: store purchase while another contract is live',
        );
      }
      return {
        created: row && row.status !== 'incomplete' ? row.id : null,
        existing: null,
        refunded,
        renewal: null,
        live: Boolean(row && row.status !== 'incomplete'),
      };
    });

    // A NEW subscription (any provider): welcome letter, payment@ and the contract confirmation, once.
    // Also for a live contract whose confirmation is missing (a worker stopped right after the insert).
    let fresh = result.created;
    if (!fresh && result.existing && result.live) {
      const sent = await this.db
        .selectFrom('contract_confirmations')
        .select('id')
        .where('subscription_id', '=', result.existing)
        .executeTakeFirst();
      if (!sent) fresh = result.existing;
    }
    if (fresh) {
      await queueWelcomeLetterCheck(this.db, userId);
      await queuePaymentNotification(this.db, {
        eventId: `rc:new:${fresh}`,
        kind: 'subscription',
        userId,
        subscriptionId: fresh,
        amountCents: sub?.priceCents ?? (await this.billing.storeYearPrice()),
        paymentRef: hint?.transactionId ?? sub?.transactionId ?? null,
        paidAt: new Date(),
      });
      await this.billing.sendContractConfirmation(fresh);
    }
    if (result.renewal && hint?.eventId) {
      await queuePaymentNotification(this.db, {
        eventId: `rc:${hint.eventId}`,
        kind: 'renewal',
        userId,
        subscriptionId: result.renewal,
        amountCents: sub?.priceCents ?? (await this.billing.storeYearPrice()),
        paymentRef: hint.transactionId ?? sub?.transactionId ?? null,
        paidAt: new Date(),
      });
    }
    // B4: a store refund before personalisation cancels the fulfillment order (nothing is shipped).
    if (result.refunded) await this.orders.cancelUnpersonalized(userId);
    if (hint?.eventId) await this.markProcessed(hint.eventId);
    return result.live ? 'active' : 'pending';
  }
}
