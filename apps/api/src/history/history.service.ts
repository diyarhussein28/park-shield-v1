import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB } from '../core/tokens';
import { FairUseService } from '../notifications/fair-use.service';
import { PreferencesService } from '../preferences/preferences.service';
import { PhoneBansService } from '../abuse/phone-bans.service';
import { ProtectionService } from '../abuse/protection.service';
import { ViewTokenService } from '../alert-media/view-token.service';
import { ChatService } from '../chat/chat.service';
import { stopEscalation } from '../notifications/escalation';

export const REPORT_REASONS = ['harassment', 'spam', 'false_alarm', 'other', 'blocked'] as const;
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
    @Inject(ProtectionService) private readonly protection: ProtectionService,
    @Inject(PhoneBansService) private readonly phoneBans: PhoneBansService,
    @Inject(ViewTokenService) private readonly viewTokens: ViewTokenService,
    @Inject(ChatService) private readonly chat: ChatService,
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
        'a.content_hidden',
        sql<boolean>`a.verified_phone_hash IS NOT NULL`.as('verified'),
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
    const [deliveries, reports, media, links] = await Promise.all([
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
      // Phase 2: photos that still exist, and whether the alert's view link is still valid.
      this.db
        .selectFrom('alert_media')
        .select(['alert_id', (eb) => eb.fn.countAll<string>().as('n')])
        .where('alert_id', 'in', ids)
        .where('deleted_at', 'is', null)
        .groupBy('alert_id')
        .execute(),
      this.db
        .selectFrom('alert_view_tokens')
        .select('alert_id')
        .where('alert_id', 'in', ids)
        .where('expires_at', '>', sql<Date>`now()`)
        .execute(),
    ]);
    const photoCount = new Map(media.map((m) => [m.alert_id, Number(m.n)]));
    const linked = new Set(links.map((l) => l.alert_id));
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
          // Protected Mode: text of an unconfirmed sender only through hiddenContent ("Anzeigen").
          message:
            a.custom_message_enc && !a.content_hidden
              ? this.crypto.decrypt(a.custom_message_enc)
              : null,
          hiddenContent: a.content_hidden && a.custom_message_enc !== null,
          verifiedSender: a.verified,
          muted: muted?.suppressed_reason ?? null,
          deliveries: own.map((d) => ({
            channel: d.channel,
            status: d.status,
            reason: d.suppressed_reason ?? d.error_code,
          })),
          reported: reported.has(a.id),
          photos: {
            count: photoCount.get(a.id) ?? 0,
            viewPath: linked.has(a.id) ? `/v/${this.viewTokens.tokenFor(a.id)}` : null,
          },
          // OW-08: a report on an alert older than 30 days goes to the abuse centre only, unless the
          // sender had confirmed a number (12-month phone ban, abuse protection §5).
          canBlock:
            !a.is_test &&
            ((a.block_ref !== null && a.created_at.getTime() > monthAgo) || a.verified),
        };
      }),
    };
  }

  /**
   * "Absender blockieren" (OW-08, abuse protection §3): blocks this scanner for this vehicle for 30
   * days, bans a confirmed number for this vehicle for 12 months, sends the report to the abuse centre
   * and counts towards automatic Protected Mode. The owner never sees any scanner identifier.
   */
  async report(userId: string, alertId: string, reason: ReportReason, note: string | undefined) {
    const a = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .select([
        'a.id',
        'a.is_test',
        'a.block_ref',
        'a.qr_token_id',
        'a.created_at',
        'a.vehicle_id',
        'a.verified_phone_hash',
      ])
      .where('a.id', '=', alertId)
      .where('v.owner_user_id', '=', userId)
      .where('a.status', '<>', 'blocked')
      .executeTakeFirst();
    if (!a || a.is_test) throw new NotFoundException();
    return this.db.transaction().execute(async (trx) => {
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
      let blocked = false;
      if (a.block_ref && recent) {
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
        blocked = true;
      }
      const phoneBanned = Boolean(a.verified_phone_hash);
      if (a.verified_phone_hash) {
        await this.phoneBans.banForVehicle(trx, a.verified_phone_hash, a.vehicle_id);
      }
      const protectedMode = await this.protection.afterReport(trx, a.vehicle_id);
      return { reported: true, blocked: blocked || phoneBanned, phoneBanned, protectedMode };
    });
  }

  /**
   * „Absender blockieren“ on the alert card, the alert detail, the live chat and the history (Stage 3,
   * owner decision 2026-11-21). In this order: the live chat ends at once (the scanner sees „Der Chat
   * wurde beendet.“), the pending reminder push and escalation SMS are cancelled, and the sender is
   * blocked with the existing abuse module and its settings (`report`: per-vehicle scanner block by the
   * server-side reference, phone ban for confirmed senders, Protected Mode counting). No device
   * fingerprint, cookie or client-side storage is involved (§ 25 TDDDG). Idempotent: blocking twice
   * changes nothing more.
   */
  async block(userId: string, alertId: string) {
    const a = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .select(['a.id', 'a.is_test'])
      .where('a.id', '=', alertId)
      .where('v.owner_user_id', '=', userId)
      .where('a.status', '<>', 'blocked')
      .executeTakeFirst();
    if (!a) throw new NotFoundException();
    const chatClosed = await this.chat.closeBlocked(a.id);
    await this.db
      .updateTable('alerts')
      .set(stopEscalation('blocked'))
      .where('id', '=', a.id)
      .execute();
    // A test alert has no stranger behind it: nothing to block in the abuse module.
    if (a.is_test) return { blocked: true, chatClosed, phoneBanned: false, protectedMode: false };
    const r = await this.report(userId, a.id, 'blocked', undefined).catch((err: unknown) => {
      if (err instanceof ConflictException) return null; // reported before: the block already exists
      throw err;
    });
    return {
      blocked: true,
      chatClosed,
      phoneBanned: r?.phoneBanned ?? false,
      protectedMode: r?.protectedMode ?? false,
    };
  }

  /** "Anzeigen": the hidden free text of an unconfirmed sender, on the owner's explicit request. */
  async hiddenContent(userId: string, alertId: string) {
    const a = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .select(['a.custom_message_enc'])
      .where('a.id', '=', alertId)
      .where('v.owner_user_id', '=', userId)
      .where('a.content_hidden', '=', true)
      .where('a.status', '<>', 'blocked')
      .executeTakeFirst();
    if (!a) throw new NotFoundException();
    return { message: a.custom_message_enc ? this.crypto.decrypt(a.custom_message_enc) : null };
  }

  /** SP-05: the latest attempts with reasons, plus what is set up right now. */
  async deliveries(userId: string) {
    const [attempts, devices, appDevices, sms, rules, protection, usage] = await Promise.all([
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
        .selectFrom('user_devices')
        .select(['platform', 'failed_count'])
        .where('user_id', '=', userId)
        .execute(),
      this.db
        .selectFrom('contact_channels')
        .select('id')
        .where('user_id', '=', userId)
        .where('type', '=', 'sms')
        .where('verified_at', 'is not', null)
        .executeTakeFirst(),
      this.db.selectFrom('notification_rules').select('id').where('user_id', '=', userId).execute(),
      this.preferences.protection(userId),
      this.fairUse.usage(userId),
    ]);
    const switchedOff: string[] = [];
    for (const c of ['native_push', 'webpush', 'email', 'sms']) {
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
        appDevices: appDevices.length,
        appFailing: appDevices.filter((d) => d.failed_count > 0).length,
        sms: Boolean(sms),
        quietHours: rules.length,
        decalTested: protection.steps.decal,
        switchedOff,
        smsUsage: usage.sms,
      },
    };
  }
}
