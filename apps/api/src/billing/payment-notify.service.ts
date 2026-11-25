import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { RetryLaterError } from '../core/retry-later';
import { DB, ENV, LOGGER } from '../core/tokens';
import { WelcomeLettersService } from '../letters/welcome-letters.service';
import { MailService } from '../mail/mail.service';

import { PAYMENT_ATTACHMENT_TOPIC, type PaymentKind as Kind } from './payment-notify.queue';

export {
  PAYMENT_ATTACHMENT_TOPIC,
  PAYMENT_NOTIFY_TOPIC,
  queuePaymentNotification,
} from './payment-notify.queue';

const PRODUCT: Record<Kind, string> = {
  subscription: 'ParkShield-Jahresabo (neu)',
  renewal: 'ParkShield-Jahresabo (Verlängerung)',
  print_order: 'Gedruckter Aufkleber mit Versand',
};

const euro = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

/** `{Kundennummer}_{Vertragsnummer}_Brief.pdf` */
export const letterFileName = (customerNo: string, contractNo: string) =>
  `${customerNo}_${contractNo}_Brief.pdf`.replace(/[^\w.-]/g, '_');

/**
 * Internal payment notifications (2026-11-22): every new subscription and every completed payment
 * (19,99 € / year, renewals, the 3 € print order) mails the payment mailbox, once per Stripe event, from
 * the webhook after it was processed. The customer's postal letter is attached („als Anlage“), made by
 * the one letter generator from the same frozen snapshot as the admin download (the customer's
 * current welcome letter), so the attachment and the admin PDF are identical.
 *
 * Safeguards (the PDF holds name and postal address): the only recipient is PAYMENT_NOTIFY_EMAIL
 * (default payment@park-shield.de); the mailbox must be EU-hosted with a deletion rule
 * (LEGAL_REVIEW.md §11). When the letter cannot be attached (not created yet, or rendering failed),
 * the mail still goes out with the admin link and „Anhang fehlgeschlagen“, and the attachment is
 * retried through the outbox (with backoff) and sent as a second mail.
 */
