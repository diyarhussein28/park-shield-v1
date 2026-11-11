import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB, ENV, LOGGER } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { PreferencesService } from './preferences.service';

const BATCH = 200;
const LIVE_SUBSCRIPTION = sql<boolean>`EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id
  AND s.status IN ('active', 'past_due'))`;

/**
 * Service messages that keep protection working (OW-15, OW-18): activation reminders after delivery,
 * "decal health" after long silence, and the periodic summary. Each job is idempotent (conditional
 * updates), so overlapping or repeated runs never send twice.
 */
@Injectable()
export class RemindersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PreferencesService) private readonly preferences: PreferencesService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async runAll(): Promise<number> {
    return (await this.activation()) + (await this.decalHealth()) + (await this.summaries());
  }

  /** US-29: 3, 7 and 14 days after delivery while the decal has not been tested (at most 3). */
  async activation(): Promise<number> {
    const raw = await this.settings.get<unknown>('reminders.activation_days', [3, 7, 14]);
    const days = (Array.isArray(raw) ? raw.map(Number) : [3, 7, 14])
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    const due = await sql<{
      id: string;
      email: string;
      preferred_lang: 'de' | 'en';
      activation_reminders: number;
      delivered_at: Date;
      nickname: string;
      vehicle_id: string;
    }>`
      SELECT DISTINCT ON (u.id) u.id, u.email, u.preferred_lang, u.activation_reminders,
             o.delivered_at, v.nickname, v.id AS vehicle_id
        FROM users u
        JOIN vehicles v ON v.owner_user_id = u.id
        JOIN qr_tokens t ON t.vehicle_id = v.id
        JOIN decal_order_items i ON i.qr_token_id = t.id
        JOIN decal_orders o ON o.id = i.order_id
       WHERE o.delivered_at IS NOT NULL AND t.last_test_at IS NULL AND t.status <> 'revoked'
         AND u.activation_reminders < ${days.length} AND ${LIVE_SUBSCRIPTION}
       ORDER BY u.id, o.delivered_at
       LIMIT ${BATCH}`.execute(this.db);

    let sent = 0;
    for (const u of due.rows) {
      const passed = days.filter(
        (d) => u.delivered_at.getTime() + d * 86_400_000 <= Date.now(),
      ).length;
      if (passed <= u.activation_reminders) continue;
      // Overdue steps are not sent one after another: one reminder, counter set to the steps passed.
      const claimed = await this.db
        .updateTable('users')
        .set({ activation_reminders: passed })
        .where('id', '=', u.id)
        .where('activation_reminders', '=', u.activation_reminders)
        .executeTakeFirst();
      if (!Number(claimed.numUpdatedRows)) continue;
      await this.mail.send({
        to: u.email,
        template: 'activation_reminder',
        locale: u.preferred_lang,
        values: { nickname: u.nickname, step: passed, steps: days.length },
        actionUrl: `${this.env.WEB_BASE_URL}/konto/fahrzeuge/${u.vehicle_id}`,
      });
      sent++;
    }
    return sent;
  }

  /** US-29: no scan or test for 11 months (configurable): suggest a test scan; once per silence. */
  async decalHealth(): Promise<number> {
    const months = Number(await this.settings.get('reminders.decal_health_months', 11));
    const due = await sql<{
      token_id: string;
      email: string;
      preferred_lang: 'de' | 'en';
      nickname: string;
      vehicle_id: string;
    }>`
      SELECT t.id AS token_id, u.email, u.preferred_lang, v.nickname, v.id AS vehicle_id
        FROM qr_tokens t
        JOIN vehicles v ON v.id = t.vehicle_id
        JOIN users u ON u.id = v.owner_user_id
       WHERE t.status = 'active'
         AND greatest(t.last_scanned_at, t.last_test_at, t.activated_at) < now() - make_interval(months => ${months})
         AND (t.health_reminded_at IS NULL
              OR t.health_reminded_at < greatest(t.last_scanned_at, t.last_test_at, t.activated_at))
         AND ${LIVE_SUBSCRIPTION}
       LIMIT ${BATCH}`.execute(this.db);

    let sent = 0;
    for (const r of due.rows) {
      const claimed = await this.db
        .updateTable('qr_tokens')
        .set({ health_reminded_at: sql`now()` })
        .where('id', '=', r.token_id)
        .where((eb) =>
          eb.or([
            eb('health_reminded_at', 'is', null),
            eb(
              'health_reminded_at',
              '<',
              sql<Date>`greatest(last_scanned_at, last_test_at, activated_at)`,
            ),
          ]),
        )
        .executeTakeFirst();
      if (!Number(claimed.numUpdatedRows)) continue;
      await this.mail.send({
        to: r.email,
        template: 'decal_health',
        locale: r.preferred_lang,
        values: { nickname: r.nickname, months },
        actionUrl: `${this.env.WEB_BASE_URL}/konto/fahrzeuge/${r.vehicle_id}`,
      });
      sent++;
    }
    return sent;
  }

  /** US-30: weekly or monthly (default) summary; a service message, never marketing. */
  async summaries(): Promise<number> {
    const due = await sql<{
      id: string;
      email: string;
      preferred_lang: 'de' | 'en';
      since: Date;
    }>`
      SELECT u.id, u.email, u.preferred_lang, coalesce(u.last_summary_at, u.created_at) AS since
        FROM users u
       WHERE u.summary_frequency <> 'off' AND u.status = 'active' AND ${LIVE_SUBSCRIPTION}
         AND coalesce(u.last_summary_at, u.created_at) <= now() - CASE u.summary_frequency
               WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END
       LIMIT ${BATCH}`.execute(this.db);

    let sent = 0;
    for (const u of due.rows) {
      // Claim by re-checking "due" (not by comparing timestamps: PostgreSQL keeps microseconds).
      const claimed = await this.db
        .updateTable('users')
        .set({ last_summary_at: sql`now()` })
        .where('id', '=', u.id)
        .where(
          sql<boolean>`coalesce(last_summary_at, created_at) <= now() - CASE summary_frequency
            WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END`,
        )
        .executeTakeFirst();
      if (!Number(claimed.numUpdatedRows)) continue;
      const stats = await sql<{ alerts: number; vehicles: number; active: number }>`
        SELECT
          (SELECT count(*)::int FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id
            WHERE v.owner_user_id = ${u.id} AND a.created_at >= ${u.since}
              AND NOT a.is_test AND a.status <> 'blocked') AS alerts,
          (SELECT count(*)::int FROM vehicles v WHERE v.owner_user_id = ${u.id}) AS vehicles,
          (SELECT count(*)::int FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
            WHERE v.owner_user_id = ${u.id} AND t.status = 'active') AS active`.execute(this.db);
      const s = stats.rows[0] ?? { alerts: 0, vehicles: 0, active: 0 };
      const protection = await this.preferences.protection(u.id);
      try {
        await this.mail.send({
          to: u.email,
          template: 'summary',
          locale: u.preferred_lang,
          values: {
            since: u.since,
            alerts: s.alerts,
            vehicles: s.vehicles,
            active: s.active,
            score: protection.percent,
          },
          actionUrl: `${this.env.WEB_BASE_URL}/konto`,
        });
        sent++;
      } catch (err) {
        this.logger.warn({ err: String(err) }, 'summary mail failed; retried next period');
      }
    }
    return sent;
  }
}
