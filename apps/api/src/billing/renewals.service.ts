import { Inject, Injectable } from '@nestjs/common';
import { renewalRule } from '@parkshield/shared';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB, ENV, LOGGER } from '../core/tokens';
import { monthlyPriceCents, type RenewalMode } from '../legal/rules';
import { MailService } from '../mail/mail.service';
import { PAYMENTS, type PaidPlan, type Payments } from '../providers/ports';

const euro = (cents: number, locale: 'de' | 'en') =>
  new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);

/**
 * Before every annual renewal: a reminder with the date, the price and a direct link to the
 * cancellation page. For consumers in `monthly_after_first_term` the provider is told in time that the
 * contract continues monthly at the same price level after the first year (§ 309 Nr. 9 BGB).
 */
@Injectable()
export class RenewalsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PAYMENTS) private readonly payments: Payments,
  ) {}

  async runAll(): Promise<string> {
    const switched = await this.scheduleMonthly();
    const reminded = await this.remind();
    return `monthly ${switched}, reminders ${reminded}`;
  }

  /** Annual subscriptions whose period ends within the reminder window and were not reminded yet. */
  async remind(): Promise<number> {
    const days = await this.settings.get('renewal.reminder_days', 30);
    const due = await this.db
      .selectFrom('subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .innerJoin('plans as p', 'p.code', 's.plan')
      .select([
        's.id',
        's.contract_no',
        's.current_period_end',
        's.renewal_mode',
        's.customer_type',
        'p.price_year_gross_cents',
        'u.email',
        'u.preferred_lang',
      ])
      .where('s.status', 'in', ['active', 'past_due'])
      .where('s.cancel_at_period_end', '=', false)
      .where('s.interval', '=', 'year')
      .where('s.current_period_end', '>', sql<Date>`now()`)
      .where('s.current_period_end', '<=', sql<Date>`now() + make_interval(days => ${days})`)
      // Only real yearly periods: a period shorter than the reminder window is a store sandbox
      // (Apple/Google "1 year" = 1 hour, renewing all day), and each renewal would otherwise mail
      // the customer a new reminder every hour (seen on the test server 2026-11-23).
      .where((eb) =>
        eb.or([
          eb('s.current_period_start', 'is', null),
          eb(
            sql<string>`s.current_period_end - s.current_period_start`,
            '>',
            sql<string>`make_interval(days => ${days})`,
          ),
        ]),
      )
      .where((eb) =>
        eb.or([
          eb('s.renewal_reminded_for', 'is', null),
          eb('s.renewal_reminded_for', '<>', eb.ref('s.current_period_end')),
        ]),
      )
      .limit(200)
      .execute();
    let n = 0;
    for (const s of due) {
      // Claim first, so two workers never send the same reminder twice.
      const claimed = await this.db
        .updateTable('subscriptions')
        .set({ renewal_reminded_for: s.current_period_end })
        .where('id', '=', s.id)
        .where((eb) =>
          eb.or([
            eb('renewal_reminded_for', 'is', null),
            eb('renewal_reminded_for', '<>', s.current_period_end!),
          ]),
        )
        .executeTakeFirst();
      if (!Number(claimed.numUpdatedRows)) continue;
      const mode = s.renewal_mode as RenewalMode;
      const annual = s.price_year_gross_cents ?? 0;
      const monthly = mode === 'monthly_after_first_term' && s.customer_type === 'b2c';
      await this.mail.send({
        to: s.email,
        template: 'renewal_reminder',
        locale: s.preferred_lang,
        values: {
          renewsAt: s.current_period_end!,
          contractNo: s.contract_no ?? '',
          price: euro(monthly ? monthlyPriceCents(annual) : annual, s.preferred_lang),
          interval: monthly ? 'month' : 'year',
          renewalRule: renewalRule(s.preferred_lang, { renewalMode: mode }),
        },
        actionUrl: `${this.env.WEB_BASE_URL}/kuendigen`,
      });
      n++;
    }
    return n;
  }

  /** First-term consumer contracts in monthly mode: book the monthly phase at the provider once. */
  async scheduleMonthly(): Promise<number> {
    const due = await this.db
      .selectFrom('subscriptions')
      .select(['id', 'plan', 'stripe_subscription_id'])
      .where('status', 'in', ['active', 'past_due'])
      .where('customer_type', '=', 'b2c')
      .where('renewal_mode', '=', 'monthly_after_first_term')
      .where('interval', '=', 'year')
      .where('cancel_at_period_end', '=', false)
      .where('monthly_scheduled_at', 'is', null)
      .where('stripe_subscription_id', 'is not', null)
      .where('current_period_end', '<=', sql<Date>`now() + interval '45 days'`)
      .limit(100)
      .execute();
    let n = 0;
    for (const s of due) {
      try {
        await this.payments.scheduleMonthly(s.stripe_subscription_id!, s.plan as PaidPlan);
        await this.db
          .updateTable('subscriptions')
          .set({ monthly_scheduled_at: sql`now()` })
          .where('id', '=', s.id)
          .execute();
        n++;
      } catch (err) {
        // Retried on the next run; the reminder already told the customer about the monthly terms.
        this.logger.error({ subscriptionId: s.id, err: String(err) }, 'monthly switch failed');
      }
    }
    return n;
  }
}
