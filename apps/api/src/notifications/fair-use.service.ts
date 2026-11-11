import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { EntitlementService } from '../billing/entitlements.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB, ENV, LOGGER } from '../core/tokens';
import { MailService } from '../mail/mail.service';

export type MeteredChannel = 'whatsapp';

/** Current month as YYYY-MM-01 in German time (counters reset at local midnight on the 1st). */
export function usagePeriod(now = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
  })
    .format(now)
    .split('-');
  return `${y}-${m}-01`;
}

/**
 * Monthly fair-use limits per paid channel (NT-05, US-27). Limits come from the plan, overridable in
 * app_settings (`limits.<plan>.whatsapp_per_month`). The counter is reserved atomically before sending,
 * so concurrent alerts cannot overshoot; a failed send gives the unit back. At the warning threshold
 * and at the limit, the owner gets one e-mail per month; above the limit the channel is skipped and
 * the alert falls through to Push and e-mail.
 */
@Injectable()
export class FairUseService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  private async limitFor(userId: string, channel: MeteredChannel): Promise<number> {
    const ent = await this.entitlements.current(userId);
    return ent ? Number(ent.limits[`${channel}_per_month`] ?? 0) : 0;
  }

  async usage(userId: string) {
    const limit = await this.limitFor(userId, 'whatsapp');
    const row = await this.db
      .selectFrom('usage_counters')
      .select('value')
      .where('subject_id', '=', userId)
      .where('period', '=', sql<Date>`${usagePeriod()}::date`)
      .where('metric', '=', 'whatsapp')
      .executeTakeFirst();
    return { whatsapp: { used: row?.value ?? 0, limit } };
  }

  /** true = within the limit and counted; false = limit reached (the caller suppresses the channel). */
  async reserve(
    owner: { id: string; email: string; lang: 'de' | 'en' },
    channel: MeteredChannel,
  ): Promise<boolean> {
    const limit = await this.limitFor(owner.id, channel);
    const period = usagePeriod();
    if (limit <= 0) return false;
    const row = await sql<{ value: number }>`
      INSERT INTO usage_counters (subject_id, period, metric, value)
      VALUES (${owner.id}, ${period}::date, ${channel}, 1)
      ON CONFLICT (subject_id, period, metric)
      DO UPDATE SET value = usage_counters.value + 1 WHERE usage_counters.value < ${limit}
      RETURNING value`.execute(this.db);
    const used = row.rows[0]?.value;
    if (used === undefined) {
      await this.notifyOnce(owner, 'fair_use_reached', period, { used: limit, limit });
      return false;
    }
    const warnPercent = Number(await this.settings.get('fair_use.warn_percent', 80));
    if (used >= Math.ceil((limit * warnPercent) / 100) && used < limit) {
      await this.notifyOnce(owner, 'fair_use_warning', period, { used, limit });
    }
    return true;
  }

  /** The send failed: give the unit back. */
  async release(ownerId: string, channel: MeteredChannel): Promise<void> {
    await this.db
      .updateTable('usage_counters')
      .set({ value: sql`greatest(value - 1, 0)` })
      .where('subject_id', '=', ownerId)
      .where('period', '=', sql<Date>`${usagePeriod()}::date`)
      .where('metric', '=', channel)
      .execute();
  }

  private async notifyOnce(
    owner: { id: string; email: string; lang: 'de' | 'en' },
    template: 'fair_use_warning' | 'fair_use_reached',
    period: string,
    values: { used: number; limit: number },
  ) {
    // The marker row makes the mail once-per-month, even with concurrent alerts.
    const marked = await sql`
      INSERT INTO usage_counters (subject_id, period, metric, value)
      VALUES (${owner.id}, ${period}::date, ${template}, 1)
      ON CONFLICT DO NOTHING RETURNING value`.execute(this.db);
    if (!marked.rows.length) return;
    await this.mail
      .send({
        to: owner.email,
        template,
        locale: owner.lang,
        values: { ...values, channel: 'WhatsApp' },
        actionUrl: `${this.env.WEB_BASE_URL}/konto/benachrichtigungen`,
      })
      .catch((err: unknown) => this.logger.warn({ err: String(err) }, 'fair-use mail failed'));
  }
}
