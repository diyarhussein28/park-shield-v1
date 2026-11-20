import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB } from '../core/tokens';
import { ChatService } from '../chat/chat.service';
import { DispatchService } from '../notifications/dispatch.service';

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
        'a.escalation_step',
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
        escalationStep: r.escalation_step,
        vehicle: { id: r.vehicleId, nickname: r.nickname },
        photoCount: Number(r.photoCount ?? 0),
        chatStatus: r.chatStatus,
      })),
      next: rows.length > PAGE ? rows[PAGE - 1]!.created_at : null,
      pushReady: await this.dispatch.hasPushDevice(userId),
    };
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
        'a.escalation_step',
        'a.escalated_at',
        'a.custom_message_enc',
        'a.content_hidden',
        'v.id as vehicleId',
        'v.nickname',
        'v.owner_user_id',
        't.label_de',
        't.label_en',
        't.escalates',
      ])
      .where('a.id', '=', alertId)
      .executeTakeFirst();
    if (!a) throw new NotFoundException({ error: 'alert_not_found' });
    const [allMedia, report, contacts, chat, blocked] = await Promise.all([
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
      // Who was notified in the chain, and who acknowledged ("Kim kommt").
      this.db
        .selectFrom('alert_deliveries as d')
        .leftJoin('emergency_contacts as c', 'c.id', 'd.emergency_contact_id')
        .select(['d.escalation_step', 'c.display_name'])
        .where('d.alert_id', '=', a.id)
        .where('d.recipient', '=', 'emergency_contact')
        .where('d.escalation_step', 'is not', null)
        .groupBy(['d.escalation_step', 'c.display_name'])
        .orderBy('d.escalation_step')
        .execute(),
      this.chat.state(a.id, 'owner'),
      this.chat.senderBlocked(a.id),
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
    const contactStep = by?.startsWith('contact_') ? Number(by.slice(8)) : null;
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
      acknowledgedBy: by
        ? {
            kind: contactStep ? 'contact' : 'owner',
            name: contactStep
              ? (contacts.find((c) => c.escalation_step === contactStep)?.display_name ?? null)
              : null,
          }
        : null,
      escalation: {
        applies: a.escalates,
        step: a.escalation_step,
        escalatedAt: a.escalated_at,
        notified: contacts.map((c) => ({ step: c.escalation_step, name: c.display_name })),
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
      chat: chat
        ? { ...chat, canOpen: chat.status === 'locked' && !blocked, senderBlocked: blocked }
        : null,
    };
  }

  /** Opening the alert in the app: "seen". Shown to the scanner; does not stop reminders or escalation. */
  async seen(userId: string, alertId: string): Promise<{ seenAt: Date; first: boolean }> {
    const row = await this.db
      .updateTable('alerts')
      .set({ seen_at: sql`coalesce(seen_at, now())` })
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
    return { seenAt: row.seen_at, first: Date.now() - row.seen_at.getTime() < 2_000 };
  }
}
