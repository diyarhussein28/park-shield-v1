import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { normalizeEmail, randomToken, sha256 } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { CRYPTO, DB, ENV, LOGGER } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { PAYMENTS, type Payments } from '../providers/ports';
import { plateKey } from '../vehicles/vehicles.service';
import { computeCancellationEnd, type RenewalMode } from './rules';

export type CancellationType = 'ordinary' | 'extraordinary';

export interface CancellationInput {
  channel: 'public_form' | 'portal';
  /** Signed-in owner (portal); the public form identifies by e-mail and contract or plate. */
  userId?: string;
  type: CancellationType;
  reason?: string;
  name?: string;
  email?: string;
  contractNo?: string;
  plate?: string;
  /** "zum nächstmöglichen Zeitpunkt" when empty. */
  requestedDate?: Date | null;
  confirmationEmail?: string;
  locale: 'de' | 'en';
  ipHash: Buffer | null;
}

export interface CancellationReceipt {
  receivedAt: Date;
  matched: boolean;
  contractNo?: string;
  endsAt?: Date;
}

const LIVE = ['active', 'past_due'] as const;

const dateText = (d: Date, locale: 'de' | 'en') =>
  new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'Europe/Berlin',
  }).format(d);
export const EXTRAORDINARY_TOPIC = 'support.extraordinary_cancellation';

/**
 * § 312k BGB cancellation, with the same steps in the portal and without login. The service is not
 * touched when a cancellation arrives: it stays fully active until the end date, and only the
 * provider's `customer.subscription.deleted` ends it. Abuse protection adds no barrier before the
 * cancellation: both the given and the account e-mail get the confirmation with a one-click
 * "Kündigung zurücknehmen" link, and requests are rate-limited by IP hash only.
 */
@Injectable()
export class CancellationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  private async match(input: CancellationInput): Promise<string | null> {
    if (input.userId) {
      const s = await this.db
        .selectFrom('subscriptions')
        .select('id')
        .where('user_id', '=', input.userId)
        .where('status', 'in', LIVE)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      return s?.id ?? null;
    }
    if (!input.email) return null;
    const email = normalizeEmail(input.email);
    let q = this.db
      .selectFrom('subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select('s.id')
      .where('u.email', '=', email)
      .where('s.status', 'in', LIVE);
    if (input.contractNo) {
      q = q.where('s.contract_no', '=', input.contractNo.trim().toUpperCase());
    } else if (input.plate) {
      // The plate is personal data: looked up only through its blind index, never in plain text.
      const bidx = this.crypto.blindIndex(input.plate, plateKey);
      q = q.where((eb) =>
        eb.exists(
          eb
            .selectFrom('vehicles as v')
            .select('v.id')
            .whereRef('v.owner_user_id', '=', 'u.id')
            .where('v.plate_bidx', '=', bidx),
        ),
      );
    } else {
      return null;
    }
    const rows = await q.limit(2).execute();
    return rows.length === 1 ? rows[0]!.id : null;
  }

  async submit(input: CancellationInput): Promise<CancellationReceipt> {
    if (input.channel === 'public_form') {
      await this.limits.enforce('cancel.ip', (input.ipHash ?? Buffer.from('none')).toString('hex'));
    }
    const receivedAt = new Date();
    const subscriptionId = await this.match(input);
    const confirmationTo = input.confirmationEmail ?? input.email;

    if (!subscriptionId) {
      // Never silently dropped: the receipt goes out and ops match it by hand.
      await this.db
        .insertInto('cancellation_requests')
        .values({
          type: input.type,
          reason: input.reason ?? null,
          submitted_name: input.name ?? null,
          submitted_email: input.email ? normalizeEmail(input.email) : null,
          submitted_contract_ref: input.contractNo ?? (input.plate ? 'plate' : null),
          requested_effective_date: input.requestedDate ?? null,
          received_at: receivedAt,
          channel: input.channel,
          status: 'needs_review',
          confirmation_sent_to: confirmationTo ? [normalizeEmail(confirmationTo)] : [],
          locale: input.locale,
          ip_hash: input.ipHash,
        })
        .execute();
      if (confirmationTo) {
        await this.mail.send({
          to: confirmationTo,
          template: 'cancel_needs_review',
          locale: input.locale,
          values: { receivedAt },
        });
      }
      return { receivedAt, matched: false };
    }
    return this.schedule(subscriptionId, input, receivedAt);
  }

