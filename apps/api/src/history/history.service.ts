import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB } from '../core/tokens';
import { FairUseService } from '../notifications/fair-use.service';
import { PreferencesService } from '../preferences/preferences.service';

export const REPORT_REASONS = ['harassment', 'spam', 'false_alarm', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
const BLOCK_DAYS = 30;
const MUTE_REASONS = ['quiet_hours', 'sensitive_spot'];

/**
 * The owner's alert history (OW-08, US-31), abuse reports, and the "I didn't get the alert" page
 * (SP-05). Alerts are deleted after 90 days and custom texts after 7 by run_retention(), so the
 * history never shows more than the retention schedule allows.
 */
@Injectable()
export class HistoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PreferencesService) private readonly preferences: PreferencesService,
    @Inject(FairUseService) private readonly fairUse: FairUseService,
  ) {}

  async list(userId: string) {
    const alerts = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .select([
        'a.id',
        'a.alert_type',
        'a.severity',
        'a.status',
        'a.is_test',
        'a.custom_message_enc',
        'a.owner_reply',
        'a.acknowledged_at',
        'a.escalated_at',
        'a.expires_at',
        'a.created_at',
        'a.block_ref',
        'v.id as vehicleId',
        'v.nickname',
        't.label_de',
        't.label_en',
      ])
      .where('v.owner_user_id', '=', userId)
      // Filtered texts and silently dropped alerts from blocked scanners never reached the owner.
      .where('a.status', '<>', 'blocked')
      .where('a.created_at', '>', sql<Date>`now() - interval '90 days'`)
      .orderBy('a.created_at', 'desc')
      .limit(200)
      .execute();
    if (!alerts.length) return { alerts: [] };

    const ids = alerts.map((a) => a.id);
    const [deliveries, reports] = await Promise.all([
      this.db
        .selectFrom('alert_deliveries')
        .select(['alert_id', 'channel', 'status', 'suppressed_reason', 'error_code', 'queued_at'])
        .where('alert_id', 'in', ids)
        .where('recipient', '=', 'owner')
        .orderBy('queued_at')
        .execute(),
      this.db
        .selectFrom('abuse_reports')
        .select('alert_id')
        .where('alert_id', 'in', ids)
        .where('reported_by', '=', userId)
        .execute(),
    ]);
    const reported = new Set(reports.map((r) => r.alert_id));
    const monthAgo = Date.now() - BLOCK_DAYS * 86_400_000;

    return {
      alerts: alerts.map((a) => {
        const own = deliveries.filter((d) => d.alert_id === a.id);
        const muted = own.find(
          (d) => d.suppressed_reason && MUTE_REASONS.includes(d.suppressed_reason),
        );
        const open = ['created', 'dispatched', 'delivered'].includes(a.status);
        return {
          id: a.id,
          vehicle: { id: a.vehicleId, nickname: a.nickname },
          type: { code: a.alert_type, de: a.label_de, en: a.label_en },
          severity: a.severity,
          isTest: a.is_test,
          status: open && a.expires_at < new Date() ? 'expired' : a.status,
          ownerReply: a.owner_reply,
          acknowledgedAt: a.acknowledged_at,
          escalatedAt: a.escalated_at,
          createdAt: a.created_at,
          // Free text is kept 7 days only (SC-04); after that the history shows the type alone.
          message: a.custom_message_enc ? this.crypto.decrypt(a.custom_message_enc) : null,
          muted: muted?.suppressed_reason ?? null,
          deliveries: own.map((d) => ({
            channel: d.channel,
            status: d.status,
            reason: d.suppressed_reason ?? d.error_code,
          })),
          reported: reported.has(a.id),
          // OW-08: a report on an alert older than 30 days goes to the abuse centre only.
          canBlock: !a.is_test && a.block_ref !== null && a.created_at.getTime() > monthAgo,
        };
      }),
    };
  }

  /** OW-08: blocks this scanner for this vehicle for 30 days and sends the report to the abuse centre. */
  async report(userId: string, alertId: string, reason: ReportReason, note: string | undefined) {
    const a = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .select(['a.id', 'a.is_test', 'a.block_ref', 'a.qr_token_id', 'a.created_at'])
      .where('a.id', '=', alertId)
      .where('v.owner_user_id', '=', userId)
      .where('a.status', '<>', 'blocked')
      .executeTakeFirst();
    if (!a || a.is_test) throw new NotFoundException();
    const blocked = await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('abuse_reports')
        .select('id')
        .where('alert_id', '=', a.id)
        .where('reported_by', '=', userId)
        .executeTakeFirst();
      if (existing) throw new ConflictException({ error: 'already_reported' });
      await trx
        .insertInto('abuse_reports')
        .values({
          kind: 'owner_report',
          alert_id: a.id,
          reported_by: userId,
          qr_token_id: a.qr_token_id,
          reason,
          note: note?.trim().slice(0, 500) || null,
        })
        .execute();
      const recent = a.created_at.getTime() > Date.now() - BLOCK_DAYS * 86_400_000;
      if (!a.block_ref || !recent) return false;
      // The block_ref is per vehicle: it cannot block this person anywhere else (02-architecture §5).
      await trx
        .insertInto('scanner_blocks')
        .values({
          ref: a.block_ref,
          qr_token_id: a.qr_token_id,
          reason: 'owner_report',
          expires_at: sql`now() + make_interval(days => ${BLOCK_DAYS})`,
        })
        .execute();
      return true;
    });
    return { reported: true, blocked };
  }

  /** SP-05: the latest attempts with reasons, plus what is set up right now. */
  async deliveries(userId: string) {
    const [attempts, devices, whatsapp, rules, protection, usage] = await Promise.all([
      this.db
        .selectFrom('alert_deliveries as d')
        .innerJoin('alerts as a', 'a.id', 'd.alert_id')
        .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
        .innerJoin('alert_types as t', 't.code', 'a.alert_type')
        .select([
          'd.channel',
          'd.status',
          'd.suppressed_reason',
          'd.error_code',
          'd.queued_at',
          'a.id as alertId',
          'a.is_test',
          'v.nickname',
          't.label_de',
          't.label_en',
        ])
        .where('v.owner_user_id', '=', userId)
        .where('d.recipient', '=', 'owner')
        .orderBy('d.queued_at', 'desc')
        .limit(20)
        .execute(),
      this.db
        .selectFrom('push_subscriptions')
        .select(['platform', 'last_ok_at', 'failed_count'])
        .where('user_id', '=', userId)
        .execute(),
      this.db
        .selectFrom('contact_channels')
        .select('id')
        .where('user_id', '=', userId)
        .where('type', '=', 'whatsapp')
        .where('verified_at', 'is not', null)
        .executeTakeFirst(),
      this.db.selectFrom('notification_rules').select('id').where('user_id', '=', userId).execute(),
      this.preferences.protection(userId),
      this.fairUse.usage(userId),
    ]);
    const switchedOff: string[] = [];
    for (const c of ['webpush', 'email', 'whatsapp']) {
      const v = await this.settings.get<unknown>(`channels.${c}.enabled`, true);
      if (!(v === true || v === 'true')) switchedOff.push(c);
    }
    return {
      attempts: attempts.map((d) => ({
        alertId: d.alertId,
        at: d.queued_at,
        nickname: d.nickname,
        type: { de: d.label_de, en: d.label_en },
        isTest: d.is_test,
        channel: d.channel,
        status: d.status,
        reason: d.suppressed_reason ?? d.error_code,
      })),
      setup: {
        pushDevices: devices.length,
        pushFailing: devices.filter((d) => d.failed_count > 0).length,
        whatsapp: Boolean(whatsapp),
        quietHours: rules.length,
        decalTested: protection.steps.decal,
        switchedOff,
        whatsappUsage: usage.whatsapp,
      },
    };
  }
}
