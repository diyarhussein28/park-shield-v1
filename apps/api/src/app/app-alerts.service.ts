import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB } from '../core/tokens';
import { ChatService } from '../chat/chat.service';
import { DispatchService } from '../notifications/dispatch.service';
import { stopEscalation } from '../notifications/escalation';
import { SenderBlockService } from '../abuse/sender-block.service';
import { unseenCount } from '../notifications/unseen';

const PAGE = 30;

/**
 * The owner's alerts in the native app (alert list and detail). Everything the push does not carry
 * (scanner message, photos, vehicle) is loaded here, behind the owner's session.
 */
@Injectable()
export class AppAlertsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(DispatchService) private readonly dispatch: DispatchService,
    @Inject(SenderBlockService) private readonly senderBlocks: SenderBlockService,
  ) {}

  private base(userId: string) {
    return this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .leftJoin('chat_sessions as c', 'c.alert_id', 'a.id')
      .where('v.owner_user_id', '=', userId)
      .where('a.status', '<>', 'blocked');
  }

  async list(userId: string, before?: Date) {
    let q = this.base(userId)
      .select([
        'a.id',
        'a.alert_type',
        'a.severity',
        'a.status',
        'a.is_test',
        'a.created_at',
        'a.expires_at',
        'a.seen_at',
        'a.owner_reply',
        'a.acknowledged_by',
        'a.escalation_stage',
        'a.resolved_at',
        'a.vehicle_id',
        'a.qr_token_id',
        'a.block_ref',
        'a.verified_phone_hash',
        'v.id as vehicleId',
        'v.nickname',
        't.label_de',
        't.label_en',
        'c.status as chatStatus',
        (eb) =>
          eb
            .selectFrom('alert_media as m')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('m.alert_id', '=', 'a.id')
            .where('m.deleted_at', 'is', null)
            .as('photoCount'),
      ])
      .orderBy('a.created_at', 'desc')
      .limit(PAGE + 1);
    if (before) q = q.where('a.created_at', '<', before);
    const rows = await q.execute();
    const now = new Date();
    // Block state per alert, computed here: every alert of a blocked sender says so (2026-11-22).
    const blocks = await this.senderBlocks.stateFor(rows.slice(0, PAGE));
    return {
      alerts: rows.slice(0, PAGE).map((r) => ({
        id: r.id,
        type: { code: r.alert_type, de: r.label_de, en: r.label_en },
        severity: r.severity,
        status: this.status(r.status, r.expires_at, now),
        isTest: r.is_test,
        createdAt: r.created_at,
        seenAt: r.seen_at,
        acknowledged: r.owner_reply === 'coming' || r.acknowledged_by !== null,
        acknowledgedBy: r.acknowledged_by,
        resolved: r.resolved_at !== null,
        escalationStage: r.escalation_stage,
        vehicle: { id: r.vehicleId, nickname: r.nickname },
        photoCount: Number(r.photoCount ?? 0),
        chatStatus: r.chatStatus,
        senderBlocked: blocks.get(r.id)?.senderBlocked ?? false,
        blockedUntil: blocks.get(r.id)?.blockedUntil ?? null,
      })),
      next: rows.length > PAGE ? rows[PAGE - 1]!.created_at : null,
      pushReady: await this.dispatch.hasPushDevice(userId),
      // The Alerts tab badge: alerts not opened yet, counted on the server (not only this page).
      unseenCount: await this.unseenCount(userId),
    };
  }

  /** Alerts the owner has not opened yet (the tab badge and the app icon badge). */
  unseenCount(userId: string): Promise<number> {
    return unseenCount(this.db, userId);
  }

  private status(status: string, expiresAt: Date, now: Date) {
    const open = ['created', 'dispatched', 'delivered'].includes(status);
    return open && expiresAt < now ? 'expired' : status;
  }

  async detail(userId: string, alertId: string, reveal = false) {
    const a = await this.base(userId)
      .select([
        'a.id',
        'a.alert_type',
        'a.severity',
        'a.status',
        'a.is_test',
        'a.created_at',
        'a.expires_at',
        'a.seen_at',
        'a.owner_reply',
        'a.acknowledged_at',
        'a.acknowledged_by',
        'a.escalation_stage',
        'a.remind_at',
        'a.reminded_at',
        'a.sms_due_at',
        'a.sms_sent_at',
        'a.escalation_stopped_at',
        'a.escalation_stop_reason',
        'a.custom_message_enc',
        'a.content_hidden',
        'a.vehicle_id',
        'a.qr_token_id',
        'a.block_ref',
        'a.verified_phone_hash',
        'v.id as vehicleId',
        'v.nickname',
        'v.owner_user_id',
        't.label_de',
        't.label_en',
      ])
      .where('a.id', '=', alertId)
      .executeTakeFirst();
    if (!a) throw new NotFoundException({ error: 'alert_not_found' });
    const [allMedia, report, chat, blocked, own] = await Promise.all([
      this.db
        .selectFrom('alert_media')
        .select([
          'id',
          'position',
          'width',
          'height',
          'deleted_at',
          'deleted_reason',
          'wrapped_key',
        ])
        .where('alert_id', '=', a.id)
        .orderBy('position')
        .execute(),
      // „Missbrauch melden“ was used for this alert (app, portal, view page or e-mail link).
      this.db
        .selectFrom('abuse_reports')
        .select('id')
        .where('alert_id', '=', a.id)
        .where('reason', '=', 'photo_abuse')
        .executeTakeFirst(),
      this.chat.state(a.id, 'owner'),
      this.chat.senderBlocked(a.id),
      this.senderBlocks.stateOf(a),
    ]);
    const media = allMedia
      .filter((m) => !m.deleted_at && m.wrapped_key)
      .map((m) => ({ id: m.id, position: m.position, width: m.width, height: m.height }));
    // Why there are no photos any more (same rule as the view page): an abuse report or 30 days.
    const photosGone =
      allMedia.length && !media.length
        ? allMedia.some((m) => m.deleted_reason === 'abuse_report')
          ? 'abuse_report'
          : 'retention'
        : null;
    const shown = !a.content_hidden || reveal;
    const by = a.acknowledged_by;
    return {
      id: a.id,
      type: { code: a.alert_type, de: a.label_de, en: a.label_en },
      severity: a.severity,
      status: this.status(a.status, a.expires_at, new Date()),
      isTest: a.is_test,
      createdAt: a.created_at,
      expiresAt: a.expires_at,
      seenAt: a.seen_at,
      reply: a.owner_reply,
      acknowledgedAt: a.acknowledged_at,
      acknowledgedBy: by ? { kind: 'owner' as const, name: null } : null,
      // Reminder push after 10 min, one SMS after 30 min, unless the owner reacted (2026-11-21).
      escalation: {
        stage: a.escalation_stage,
        reminderAt: a.remind_at,
        remindedAt: a.reminded_at,
        smsDueAt: a.sms_due_at,
        smsSentAt: a.sms_sent_at,
        stoppedAt: a.escalation_stopped_at,
        stopReason: a.escalation_stop_reason,
      },
      vehicle: { id: a.vehicleId, nickname: a.nickname },
      contentHidden: a.content_hidden,
      revealed: shown,
      // The scanner's text already passed the filter (SC-04); gone after 7 days.
      message: shown && a.custom_message_enc ? this.crypto.decrypt(a.custom_message_enc) : null,
      photos: shown ? media : [],
      photoCount: media.length,
      photosGone,
      reported: Boolean(report),
      // The owner's own block of this sender (scanner reference or confirmed number), with its end.
      senderBlocked: own.senderBlocked,
      blockedUntil: own.blockedUntil,
      chat: chat
        ? { ...chat, canOpen: chat.status === 'locked' && !blocked, senderBlocked: blocked }
        : null,
    };
  }

  /**
   * „Erledigt“: the owner marks the alert resolved. A stop condition: no reminder, no SMS any more.
   * The alert keeps its status (the scanner sees what the owner answered, if anything).
   */
  async resolve(userId: string, alertId: string): Promise<{ resolvedAt: Date }> {
    const row = await this.db
      .updateTable('alerts')
      .set({ resolved_at: sql`coalesce(resolved_at, now())`, ...stopEscalation('resolved') })
      .where('id', '=', alertId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('vehicles as v')
            .select('v.id')
            .whereRef('v.id', '=', 'alerts.vehicle_id')
            .where('v.owner_user_id', '=', userId),
        ),
      )
      .returning(['resolved_at'])
      .executeTakeFirst();
    if (!row?.resolved_at) throw new NotFoundException({ error: 'alert_not_found' });
    return { resolvedAt: row.resolved_at };
  }

  /**
   * Opening the alert in the app: "seen", shown to the scanner. Since 2026-11-22 it counts as a
   * reaction: the same UPDATE (one transaction) cancels the pending reminder push and the SMS; the
   * workers drop a step that was already queued (`escalation_stopped_at`). The alert leaves the badge.
   */
  async seen(
    userId: string,
    alertId: string,
  ): Promise<{ seenAt: Date; first: boolean; unseenCount: number }> {
    const row = await this.db
      .updateTable('alerts')
      .set({ seen_at: sql`coalesce(seen_at, now())`, ...stopEscalation('seen') })
      .where('id', '=', alertId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('vehicles as v')
            .select('v.id')
            .whereRef('v.id', '=', 'alerts.vehicle_id')
            .where('v.owner_user_id', '=', userId),
        ),
      )
      .returning(['seen_at'])
      .executeTakeFirst();
    if (!row?.seen_at) throw new NotFoundException({ error: 'alert_not_found' });
    return {
      seenAt: row.seen_at,
      first: Date.now() - row.seen_at.getTime() < 2_000,
      unseenCount: await this.unseenCount(userId),
    };
  }
}