  private async schedule(
    subscriptionId: string,
    input: CancellationInput,
    receivedAt: Date,
  ): Promise<CancellationReceipt> {
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
        's.interval',
        's.renewal_mode',
        'u.email',
        'u.preferred_lang',
      ])
      .where('s.id', '=', subscriptionId)
      .executeTakeFirstOrThrow();
    const periodStart = sub.current_period_start ?? sub.created_at;
    const periodEnd = sub.current_period_end ?? new Date(periodStart.getTime() + 365 * 86_400_000);
    const endsAt = computeCancellationEnd(
      {
        startedAt: sub.created_at,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        interval: sub.interval,
      },
      receivedAt,
      sub.renewal_mode as RenewalMode,
      input.requestedDate,
    );
    if (sub.stripe_subscription_id) {
      const atPeriodEnd = endsAt.getTime() === periodEnd.getTime();
      await this.payments.cancelAt(sub.stripe_subscription_id, atPeriodEnd ? null : endsAt);
    }
    const token = randomToken();
    const recipients = [
      ...new Set(
        [input.confirmationEmail, input.email, sub.email]
          .filter((x): x is string => Boolean(x))
          .map(normalizeEmail),
      ),
    ];
    await this.db.transaction().execute(async (trx) => {
      // The service stays fully active until endsAt; only the provider's deletion ends it.
      await trx
        .updateTable('subscriptions')
        .set({ cancel_at_period_end: true, canceled_at: sql`coalesce(canceled_at, now())` })
        .where('id', '=', sub.id)
        .execute();
      await trx
        .insertInto('cancellation_requests')
        .values({
          subscription_id: sub.id,
          type: input.type,
          reason: input.reason ?? null,
          submitted_name: input.name ?? null,
          submitted_email: input.email ? normalizeEmail(input.email) : null,
          submitted_contract_ref: input.contractNo ?? (input.plate ? 'plate' : null),
          requested_effective_date: input.requestedDate ?? null,
          computed_end_date: endsAt,
          received_at: receivedAt,
          channel: input.channel,
          status: input.type === 'extraordinary' ? 'needs_review' : 'scheduled',
          confirmation_sent_to: recipients,
          revoke_token_hash: sha256(token),
          locale: input.locale,
          ip_hash: input.ipHash,
        })
        .execute();
      if (input.type === 'extraordinary') {
        // The ordinary end is booked as a floor; support decides on an earlier end.
        await trx
          .insertInto('outbox_events')
          .values({
            topic: EXTRAORDINARY_TOPIC,
            payload: JSON.stringify({ subscriptionId: sub.id, reason: input.reason ?? '' }),
          })
          .execute();
      }
    });
    const locale = input.channel === 'portal' ? sub.preferred_lang : input.locale;
    for (const to of recipients) {
      await this.mail.send({
        to,
        template: 'cancel_received',
        locale,
        values: {
          receivedAt,
          contractNo: sub.contract_no ?? '',
          endsAt,
          kind: input.type,
          requestedLine: input.requestedDate
            ? `${locale === 'de' ? 'Gewünschter Zeitpunkt' : 'Requested date'}: ${dateText(input.requestedDate, locale)}`
            : '',
          reasonLine: input.reason
            ? `${locale === 'de' ? 'Ihre Begründung' : 'Your reason'}: ${input.reason}`
            : '',
        },
        actionUrl: `${this.env.WEB_BASE_URL}/kuendigen/zuruecknehmen?token=${encodeURIComponent(token)}`,
      });
    }
    return { receivedAt, matched: true, contractNo: sub.contract_no ?? undefined, endsAt };
  }

  /** One-click "Kündigung zurücknehmen" from the confirmation e-mail, valid until the end date. */
  async revoke(token: string): Promise<{ contractNo: string | null }> {
    const req = await this.db
      .selectFrom('cancellation_requests as c')
      .innerJoin('subscriptions as s', 's.id', 'c.subscription_id')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select([
        'c.id',
        'c.status',
        'c.computed_end_date',
        's.id as subscriptionId',
        's.stripe_subscription_id',
        's.contract_no',
        's.status as subStatus',
        'u.email',
        'u.preferred_lang',
      ])
      .where('c.revoke_token_hash', '=', sha256(token))
      .executeTakeFirst();
    if (
      !req ||
      (req.status !== 'scheduled' && req.status !== 'needs_review') ||
      !req.computed_end_date ||
      req.computed_end_date <= new Date() ||
      (req.subStatus !== 'active' && req.subStatus !== 'past_due')
    ) {
      throw new NotFoundException({ error: 'revoke_link_invalid' });
    }
    if (req.stripe_subscription_id) await this.payments.resume(req.stripe_subscription_id);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('cancellation_requests')
        .set({ status: 'revoked_by_customer', revoke_token_hash: null })
        .where('id', '=', req.id)
        .execute();
      await trx
        .updateTable('subscriptions')
        .set({ cancel_at_period_end: false, canceled_at: null })
        .where('id', '=', req.subscriptionId)
        .execute();
    });
    await this.mail.send({
      to: req.email,
      template: 'cancel_revoked',
      locale: req.preferred_lang,
      values: { contractNo: req.contract_no ?? '' },
      actionUrl: `${this.env.WEB_BASE_URL}/app`,
    });
    this.logger.info({ subscriptionId: req.subscriptionId }, 'cancellation revoked by customer');
    return { contractNo: req.contract_no };
  }
}
