import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';
import { WithdrawalsService } from '../legal/withdrawals.service';
import { maskEmail } from './mask';
import { StaffService, type StaffContext } from './staff.service';

export const LEGAL_FILTERS = ['review', 'open', 'all'] as const;
export type LegalFilter = (typeof LEGAL_FILTERS)[number];

/**
 * Review queue for § 356a withdrawals and § 312k cancellations that could not be matched or need a
 * decision (extraordinary cancellation, out of period, business customer). E-mails are masked; every
 * read and every decision is audited.
 */
@Injectable()
export class LegalRequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(WithdrawalsService) private readonly withdrawals: WithdrawalsService,
  ) {}

  async list(by: StaffContext, filter: LegalFilter) {
    let w = this.db
      .selectFrom('withdrawal_requests as w')
      .leftJoin('subscriptions as s', 's.id', 'w.subscription_id')
      .select([
        'w.id',
        sql<string>`'withdrawal'`.as('kind'),
        'w.status',
        'w.channel',
        'w.received_at as receivedAt',
        'w.submitted_name as name',
        'w.receipt_email as email',
        'w.submitted_contract_ref as contractRef',
        's.contract_no as contractNo',
        'w.review_note as note',
        'w.refund_amount_cents as refundCents',
        sql<string | null>`null`.as('type'),
        sql<Date | null>`null`.as('endsAt'),
      ]);
    let c = this.db
      .selectFrom('cancellation_requests as c')
      .leftJoin('subscriptions as s', 's.id', 'c.subscription_id')
      .select([
        'c.id',
        sql<string>`'cancellation'`.as('kind'),
        'c.status',
        'c.channel',
        'c.received_at as receivedAt',
        'c.submitted_name as name',
        'c.submitted_email as email',
        'c.submitted_contract_ref as contractRef',
        's.contract_no as contractNo',
        'c.review_note as note',
        sql<number | null>`null`.as('refundCents'),
        'c.type',
        'c.computed_end_date as endsAt',
      ]);
    if (filter === 'review') {
      w = w.where('w.status', 'in', ['needs_review', 'rejected_out_of_period']);
      c = c.where('c.status', '=', 'needs_review');
    } else if (filter === 'open') {
      w = w.where('w.status', 'in', ['received', 'matched', 'needs_review']);
      c = c.where('c.status', 'in', ['received', 'scheduled', 'needs_review']);
    }
    const [ws, cs] = await Promise.all([
      w.orderBy('w.received_at', 'desc').limit(200).execute(),
      c.orderBy('c.received_at', 'desc').limit(200).execute(),
    ]);
    const rows = [...ws, ...cs]
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, 200);
    await this.staff.auditRead(by.userId, 'legal_requests.list', 'legal_requests', null, {
      filter,
      rows: rows.length,
    });
    return rows.map((r) => ({ ...r, email: r.email ? maskEmail(r.email) : null }));
  }

  /** Links an unmatched withdrawal to a contract number and processes it. */
  async assignWithdrawal(by: StaffContext, id: string, contractNo: string) {
    const s = await this.db
      .selectFrom('subscriptions')
      .select('id')
      .where('contract_no', '=', contractNo.trim().toUpperCase())
      .executeTakeFirst();
    if (!s) throw new NotFoundException({ error: 'contract_not_found' });
    await this.withdrawals.assign(id, s.id);
    await this.staff.audit(by.userId, 'withdrawal.assign', 'withdrawal_requests', id, {
      subscriptionId: s.id,
    });
  }

  /** Closes a review item with a note (e.g. after contacting the customer). */
  async resolve(by: StaffContext, kind: 'withdrawal' | 'cancellation', id: string, note: string) {
    if (kind === 'withdrawal') {
      const r = await this.db
        .updateTable('withdrawal_requests')
        .set({
          review_note: note,
          status: 'processed',
          processed_at: sql`coalesce(processed_at, now())`,
        })
        .where('id', '=', id)
        .where('status', 'in', ['needs_review', 'rejected_out_of_period'])
        .executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw new NotFoundException({ error: 'not_in_review' });
    } else {
      const r = await this.db
        .updateTable('cancellation_requests')
        .set({
          review_note: note,
          status: sql`CASE WHEN subscription_id IS NULL THEN 'completed' ELSE 'scheduled' END`,
        })
        .where('id', '=', id)
        .where('status', '=', 'needs_review')
        .executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw new NotFoundException({ error: 'not_in_review' });
    }
    await this.staff.audit(by.userId, `${kind}.resolve`, `${kind}_requests`, id, { note });
  }
}
