import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { RefundsService } from '../billing/refunds.service';
import { OrdersService } from '../orders/orders.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { normalizeEmail } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { DB, ENV, LOGGER } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { PAYMENTS, type Payments } from '../providers/ports';
import { TagsService } from '../vehicles/tags.service';
import { LegalTextsService } from './legal-texts.service';
import { withdrawalOpenUntil } from './rules';

export const WITHDRAWAL_TOPIC = 'legal.withdrawal';

export interface WithdrawalInput {
  channel: 'public_form' | 'portal';
  userId?: string;
  name: string;
  /** Contract number or the e-mail used at checkout. */
  contractRef: string;
  receiptEmail: string;
  locale: 'de' | 'en';
  ipHash: Buffer | null;
}

const CONTRACT_NO = /^PS-[0-9A-Z]{8}$/;

/**
 * § 356a BGB online withdrawal. Receiving it is one step: store, confirm receipt by e-mail with date
 * and time, queue. Matching and processing run in the worker (idempotent, retried) and never ask for a
 * reason. A request that cannot be matched waits for ops instead of being dropped.
 */
@Injectable()
export class WithdrawalsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(TagsService) private readonly tags: TagsService,
    @Inject(LegalTextsService) private readonly texts: LegalTextsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  async submit(input: WithdrawalInput): Promise<{ id: string; receivedAt: Date }> {
    if (input.channel === 'public_form') {
      await this.limits.enforce(
        'withdrawal.ip',
        (input.ipHash ?? Buffer.from('none')).toString('hex'),
      );
    }
    let subscriptionId: string | null = null;
    if (input.userId) {
      const s = await this.db
        .selectFrom('subscriptions')
        .select('id')
        .where('user_id', '=', input.userId)
        .where('status', 'in', ['active', 'past_due'])
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      subscriptionId = s?.id ?? null;
    }
    const row = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .insertInto('withdrawal_requests')
        .values({
          subscription_id: subscriptionId,
          submitted_name: input.name.trim(),
          submitted_contract_ref: input.contractRef.trim(),
          receipt_email: normalizeEmail(input.receiptEmail),
          locale: input.locale,
          channel: input.channel,
          status: subscriptionId ? 'matched' : 'received',
          ip_hash: input.ipHash,
        })
        .returning(['id', 'received_at'])
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('outbox_events')
        .values({ topic: WITHDRAWAL_TOPIC, payload: JSON.stringify({ id: r.id }) })
        .execute();
      return r;
    });
    // Receipt only: it confirms that we received the withdrawal, not that it is valid.
    // TODO [LEGAL REVIEW: withdrawal receipt wording]
    await this.mail.send({
      to: input.receiptEmail,
      template: 'withdrawal_received',
      locale: input.locale,
      values: {
        receivedAt: row.received_at,
        name: input.name.trim(),
        contractRef: input.contractRef.trim(),
        receiptEmail: normalizeEmail(input.receiptEmail),
      },
    });
    return { id: row.id, receivedAt: row.received_at };
  }

  private async findSubscription(ref: string): Promise<string[]> {
    const value = ref.trim();
    let q = this.db
      .selectFrom('subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select('s.id')
      .where('s.status', 'in', ['active', 'past_due']);
    q = CONTRACT_NO.test(value.toUpperCase())
      ? q.where('s.contract_no', '=', value.toUpperCase())
      : q.where('u.email', '=', normalizeEmail(value));
    return (await q.limit(2).execute()).map((r) => r.id);
  }

  private async flag(id: string, status: 'needs_review' | 'rejected_out_of_period', note: string) {
    await this.db
      .updateTable('withdrawal_requests')
      .set({ status, review_note: note })
      .where('id', '=', id)
      .execute();
  }

  /** Worker step: match, end the contract, refund minus Wertersatz, revoke the codes. Idempotent. */
  async process(id: string): Promise<void> {
    const req = await this.db
      .selectFrom('withdrawal_requests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!req || (req.status !== 'received' && req.status !== 'matched')) return;

    let subscriptionId = req.subscription_id;
    if (!subscriptionId) {
      const found = await this.findSubscription(req.submitted_contract_ref);
      if (found.length !== 1) {
        await this.flag(id, 'needs_review', found.length ? 'ambiguous' : 'no_contract_found');
        return;
      }
      subscriptionId = found[0]!;
      await this.db
        .updateTable('withdrawal_requests')
        .set({ subscription_id: subscriptionId, status: 'matched' })
        .where('id', '=', id)
        .execute();
    }

    const sub = await this.db
      .selectFrom('subscriptions')
      .select([
        'id',
        'user_id',
        'status',
        'customer_type',
        'created_at',
        'stripe_subscription_id',
        'contract_no',
        'provider',
      ])
      .where('id', '=', subscriptionId)
      .executeTakeFirstOrThrow();
    if (sub.status === 'withdrawn') {
      await this.db
        .updateTable('withdrawal_requests')
        .set({ status: 'processed', processed_at: sql`coalesce(processed_at, now())` })
        .where('id', '=', id)
        .execute();
      return;
    }
    if (sub.customer_type !== 'b2c') {
      await this.flag(id, 'needs_review', 'business_customer');
      return;
    }
    // A6: App Store / Google Play subscriptions are refunded by Apple/Google (the seller); ops
    // answers with the store's refund route. No calculation of ours runs for them.
    if (sub.provider !== 'stripe') {
      await this.flag(id, 'needs_review', `store_subscription ${sub.provider}`);
      return;
    }
    // Sent in time counts (§ 355 Abs. 1 S. 5 BGB): measured at receipt, not at processing.
    const until = withdrawalOpenUntil(sub.created_at, await this.texts.withdrawalDays());
    if (req.received_at > until) {
      await this.flag(id, 'rejected_out_of_period', `period_ended ${until.toISOString()}`);
      return;
    }

    // Refund (paid − Wertersatz). Ends the subscription locally and at the provider.
    let refundCents = 0;
    try {
      const r = await this.refunds.execute(
        null,
        { kind: 'withdrawal', subscriptionId: sub.id },
        `Widerruf ${id}`,
        req.received_at,
      );
      refundCents = r.refundCents;
    } catch (err) {
      const code = (err as { response?: { error?: string } }).response?.error;
      if (code !== 'nothing_to_refund' && code !== 'no_charge') throw err;
      if (sub.stripe_subscription_id) await this.payments.cancelNow(sub.stripe_subscription_id);
    }

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('subscriptions')
        .set({
          status: 'withdrawn',
          withdrawn_at: sql`coalesce(withdrawn_at, now())`,
          canceled_at: sql`coalesce(canceled_at, now())`,
          cancel_at_period_end: true,
          current_period_end: sql`least(current_period_end, now())`,
        })
        .where('id', '=', sub.id)
        .execute();
      if (sub.user_id) await this.tags.revokeAllOfUser(trx, sub.user_id, 'system', 'withdrawn');
      await trx
        .updateTable('withdrawal_requests')
        .set({ status: 'processed', refund_amount_cents: refundCents, processed_at: sql`now()` })
        .where('id', '=', id)
        .execute();
    });
    // B4: withdrawal before personalisation: the fulfillment order is cancelled, nothing is shipped.
    // A personalised sticker is never reshipped and never has to be returned.
    if (sub.user_id) await this.orders.cancelUnpersonalized(sub.user_id);
    this.logger.info({ withdrawalId: id, subscriptionId: sub.id, refundCents }, 'withdrawal done');
  }

  /** Ops: link an unmatched request to a contract by hand and process it. */
  async assign(id: string, subscriptionId: string): Promise<void> {
    await this.db
      .updateTable('withdrawal_requests')
      .set({ subscription_id: subscriptionId, status: 'matched', review_note: null })
      .where('id', '=', id)
      .where('status', 'in', ['received', 'needs_review'])
      .execute();
    await this.process(id);
  }

  /** Whether the person has a contract that can still be withdrawn (portal button). */
  async openFor(userId: string): Promise<Date | null> {
    const s = await this.db
      .selectFrom('subscriptions')
      .select(['created_at', 'customer_type'])
      .where('user_id', '=', userId)
      .where('status', 'in', ['active', 'past_due'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!s || s.customer_type !== 'b2c') return null;
    const until = withdrawalOpenUntil(s.created_at, await this.texts.withdrawalDays());
    return until > new Date() ? until : null;
  }
}
