import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB, ENV, LOGGER } from '../core/tokens';
import type { RefundKind } from '../db/types.generated';
import { MailService } from '../mail/mail.service';
import { textPdf } from '../providers/pdf';
import { PAYMENTS, type Charge, type Payments } from '../providers/ports';

const DAY = 86_400_000;
const VAT = 0.19;

/** Shown on credit notes until the company is registered (same placeholders as the Impressum). */
export const ISSUER = [
  '[Firmenname] (in Gründung), [Straße Hausnummer], [PLZ Ort], Deutschland',
  'Umsatzsteuer-Identifikationsnummer: [USt-IdNr.]',
];

export type RefundInput =
  | { kind: 'withdrawal' | 'proration'; subscriptionId: string }
  | { kind: 'goodwill'; subscriptionId: string; amountCents: number }
  | { kind: 'goodwill'; orderId: string; amountCents: number }
  | { kind: 'decal_defect'; orderId: string };

export interface RefundQuote {
  kind: RefundKind;
  target: { type: 'subscription' | 'order'; id: string };
  contractNo: string | null;
  paidCents: number;
  alreadyRefundedCents: number;
  daysUsed: number | null;
  periodDays: number | null;
  wertersatzCents: number;
  decalCostCents: number;
  refundCents: number;
  /** Withdrawal ends the contract at once, so the decals stop working. */
  endsSubscriptionNow: boolean;
}

const euro = (cents: number, locale: 'de' | 'en' = 'de') =>
  new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);

const KIND_DE: Record<RefundKind, string> = {
  withdrawal: 'Widerruf',
  proration: 'Anteilige Erstattung nach Kündigung',
  goodwill: 'Kulanz',
  decal_defect: 'Mangelhafter Aufkleber',
};

/**
 * AD-12 withdrawal and refund tool. Amount = paid − value of the days used (Wertersatz, only when the
 * customer asked for the immediate start) − cost of the custom-printed decal (§312g Abs. 2 Nr. 1 BGB).
 * The final calculation method is set by the lawyer in Phase 0; the inputs are runtime settings.
 */
