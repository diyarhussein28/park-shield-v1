import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { EntitlementService } from '../billing/entitlements.service';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB, LOGGER } from '../core/tokens';

/** Metered channels (NT-05): the escalation SMS, with a monthly safety cap (`sms.monthly_cap`). */
export type MeteredChannel = 'sms';
const CHANNEL_NAME: Record<MeteredChannel, string> = { sms: 'SMS' };

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
 * Monthly safety cap for the escalation SMS (NT-05, US-27, setting `sms.monthly_cap`, default 20). The
 * counter is reserved atomically before sending, so concurrent alerts cannot overshoot; a failed send
 * gives the unit back. Reaching the cap is logged and shown in the app (no e-mail); above it the SMS is
 * skipped and recorded as suppressed (`fair_use`).
 */
@Injectable()
export class FairUseService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  private async limitFor(userId: string, channel: MeteredChannel): Promise<number> {
    const ent = await this.entitlements.current(userId);
    return ent ? Number(ent.limits[`${channel}_per_month`] ?? 0) : 0;
  }

  async usage(userId: string) {
    const [sms] = await Promise.all(
      (['sms'] as const).map(async (channel) => {
        const limit = await this.limitFor(userId, channel);
        const row = await this.db
          .selectFrom('usage_counters')
          .select('value')
          .where('subject_id', '=', userId)
          .where('period', '=', sql<Date>`${usagePeriod()}::date`)
          .where('metric', '=', channel)
          .executeTakeFirst();
        const used = row?.value ?? 0;
        return { used, limit, capReached: limit > 0 && used >= limit };
      }),
    );
    return { sms: sms! };
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
      await this.notifyOnce(owner, channel, 'fair_use_reached', period, { used: limit, limit });
      return false;
    }
    const warnPercent = Number(await this.settings.get('fair_use.warn_percent', 80));
    if (used >= Math.ceil((limit * warnPercent) / 100) && used < limit) {
      await this.notifyOnce(owner, channel, 'fair_use_warning', period, { used, limit });
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
    channel: MeteredChannel,
    template: 'fair_use_warning' | 'fair_use_reached',
    period: string,
    values: { used: number; limit: number },
  ) {
    // The marker row makes the mail once-per-month per channel, even with concurrent alerts.
    const marker = `${template}:${channel}`;
    const marked = await sql`
      INSERT INTO usage_counters (subject_id, period, metric, value)
      VALUES (${owner.id}, ${period}::date, ${marker}, 1)
      ON CONFLICT DO NOTHING RETURNING value`.execute(this.db);
    if (!marked.rows.length) return;
    // 2026-11-21: no e-mail about alerts. The app shows the state (GET /v1/app/sms-usage); the log
    // keeps counts only, no owner id.
    this.logger.info(
      { tag: template, channel: CHANNEL_NAME[channel], used: values.used, limit: values.limit },
      'monthly SMS cap',
    );
  }
}
