import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB } from '../core/tokens';
import { PreferencesService } from '../preferences/preferences.service';
import { maskAddress, maskEmail, maskPhone, maskPlate } from './mask';
import { StaffService, type StaffContext } from './staff.service';

const CODE_HINT = /^[0-9A-HJKMNP-TV-Z]{4}$/;

/**
 * Customer 360 and delivery trace (AD-03, AD-04, US-35). Everything is masked (AD-05); the full value of
 * a field is only available through break-glass. Every view is written to the audit log as a read.
 * There is no "log in as customer".
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(PreferencesService) private readonly preferences: PreferencesService,
  ) {}

  /** By e-mail (or its beginning) or by the last 4 characters of a decal code. */
  async search(by: StaffContext, q: string) {
    const query = q.trim();
    if (query.length < 3) throw new BadRequestException({ error: 'query_too_short' });
    const code = query.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
    const base = this.db
      .selectFrom('users as u')
      .leftJoin('subscriptions as s', (j) =>
        j.onRef('s.user_id', '=', 'u.id').on('s.status', 'in', ['active', 'past_due']),
      )
      .select([
        'u.id',
        'u.email',
        'u.status',
        'u.created_at',
        's.plan',
        's.status as subscriptionStatus',
      ])
      .where('u.kind', '=', 'customer')
      .limit(25);
    const rows = CODE_HINT.test(code)
      ? await base
          .where(
            'u.id',
            'in',
            this.db
              .selectFrom('qr_tokens as t')
              .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
              .select('v.owner_user_id')
              .where('t.code_hint', '=', code)
              .where('v.owner_user_id', 'is not', null) as never,
          )
          .execute()
      : await base.where('u.email', 'ilike', `${query.replace(/[%_\\]/g, '\\$&')}%`).execute();
    await this.staff.auditRead(by.userId, 'customer.search', 'users', null, {
      by: CODE_HINT.test(code) ? 'code_hint' : 'email',
      results: rows.length,
    });
    return {
      customers: rows.map((r) => ({
        id: r.id,
        email: r.email,
        status: r.status,
        plan: r.plan,
        subscriptionStatus: r.subscriptionStatus,
        createdAt: r.created_at,
      })),
    };
  }

  async view(by: StaffContext, userId: string) {
    const u = await this.db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'status',
        'kind',
        'preferred_lang',
        'created_at',
        'last_login_at',
        'email_verified_at',
        'deletion_due_at',
        'free_replacements',
      ])
      .where('id', '=', userId)
      .where('kind', '=', 'customer')
      .executeTakeFirst();
    if (!u) throw new NotFoundException();
    const db = this.db;
    const [
      subs,
      vehicles,
      tokens,
      push,
      whatsapp,
      waStats,
      contacts,
      orders,
      refunds,
      alerts,
      dsrs,
      reports,
      protection,
    ] = await Promise.all([
      db
        .selectFrom('subscriptions')
        .select([
          'id',
          'plan',
          'status',
          'contract_no',
          'current_period_start',
          'current_period_end',
          'cancel_at_period_end',
          'canceled_at',
          'created_at',
        ])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .execute(),
      db
        .selectFrom('vehicles')
        .select(['id', 'nickname', 'plate_enc', 'color', 'make_model', 'created_at'])
        .where('owner_user_id', '=', userId)
        .orderBy('created_at')
        .execute(),
      db
        .selectFrom('qr_tokens as t')
        .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
        .select([
          't.id',
          't.vehicle_id',
          't.code_hint',
          't.status',
          't.activated_at',
          't.last_test_at',
          't.last_scanned_at',
          't.revoked_at',
          't.revoke_reason',
          't.created_at',
        ])
        .where('v.owner_user_id', '=', userId)
        .orderBy('t.created_at', 'desc')
        .execute(),
      db
        .selectFrom('push_subscriptions')
        .select(['id', 'platform', 'device_label', 'created_at', 'last_ok_at', 'failed_count'])
        .where('user_id', '=', userId)
        .execute(),
      db
        .selectFrom('contact_channels')
        .select(['id', 'address_enc', 'verified_at', 'opted_in_at', 'is_enabled'])
        .where('user_id', '=', userId)
        .where('type', '=', 'whatsapp')
        .where('verified_at', 'is not', null)
        .executeTakeFirst(),
      sql<{ last_ok: Date | null; errors: number }>`
          SELECT max(d.sent_at) FILTER (WHERE d.status IN ('sent','delivered','read')) AS last_ok,
                 count(*) FILTER (WHERE d.status = 'failed')::int AS errors
            FROM alert_deliveries d JOIN alerts a ON a.id = d.alert_id JOIN vehicles v ON v.id = a.vehicle_id
           WHERE v.owner_user_id = ${userId} AND d.channel = 'whatsapp' AND d.recipient = 'owner'`.execute(
        db,
      ),
      db
        .selectFrom('emergency_contacts')
        .select([
          'id',
          'display_name',
          'address_enc',
          'consent',
          'consent_requested_at',
          'consent_decided_at',
          'vehicle_id',
        ])
        .where('user_id', '=', userId)
        .execute(),
      db
        .selectFrom('decal_orders')
        .select([
          'id',
          'status',
          'shipping_address_enc',
          'total_gross_cents',
          'is_replacement',
          'included_in_plan',
          'tracking_number',
          'created_at',
          'shipped_at',
          'delivered_at',
        ])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .execute(),
      db
        .selectFrom('refunds as r')
        .innerJoin('subscriptions as s', 's.id', 'r.subscription_id')
        .select(['r.id', 'r.kind', 'r.refund_gross_cents', 'r.credit_note_no', 'r.created_at'])
        .where('s.user_id', '=', userId)
        .execute(),
      db
        .selectFrom('alerts as a')
        .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
        .select([
          'a.id',
          'a.alert_type',
          'a.severity',
          'a.status',
          'a.is_test',
          'a.owner_reply',
          'a.created_at',
          'v.nickname',
        ])
        .where('v.owner_user_id', '=', userId)
        .orderBy('a.created_at', 'desc')
        .limit(25)
        .execute(),
      db
        .selectFrom('data_subject_requests')
        .select(['id', 'type', 'status', 'due_at', 'created_at'])
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .execute(),
      db
        .selectFrom('abuse_reports')
        .select(['id', 'kind', 'reason', 'status', 'created_at'])
        .where('reported_by', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(10)
        .execute(),
      this.preferences.protection(userId),
    ]);
    await this.staff.auditRead(by.userId, 'customer.view', 'users', userId);
    const dec = (b: Buffer | null) => (b && b.length ? this.crypto.decrypt(b) : null);
    const wa = waStats.rows[0];
    return {
      customer: {
        id: u.id,
        email: u.email,
        status: u.status,
        language: u.preferred_lang,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        emailVerifiedAt: u.email_verified_at,
        deletionDueAt: u.deletion_due_at,
        freeReplacements: u.free_replacements,
      },
      protection,
      subscriptions: subs.map((s) => ({
        id: s.id,
        plan: s.plan,
        status: s.status,
        contractNo: s.contract_no,
        periodStart: s.current_period_start,
        periodEnd: s.current_period_end,
        cancelAtPeriodEnd: s.cancel_at_period_end,
        canceledAt: s.canceled_at,
      })),
      vehicles: vehicles.map((v) => {
        const plate = dec(v.plate_enc);
        return {
          id: v.id,
          nickname: v.nickname,
          plateMasked: plate ? maskPlate(plate) : null,
          color: v.color,
          makeModel: v.make_model,
          decals: tokens
            .filter((t) => t.vehicle_id === v.id)
            .map((t) => ({
              id: t.id,
              codeHint: t.code_hint,
              status: t.status,
              activatedAt: t.activated_at,
              lastTestAt: t.last_test_at,
              lastScannedAt: t.last_scanned_at,
              revokedAt: t.revoked_at,
              revokeReason: t.revoke_reason,
            })),
        };
      }),
      channels: {
        email: { verified: Boolean(u.email_verified_at) },
        push: push.map((p) => ({
          id: p.id,
          platform: p.platform,
          label: p.device_label,
          createdAt: p.created_at,
          lastOkAt: p.last_ok_at,
          errorCount: p.failed_count,
        })),
        whatsapp: whatsapp
          ? {
              id: whatsapp.id,
              phoneMasked: maskPhone(dec(whatsapp.address_enc) ?? ''),
              verifiedAt: whatsapp.verified_at,
              enabled: whatsapp.is_enabled,
              lastOkAt: wa?.last_ok ?? null,
              errorCount: wa?.errors ?? 0,
            }
          : null,
      },
      emergencyContacts: contacts.map((c) => ({
        id: c.id,
        name: c.display_name,
        emailMasked: maskEmail(dec(c.address_enc) ?? ''),
        consent: c.consent,
        requestedAt: c.consent_requested_at,
        decidedAt: c.consent_decided_at,
        vehicleId: c.vehicle_id,
      })),
      orders: orders.map((o) => {
        const address = dec(o.shipping_address_enc);
        return {
          id: o.id,
          status: o.status,
          totalCents: o.total_gross_cents,
          replacement: o.is_replacement,
          included: o.included_in_plan,
          addressMasked: address ? maskAddress(address) : null,
          trackingNumber: o.tracking_number,
          createdAt: o.created_at,
          shippedAt: o.shipped_at,
          deliveredAt: o.delivered_at,
        };
      }),
      refunds,
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.alert_type,
        severity: a.severity,
        status: a.status,
        isTest: a.is_test,
        ownerReply: a.owner_reply,
        createdAt: a.created_at,
        nickname: a.nickname,
      })),
      requests: dsrs.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        dueAt: r.due_at,
        createdAt: r.created_at,
      })),
      reports: reports.map((r) => ({
        id: r.id,
        kind: r.kind,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * AD-20: the small summary next to a Zammad ticket (opened from the ticket's link field). Same
   * masking and audit as Customer 360; the full view is one click away.
   */
  async summary(by: StaffContext, email: string) {
    const u = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'status', 'created_at'])
      .where('email', '=', email.trim().toLowerCase())
      .where('kind', '=', 'customer')
      .executeTakeFirst();
    await this.staff.auditRead(by.userId, 'customer.summary', 'users', u?.id ?? null, {
      via: 'zammad',
      found: Boolean(u),
    });
    if (!u) return { found: false as const };
    const [sub, counts, protection] = await Promise.all([
      this.db
        .selectFrom('subscriptions')
        .select(['plan', 'status', 'current_period_end', 'cancel_at_period_end'])
        .where('user_id', '=', u.id)
        .orderBy('created_at', 'desc')
        .executeTakeFirst(),
      this.db
        .selectNoFrom((eb) => [
          eb
            .selectFrom('vehicles')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('owner_user_id', '=', u.id)
            .as('vehicles'),
          eb
            .selectFrom('qr_tokens as t')
            .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('v.owner_user_id', '=', u.id)
            .where('t.status', '=', 'active')
            .as('activeDecals'),
          eb
            .selectFrom('push_subscriptions')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('user_id', '=', u.id)
            .as('pushDevices'),
          eb
            .selectFrom('contact_channels')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('user_id', '=', u.id)
            .where('type', '=', 'whatsapp')
            .where('verified_at', 'is not', null)
            .as('whatsapp'),
          eb
            .selectFrom('emergency_contacts')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('user_id', '=', u.id)
            .where('consent', '=', 'confirmed')
            .as('contacts'),
          eb
            .selectFrom('alerts as a')
            .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
            .select((e) => e.fn.max('a.created_at').as('m'))
            .where('v.owner_user_id', '=', u.id)
            .where('a.is_test', '=', false)
            .as('lastAlertAt'),
          eb
            .selectFrom('data_subject_requests')
            .select((e) => e.fn.countAll<string>().as('n'))
            .where('user_id', '=', u.id)
            .where('status', 'not in', ['completed', 'rejected'])
            .as('openDsr'),
        ])
        .executeTakeFirstOrThrow(),
      this.preferences.protection(u.id),
    ]);
    return {
      found: true as const,
      id: u.id,
      email: maskEmail(u.email),
      status: u.status,
      customerSince: u.created_at,
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            periodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          }
        : null,
      vehicles: Number(counts.vehicles ?? 0),
      activeDecals: Number(counts.activeDecals ?? 0),
      pushDevices: Number(counts.pushDevices ?? 0),
      whatsapp: Number(counts.whatsapp ?? 0) > 0,
      contacts: Number(counts.contacts ?? 0),
      lastAlertAt: (counts.lastAlertAt as Date | null) ?? null,
      openDsr: Number(counts.openDsr ?? 0),
      protection: protection.percent,
    };
  }

  /** AD-04: every attempt with timings, cost and reasons. Never the free text. */
  async trace(by: StaffContext, alertId: string) {
    const a = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .select([
        'a.id',
        'a.alert_type',
        'a.severity',
        'a.status',
        'a.is_test',
        'a.moderation',
        'a.owner_reply',
        'a.created_at',
        'a.dispatched_at',
        'a.acknowledged_at',
        'a.scanner_waiting_at',
        'a.followup_sent_at',
        'a.escalate_at',
        'a.escalated_at',
        'a.expires_at',
        'a.scanner_lang',
        'v.nickname',
        'v.owner_user_id',
        sql<boolean>`a.custom_message_enc IS NOT NULL`.as('hasMessage'),
      ])
      .where('a.id', '=', alertId)
      .executeTakeFirst();
    if (!a) throw new NotFoundException();
    const deliveries = await this.db
      .selectFrom('alert_deliveries')
      .select([
        'id',
        'recipient',
        'channel',
        'provider',
        'status',
        'suppressed_reason',
        'error_code',
        'attempt',
        'cost_micros_eur',
        'queued_at',
        'sent_at',
        'delivered_at',
        'read_at',
      ])
      .where('alert_id', '=', alertId)
      .orderBy('queued_at')
      .execute();
    await this.staff.auditRead(by.userId, 'alert.trace', 'alerts', alertId);
    return {
      alert: {
        id: a.id,
        customerId: a.owner_user_id,
        nickname: a.nickname,
        type: a.alert_type,
        severity: a.severity,
        status: a.status,
        isTest: a.is_test,
        moderation: a.moderation,
        hasMessage: a.hasMessage,
        ownerReply: a.owner_reply,
        scannerLanguage: a.scanner_lang,
        timeline: {
          createdAt: a.created_at,
          dispatchedAt: a.dispatched_at,
          acknowledgedAt: a.acknowledged_at,
          scannerWaitingAt: a.scanner_waiting_at,
          followupSentAt: a.followup_sent_at,
          escalateAt: a.escalate_at,
          escalatedAt: a.escalated_at,
          expiresAt: a.expires_at,
        },
      },
      deliveries: deliveries.map((d) => ({
        id: d.id,
        recipient: d.recipient,
        channel: d.channel,
        provider: d.provider,
        status: d.status,
        suppressedReason: d.suppressed_reason,
        errorCode: d.error_code,
        attempt: d.attempt,
        costEur: (d.cost_micros_eur ?? 0) / 1_000_000,
        queuedAt: d.queued_at,
        sentAt: d.sent_at,
        deliveredAt: d.delivered_at,
        readAt: d.read_at,
      })),
    };
  }
}