@Injectable()
export class RefundsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private async subscription(id: string) {
    const s = await this.db
      .selectFrom('subscriptions as s')
      .leftJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id',
        's.user_id',
        's.status',
        's.contract_no',
        's.stripe_subscription_id',
        's.created_at',
        's.current_period_start',
        's.current_period_end',
        's.cancel_at_period_end',
        's.withdrawal_waiver_at',
        'u.email',
        'u.preferred_lang',
      ])
      .where('s.id', '=', id)
      .executeTakeFirst();
    if (!s) throw new NotFoundException({ error: 'subscription_not_found' });
    return s;
  }

  private async order(id: string) {
    const o = await this.db
      .selectFrom('decal_orders as o')
      .leftJoin('users as u', 'u.id', 'o.user_id')
      .select([
        'o.id',
        'o.user_id',
        'o.status',
        'o.total_gross_cents',
        'o.stripe_payment_intent',
        'u.email',
        'u.preferred_lang',
      ])
      .where('o.id', '=', id)
      .executeTakeFirst();
    if (!o) throw new NotFoundException({ error: 'order_not_found' });
    return o;
  }

  /** Our own records and the provider's: the larger "already refunded" wins. */
  private async refunded(charge: Charge, target: { subscriptionId?: string; orderId?: string }) {
    let q = this.db
      .selectFrom('refunds')
      .select((eb) =>
        eb.fn.coalesce(eb.fn.sum<string>('refund_gross_cents'), sql<string>`0`).as('n'),
      );
    q = target.subscriptionId
      ? q.where('subscription_id', '=', target.subscriptionId)
      : q.where('decal_order_id', '=', target.orderId!);
    const { n } = await q.executeTakeFirstOrThrow();
    return Math.max(charge.refundedCents, Number(n));
  }

  async quote(input: RefundInput, now = new Date()): Promise<RefundQuote> {
    if ('orderId' in input) {
      const o = await this.order(input.orderId);
      if (!o.stripe_payment_intent || o.total_gross_cents <= 0)
        throw new ConflictException({ error: 'not_paid_online' });
      const charge = await this.payments.findCharge({ paymentIntentId: o.stripe_payment_intent });
      if (!charge) throw new ConflictException({ error: 'no_charge' });
      const already = await this.refunded(charge, { orderId: o.id });
      const left = charge.amountCents - already;
      const refund = input.kind === 'goodwill' ? input.amountCents : left;
      if (refund > left) throw new ConflictException({ error: 'amount_too_high', max: left });
      return {
        kind: input.kind,
        target: { type: 'order', id: o.id },
        contractNo: null,
        paidCents: charge.amountCents,
        alreadyRefundedCents: already,
        daysUsed: null,
        periodDays: null,
        wertersatzCents: 0,
        decalCostCents: 0,
        refundCents: Math.max(0, refund),
        endsSubscriptionNow: false,
      };
    }

    const s = await this.subscription(input.subscriptionId);
    if (!s.stripe_subscription_id) throw new ConflictException({ error: 'no_charge' });
    const charge = await this.payments.findCharge({ subscriptionId: s.stripe_subscription_id });
    if (!charge) throw new ConflictException({ error: 'no_charge' });
    const already = await this.refunded(charge, { subscriptionId: s.id });
    const left = charge.amountCents - already;
    const start = s.current_period_start ?? s.created_at;
    const base = {
      target: { type: 'subscription' as const, id: s.id },
      contractNo: s.contract_no,
      paidCents: charge.amountCents,
      alreadyRefundedCents: already,
    };

    if (input.kind === 'withdrawal') {
      const days = await this.settings.get('refunds.withdrawal_days', 14);
      if (now.getTime() - s.created_at.getTime() > days * DAY)
        throw new ConflictException({ error: 'withdrawal_period_over' });
      if (s.status !== 'active' && s.status !== 'past_due')
        throw new ConflictException({ error: 'not_live' });
      const end = s.current_period_end ?? new Date(start.getTime() + 365 * DAY);
      const periodDays = Math.round((end.getTime() - start.getTime()) / DAY);
      // §357a Abs. 2 BGB: value of the service provided until the withdrawal, per started day.
      const daysUsed = s.withdrawal_waiver_at
        ? Math.max(1, Math.ceil((now.getTime() - start.getTime()) / DAY))
        : 0;
      const wertersatz = Math.round((charge.amountCents * daysUsed) / periodDays);
      const printed = await this.db
        .selectFrom('decal_orders')
        .select('id')
        .where('user_id', '=', s.user_id)
        .where('included_in_plan', '=', true)
        .where('status', 'in', ['in_production', 'shipped', 'delivered', 'returned'])
        .executeTakeFirst();
      const decal = printed ? await this.settings.get('refunds.custom_decal_cost_cents', 250) : 0;
      return {
        ...base,
        kind: 'withdrawal',
        daysUsed,
        periodDays,
        wertersatzCents: wertersatz,
        decalCostCents: decal,
        refundCents: Math.max(0, left - wertersatz - decal),
        endsSubscriptionNow: true,
      };
    }

    if (input.kind === 'proration') {
      // §309 Nr. 9 BGB after renewal: cancelled with one month's notice, the rest of the paid year back.
      if (!s.cancel_at_period_end || !s.current_period_end)
        throw new ConflictException({ error: 'not_cancelled' });
      const paidEnd = new Date(start);
      paidEnd.setUTCFullYear(paidEnd.getUTCFullYear() + 1);
      const periodDays = Math.round((paidEnd.getTime() - start.getTime()) / DAY);
      const unused = Math.floor((paidEnd.getTime() - s.current_period_end.getTime()) / DAY);
      if (unused <= 0) throw new ConflictException({ error: 'nothing_to_refund' });
      return {
        ...base,
        kind: 'proration',
        daysUsed: periodDays - unused,
        periodDays,
        wertersatzCents: 0,
        decalCostCents: 0,
        refundCents: Math.min(left, Math.round((charge.amountCents * unused) / periodDays)),
        endsSubscriptionNow: false,
      };
    }

    const amount = 'amountCents' in input ? input.amountCents : 0;
    if (amount > left) throw new ConflictException({ error: 'amount_too_high', max: left });
    return {
      ...base,
      kind: 'goodwill',
      daysUsed: null,
      periodDays: null,
      wertersatzCents: 0,
      decalCostCents: 0,
      refundCents: amount,
      endsSubscriptionNow: false,
    };
  }

  /**
   * Executes the refund at the provider and issues the credit note (Gutschrift). Serialised per
   * contract or order, and recomputed under the lock, so a double click never pays out twice.
   */
  async execute(staffId: string, input: RefundInput, reason: string) {
    const targetId = 'orderId' in input ? input.orderId : input.subscriptionId;
    const result = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`refund:${targetId}`}))`.execute(trx);
      const q = await this.quote(input);
      if (q.refundCents <= 0) throw new ConflictException({ error: 'nothing_to_refund' });
      const { n } = (
        await sql<{ n: string }>`SELECT nextval('credit_note_seq')::text AS n`.execute(trx)
      ).rows[0]!;
      const creditNoteNo = `GS-${new Date().getUTCFullYear()}-${n.padStart(6, '0')}`;
      const row = await trx
        .insertInto('refunds')
        .values({
          subscription_id: q.target.type === 'subscription' ? q.target.id : null,
          decal_order_id: q.target.type === 'order' ? q.target.id : null,
          kind: q.kind,
          paid_gross_cents: q.paidCents,
          wertersatz_cents: q.wertersatzCents,
          decal_cost_cents: q.decalCostCents,
          refund_gross_cents: q.refundCents,
          credit_note_no: creditNoteNo,
          contract_no: q.contractNo,
          reason,
          days_used: q.daysUsed,
          period_days: q.periodDays,
          requested_by: staffId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const charge =
        q.target.type === 'order'
          ? (await this.order(q.target.id)).stripe_payment_intent!
          : (await this.payments.findCharge({
              subscriptionId: (await this.subscription(q.target.id)).stripe_subscription_id!,
            }))!.paymentIntentId;
      // Inside the transaction: if the provider refuses, nothing is recorded.
      const { refundId } = await this.payments.refund({
        paymentIntentId: charge,
        amountCents: q.refundCents,
        metadata: { creditNote: creditNoteNo, kind: q.kind },
      });
      await trx
        .updateTable('refunds')
        .set({ stripe_refund_id: refundId })
        .where('id', '=', row.id)
        .execute();
      if (q.endsSubscriptionNow) {
        await trx
          .updateTable('subscriptions')
          .set({
            status: 'canceled',
            canceled_at: sql`coalesce(canceled_at, now())`,
            cancel_at_period_end: true,
            current_period_end: sql`now()`,
          })
          .where('id', '=', q.target.id)
          .execute();
      }
      if (q.kind === 'decal_defect') {
        await trx
          .updateTable('decal_orders')
          .set({ status: 'refunded' })
          .where('id', '=', q.target.id)
          .execute();
      }
      return { id: row.id, creditNoteNo, quote: q, refundId };
    });

    if (result.quote.endsSubscriptionNow) {
      const s = await this.subscription(result.quote.target.id);
      // The local contract already ended; a provider hiccup here is retried by hand, not lost.
      await this.payments
        .cancelNow(s.stripe_subscription_id!)
        .catch((err: unknown) =>
          this.logger.error(
            { err: String(err), subscriptionId: s.id },
            'cancelNow after withdrawal failed',
          ),
        );
    }
    const who =
      result.quote.target.type === 'order'
        ? await this.order(result.quote.target.id)
        : await this.subscription(result.quote.target.id);
    if (who.email) {
      await this.mail.send({
        to: who.email,
        template: 'refund_issued',
        locale: who.preferred_lang ?? 'de',
        values: {
          amount: euro(result.quote.refundCents, who.preferred_lang ?? 'de'),
          creditNote: result.creditNoteNo,
          ended: result.quote.endsSubscriptionNow ? 'yes' : 'no',
        },
        actionUrl: `${this.env.WEB_BASE_URL}/konto`,
      });
    }
    return {
      id: result.id,
      creditNoteNo: result.creditNoteNo,
      refundCents: result.quote.refundCents,
    };
  }

  async list(filter: { subscriptionId?: string; orderId?: string; userId?: string } = {}) {
    let q = this.db
      .selectFrom('refunds as r')
      .leftJoin('subscriptions as s', 's.id', 'r.subscription_id')
      .leftJoin('decal_orders as o', 'o.id', 'r.decal_order_id')
      .select([
        'r.id',
        'r.kind',
        'r.refund_gross_cents as refundCents',
        'r.paid_gross_cents as paidCents',
        'r.credit_note_no as creditNoteNo',
        'r.contract_no as contractNo',
        'r.reason',
        'r.created_at as createdAt',
        'r.subscription_id as subscriptionId',
        'r.decal_order_id as orderId',
      ])
      .orderBy('r.created_at', 'desc')
      .limit(200);
    if (filter.subscriptionId) q = q.where('r.subscription_id', '=', filter.subscriptionId);
    if (filter.orderId) q = q.where('r.decal_order_id', '=', filter.orderId);
    if (filter.userId)
      q = q.where((eb) =>
        eb.or([eb('s.user_id', '=', filter.userId!), eb('o.user_id', '=', filter.userId!)]),
      );
    return q.execute();
  }

  /** The credit note (Gutschrift) as PDF, rendered from the refund row alone. */
  async creditNotePdf(
    refundId: string,
    userId?: string,
  ): Promise<{ file: Buffer; number: string }> {
    let q = this.db
      .selectFrom('refunds as r')
      .leftJoin('subscriptions as s', 's.id', 'r.subscription_id')
      .leftJoin('decal_orders as o', 'o.id', 'r.decal_order_id')
      .selectAll('r')
      .where('r.id', '=', refundId);
    if (userId)
      q = q.where((eb) => eb.or([eb('s.user_id', '=', userId), eb('o.user_id', '=', userId)]));
    const r = await q.executeTakeFirst();
    if (!r?.credit_note_no) throw new NotFoundException({ error: 'credit_note_not_found' });
    const vat = Math.round(r.refund_gross_cents - r.refund_gross_cents / (1 + VAT));
    const lines = [
      '# Aussteller',
      ...ISSUER,
      '',
      '# Empfänger',
      r.contract_no ? `Vertragsnummer: ${r.contract_no}` : `Bestellung: ${r.decal_order_id ?? '-'}`,
      '',
      '# Gutschrift',
      `Datum: ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'Europe/Berlin' }).format(r.created_at)}`,
      `Anlass: ${KIND_DE[r.kind]}`,
      `Bezahlt: ${euro(r.paid_gross_cents)}`,
      ...(r.wertersatz_cents
        ? [`Wertersatz für ${r.days_used} von ${r.period_days} Tagen: -${euro(r.wertersatz_cents)}`]
        : []),
      ...(r.decal_cost_cents
        ? [
            `Individuell bedruckter Aufkleber (§ 312g Abs. 2 Nr. 1 BGB): -${euro(r.decal_cost_cents)}`,
          ]
        : []),
      `Erstattungsbetrag (brutto): ${euro(r.refund_gross_cents)}`,
      `Darin enthaltene Umsatzsteuer (19 %): ${euro(vat)}`,
      '',
      'Der Betrag wird auf das ursprüngliche Zahlungsmittel erstattet.',
      ...(r.stripe_refund_id ? [`Zahlungsreferenz: ${r.stripe_refund_id}`] : []),
    ];
    return { file: textPdf(`Gutschrift ${r.credit_note_no}`, lines), number: r.credit_note_no };
  }
}