@Injectable()
export class PaymentNotifyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(WelcomeLettersService) private readonly letters: WelcomeLettersService,
  ) {}

  /** The one recipient. Anything else is refused, whatever a caller passes. */
  recipient(): string {
    return this.env.PAYMENT_NOTIFY_EMAIL;
  }

  private async load(id: string) {
    return this.db
      .selectFrom('payment_notifications as n')
      .innerJoin('users as u', 'u.id', 'n.user_id')
      .leftJoin('subscriptions as s', 's.id', 'n.subscription_id')
      .select([
        'n.id',
        'n.kind',
        'n.user_id',
        'n.amount_cents',
        'n.payment_ref',
        'n.paid_at',
        'n.sent_at',
        'n.attachment_sent_at',
        'n.attachment_failed',
        'u.customer_no',
        's.contract_no',
        's.provider',
      ])
      .where('n.id', '=', id)
      .executeTakeFirst();
  }

  /** The contract number: the subscription's, else the customer's latest contract. */
  private async contractNo(userId: string, own: string | null): Promise<string> {
    if (own) return own;
    const s = await this.db
      .selectFrom('subscriptions')
      .select('contract_no')
      .where('user_id', '=', userId)
      .where('contract_no', 'is not', null)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return s?.contract_no ?? '–';
  }

  /**
   * The letter PDF exactly as the admin download produces it (same generator, same snapshot, no
   * „downloaded“ mark). Null when the customer has no letter yet.
   */
  async letterPdf(userId: string): Promise<Buffer | null> {
    const letterId = await this.letters.latestId(userId);
    if (!letterId) return null;
    return (await this.letters.pdf(letterId, { download: false })).file;
  }

  private wantsLetter(kind: string) {
    return kind === 'subscription' || kind === 'print_order';
  }

  /** Outbox handler: the notification mail, with the letter when it can be attached. */
  async send(id: string): Promise<void> {
    const n = await this.load(id);
    if (!n || n.sent_at) return; // at-least-once delivery: never twice
    const customerNo = n.customer_no ?? '–';
    const contractNo = await this.contractNo(n.user_id, n.contract_no);
    const file = letterFileName(customerNo, contractNo);
    let pdf: Buffer | null = null;
    // 'failed': rendering threw; 'pending': no letter yet (it is created with the first vehicle).
    let state: 'attached' | 'failed' | 'pending' | 'none' = 'none';
    if (this.wantsLetter(n.kind)) {
      try {
        pdf = await this.letterPdf(n.user_id);
        state = pdf ? 'attached' : 'pending';
      } catch (err) {
        this.logger.error({ notificationId: n.id, err: String(err) }, 'payment letter failed');
        state = 'failed';
      }
    }
    const failed = state === 'failed' || state === 'pending';
    await this.mail.send({
      to: this.recipient(),
      template: 'payment_notification',
      locale: 'de',
      values: {
        product: PRODUCT[n.kind as Kind] ?? n.kind,
        amount: euro(n.amount_cents),
        paidAt: n.paid_at,
        customerNo,
        contractNo,
        paymentId: n.payment_ref ?? '–',
        // A6: store purchases show the provider and the store transaction id, no Stripe id.
        provider: n.provider ?? 'stripe',
        attachment: state,
        file,
      },
      actionUrl: this.adminUrl(n.user_id),
      attachments: pdf ? [{ filename: file, contentType: 'application/pdf', content: pdf }] : [],
    });
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('payment_notifications')
        .set({
          sent_at: sql`now()`,
          attachment_failed: failed,
          ...(pdf ? { attachment_sent_at: sql`now()` } : {}),
        })
        .where('id', '=', n.id)
        .execute();
      if (failed) {
        await trx
          .insertInto('outbox_events')
          .values({
            topic: PAYMENT_ATTACHMENT_TOPIC,
            payload: JSON.stringify({ id: n.id }),
            // The letter usually appears once the first vehicle exists: give it a few minutes.
            available_at: sql`now() + interval '5 minutes'`,
          })
          .execute();
      }
    });
  }

  /**
   * A welcome letter was just created: mail it for every payment of this customer that still waits
   * for its attachment (the retry's backoff may have run out while the first vehicle was missing).
   */
  async letterCreated(userId: string): Promise<void> {
    const waiting = await this.db
      .selectFrom('payment_notifications')
      .select('id')
      .where('user_id', '=', userId)
      .where('attachment_failed', '=', true)
      .where('attachment_sent_at', 'is', null)
      .where('sent_at', 'is not', null)
      .execute();
    for (const w of waiting) {
      await this.db
        .insertInto('outbox_events')
        .values({ topic: PAYMENT_ATTACHMENT_TOPIC, payload: JSON.stringify({ id: w.id }) })
        .execute();
    }
  }

  /**
   * Outbox handler for the retry: throws while the letter is not there, so the outbox tries again
   * with backoff (up to its attempt limit); then mails the letter as „Anhang nachgereicht“.
   */
  async sendAttachment(id: string): Promise<void> {
    const n = await this.load(id);
    if (!n || n.attachment_sent_at) return;
    const pdf = await this.letterPdf(n.user_id);
    if (!pdf) throw new RetryLaterError('letter not available yet');
    const customerNo = n.customer_no ?? '–';
    const contractNo = await this.contractNo(n.user_id, n.contract_no);
    const file = letterFileName(customerNo, contractNo);
    await this.mail.send({
      to: this.recipient(),
      template: 'payment_attachment',
      locale: 'de',
      values: {
        product: PRODUCT[n.kind as Kind] ?? n.kind,
        paidAt: n.paid_at,
        customerNo,
        contractNo,
        file,
      },
      actionUrl: this.adminUrl(n.user_id),
      attachments: [{ filename: file, contentType: 'application/pdf', content: pdf }],
    });
    await this.db
      .updateTable('payment_notifications')
      .set({ attachment_sent_at: sql`now()` })
      .where('id', '=', n.id)
      .execute();
  }

  private adminUrl(userId: string) {
    return `${this.env.OPS_BASE_URL.replace(/\/+$/, '')}/kunden/${userId}`;
  }
}
