import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Logger } from 'pino';
import { fakeProviders, type Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { sha256, type FieldCrypto } from '../core/crypto';
import { CRYPTO, DB, ENV, LOGGER } from '../core/tokens';
import type { DB as Schema } from '../db/types.generated';
import { MailService } from '../mail/mail.service';
import { SMS, type SmsSender } from '../providers/ports';
import { FairUseService } from './fair-use.service';
import { smsLinkText } from './sms-texts';

export const ESCALATE_TOPIC = 'alert.escalate';
/** Up to three emergency contacts, escalated one after another. */
export const MAX_CONTACTS = 3;
const DONE = ['sent', 'delivered', 'read'] as const;

/**
 * SQL: is escalation switched on for the alert's vehicle right now? PREMIUM with an active (or past
 * due, like every entitlement) subscription, and the owner's switch, overridden per vehicle.
 */
const escalationOn = sql<boolean>`EXISTS (
  SELECT 1 FROM vehicles v JOIN users u ON u.id = v.owner_user_id
   WHERE v.id = alerts.vehicle_id AND coalesce(v.escalation_enabled, u.escalation_enabled)
     AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.plan = 'premium'
                  AND s.status IN ('active', 'past_due')))`;

/** SQL: how many contacts can be escalated to (confirmed, not deactivated, this vehicle or all). */
const activeContacts = sql<number>`(
  SELECT count(*) FROM emergency_contacts c JOIN vehicles v ON v.owner_user_id = c.user_id
   WHERE v.id = alerts.vehicle_id AND c.consent = 'confirmed' AND c.deactivated_at IS NULL
     AND (c.vehicle_id IS NULL OR c.vehicle_id = alerts.vehicle_id))`;

/**
 * Escalation to emergency contacts (NT-03, PREMIUM only): contact 1 → 2 → 3, each after the owner's
 * delay (3–30 min, default 7) counted from alert creation, then from the previous step. `escalate_at`
 * is the source of truth for the next step; the sweeper advances due alerts atomically
 * (escalation_step + 1) and queues one outbox event per step, so a stale or duplicate job is harmless.
 * Checked at every step, not only when the alert was created: PREMIUM active, escalation switched on,
 * an escalating type, not acknowledged ("Ich komme"), and a confirmed contact at that position.
 */
@Injectable()
export class EscalationService {
  private readonly key: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(SMS) private readonly sms: SmsSender,
    @Inject(FairUseService) private readonly fairUse: FairUseService,
  ) {
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- key comes from env.SESSION_SECRET
    this.key = createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'base64'))
      .update('parkshield/contact-link/v1')
      .digest();
  }

  /** The link token of one contact for one alert (/k/<token>): 256-bit HMAC, only its hash is stored. */
  contactToken(alertId: string, contactId: string): string {
    return createHmac('sha256', this.key).update(`${alertId}:${contactId}`).digest('base64url');
  }

  contactUrl(token: string): string {
    return `${this.env.WEB_BASE_URL.replace(/\/$/, '')}/k/${token}`;
  }

  /**
   * Would an escalation for this owner and vehicle happen at all? PREMIUM, switched on (owner, vehicle
   * override) and at least one confirmed, active contact.
   */
  async applies(
    ownerId: string | null,
    vehicleId: string,
    db: Kysely<Schema> = this.db,
  ): Promise<boolean> {
    if (!ownerId) return false;
    const row = await db
      .selectFrom('vehicles as v')
      .innerJoin('users as u', 'u.id', 'v.owner_user_id')
      .select('v.id')
      .where('v.id', '=', vehicleId)
      .where('u.id', '=', ownerId)
      .where(sql<boolean>`coalesce(v.escalation_enabled, u.escalation_enabled)`)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('subscriptions as s')
            .select('s.id')
            .whereRef('s.user_id', '=', 'u.id')
            .where('s.plan', '=', 'premium')
            .where('s.status', 'in', ['active', 'past_due']),
        ),
      )
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('emergency_contacts as c')
            .select('c.id')
            .whereRef('c.user_id', '=', 'u.id')
            .where('c.consent', '=', 'confirmed')
            .where('c.deactivated_at', 'is', null)
            .where((e) => e.or([e('c.vehicle_id', 'is', null), e('c.vehicle_id', '=', vehicleId)])),
        ),
      )
      .executeTakeFirst();
    return Boolean(row);
  }

  /** @deprecated name kept for callers: same as applies(). */
  hasContact(ownerId: string | null, vehicleId: string, db: Kysely<Schema> = this.db) {
    return this.applies(ownerId, vehicleId, db);
  }

  async delayMinutes(ownerId: string): Promise<number> {
    const owner = await this.db
      .selectFrom('users')
      .select('escalation_minutes')
      .where('id', '=', ownerId)
      .executeTakeFirst();
    return (
      owner?.escalation_minutes ?? Number(await this.settings.get('escalation.default_minutes', 7))
    );
  }

  /** escalate_at for a new alert: escalating types only, when escalation applies (step 3). */
  async initialEscalateAt(input: {
    ownerId: string | null;
    vehicleId: string;
    escalates: boolean;
    isTest: boolean;
  }): Promise<Date | null> {
    if (input.isTest || !input.escalates || !input.ownerId) return null;
    if (!(await this.applies(input.ownerId, input.vehicleId))) return null;
    return new Date(Date.now() + (await this.delayMinutes(input.ownerId)) * 60_000);
  }

  private dueCondition() {
    return sql<boolean>`escalate_at <= now() AND expires_at > now() AND NOT is_test
      AND status IN ('dispatched', 'delivered', 'acknowledged', 'escalated')
      AND (owner_reply IS NULL OR owner_reply <> 'coming')
      AND acknowledged_by IS NULL
      AND escalation_step < ${MAX_CONTACTS}
      AND EXISTS (SELECT 1 FROM alert_types t WHERE t.code = alerts.alert_type AND t.escalates)
      AND ${escalationOn}
      AND ${activeContacts} > escalation_step`;
  }

  /**
   * Moves due alerts one step on, atomically: escalation_step + 1, the next step after the owner's delay
   * (or none after the last contact). Returns the alerts and the step to notify.
   */
  private async advance(alertId?: string): Promise<{ id: string; step: number }[]> {
    const fallback = Number(await this.settings.get('escalation.default_minutes', 7));
    const rows = await sql<{ id: string; step: number }>`
      UPDATE alerts SET
        status = 'escalated',
        escalated_at = coalesce(escalated_at, now()),
        escalation_step = escalation_step + 1,
        escalate_at = CASE WHEN ${activeContacts} > escalation_step + 1
          THEN now() + make_interval(mins => (
            SELECT coalesce(u.escalation_minutes, ${fallback}) FROM vehicles v
              JOIN users u ON u.id = v.owner_user_id WHERE v.id = alerts.vehicle_id))
          ELSE NULL END
       WHERE id IN (
         SELECT id FROM alerts WHERE ${this.dueCondition()}
            ${alertId ? sql`AND id = ${alertId}` : sql``}
          ORDER BY escalate_at LIMIT 200 FOR UPDATE SKIP LOCKED)
       RETURNING id, escalation_step AS step`.execute(this.db);
    return rows.rows;
  }

  /** Sweeper (every few seconds): due steps → one outbox event each (02-architecture §3 step 8). */
  async sweep(): Promise<number> {
    const due = await this.advance();
    if (!due.length) return 0;
    await this.db
      .insertInto('outbox_events')
      .values(
        due.map((d) => ({
          topic: ESCALATE_TOPIC,
          payload: JSON.stringify({ alertId: d.id, step: d.step }),
        })),
      )
      .execute();
    return due.length;
  }

  /**
   * Outbox handler. With a step: notify that contact (once). Without (the owner tapped "Bin nicht in der
   * Nähe", escalate_at = now): advance now instead of waiting for the sweeper, then notify.
   */
  async run(payload: Record<string, unknown>): Promise<void> {
    const alertId = String(payload.alertId);
    if (typeof payload.step === 'number') {
      await this.notifyContact(alertId, payload.step);
      return;
    }
    for (const d of await this.advance(alertId)) await this.notifyContact(d.id, d.step);
  }

  /** Cancels pending steps of the owner's open alerts (escalation switched off, globally or per vehicle). */
  async cancelPending(ownerId: string, vehicleId?: string): Promise<number> {
    let q = this.db
      .updateTable('alerts')
      .set({ escalate_at: null })
      .where('escalate_at', 'is not', null)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('vehicles as v')
            .select('v.id')
            .whereRef('v.id', '=', 'alerts.vehicle_id')
            .where('v.owner_user_id', '=', ownerId),
        ),
      );
    if (vehicleId) q = q.where('vehicle_id', '=', vehicleId);
    const r = await q.executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  private async notifyContact(alertId: string, step: number): Promise<void> {
    const alert = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('users as u', 'u.id', 'v.owner_user_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .select([
        'a.id',
        'a.vehicle_id',
        'a.escalated_at',
        'a.acknowledged_by',
        'a.owner_reply',
        'a.expires_at',
        'v.nickname',
        'u.id as ownerId',
        'u.email as ownerEmail',
        'u.display_name',
        'u.preferred_lang',
        't.label_de',
        't.label_en',
      ])
      .where('a.id', '=', alertId)
      .executeTakeFirst();
    // Acknowledged in the meantime ("Ich komme" by the owner or an earlier contact): stop the chain.
    if (!alert?.escalated_at || alert.acknowledged_by || alert.owner_reply === 'coming') return;

    const contacts = await this.db
      .selectFrom('emergency_contacts')
      .select(['id', 'display_name', 'address_enc', 'phone_enc'])
      .where('user_id', '=', alert.ownerId)
      .where('consent', '=', 'confirmed')
      .where('deactivated_at', 'is', null)
      .where((eb) => eb.or([eb('vehicle_id', 'is', null), eb('vehicle_id', '=', alert.vehicle_id)]))
      .orderBy('escalation_order')
      .orderBy('created_at')
      .execute();
    const c = contacts[step - 1];
    if (!c) return;

    const token = this.contactToken(alertId, c.id);
    const url = this.contactUrl(token);
    const lang = alert.preferred_lang;
    const type = lang === 'en' ? alert.label_en : alert.label_de;
    const errors: unknown[] = [];
    const base = {
      alert_id: alertId,
      recipient: 'emergency_contact' as const,
      emergency_contact_id: c.id,
      ack_token_hash: sha256(token),
      escalation_step: step,
    };
    const done = async (channel: 'sms' | 'email') =>
      Boolean(
        await this.db
          .selectFrom('alert_deliveries')
          .select('id')
          .where('alert_id', '=', alertId)
          .where('emergency_contact_id', '=', c.id)
          .where('channel', '=', channel)
          .where('status', 'in', [...DONE])
          .executeTakeFirst(),
      );
    const enabled = async (channel: 'sms' | 'email') => {
      const v = await this.settings.get<unknown>(`channels.${channel}.enabled`, true);
      return v === true || v === 'true';
    };

    // SMS first (fastest). It counts toward the owner's PREMIUM fair-use limit (NT-05); at the limit the
    // contact gets e-mail only and the owner is informed by the fair-use notice.
    if (c.phone_enc && !(await done('sms'))) {
      const provider = fakeProviders(this.env).sms ? 'dev' : 'twilio';
      const owner = { id: alert.ownerId, email: alert.ownerEmail, lang };
      if (!(await enabled('sms'))) {
        await this.db
          .insertInto('alert_deliveries')
          .values({
            ...base,
            channel: 'sms',
            provider,
            status: 'suppressed',
            suppressed_reason: 'kill_switch',
          })
          .execute();
      } else if (!(await this.fairUse.reserve(owner, 'sms'))) {
        await this.db
          .insertInto('alert_deliveries')
          .values({
            ...base,
            channel: 'sms',
            provider,
            status: 'suppressed',
            suppressed_reason: 'fair_use',
          })
          .execute();
      } else {
        const delivery = await this.db
          .insertInto('alert_deliveries')
          .values({
            ...base,
            channel: 'sms',
            provider,
            cost_micros_eur: Number(await this.settings.get('sms.cost_micros', 100_000)),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        try {
          const { messageId } = await this.sms.send({
            to: this.crypto.decrypt(c.phone_enc),
            body: smsLinkText(lang, 'escalation', type, alert.nickname, url),
            tag: 'sms_escalation',
          });
          await this.db
            .updateTable('alert_deliveries')
            .set({ status: 'sent', sent_at: sql`now()`, provider_message_id: messageId })
            .where('id', '=', delivery.id)
            .execute();
        } catch (err) {
          errors.push(err);
          await this.fairUse.release(alert.ownerId, 'sms');
          await this.db
            .updateTable('alert_deliveries')
            .set({ status: 'failed', error_code: String(err).slice(0, 64) })
            .where('id', '=', delivery.id)
            .execute();
        }
      }
    }

    if (c.address_enc && !(await done('email'))) {
      const provider = fakeProviders(this.env).mail ? 'dev' : this.env.MAIL_PROVIDER;
      if (!(await enabled('email'))) {
        await this.db
          .insertInto('alert_deliveries')
          .values({
            ...base,
            channel: 'email',
            provider,
            status: 'suppressed',
            suppressed_reason: 'kill_switch',
          })
          .execute();
      } else {
        const delivery = await this.db
          .insertInto('alert_deliveries')
          .values({ ...base, channel: 'email', provider, cost_micros_eur: 0 })
          .returning('id')
          .executeTakeFirstOrThrow();
        try {
          // NT-03: incident type and vehicle label only. No plate, no location, no scanner data, no
          // message text, no photo. The button and the opt-out both open /k/<token>.
          await this.mail.send({
            to: this.crypto.decrypt(c.address_enc),
            template: 'escalation',
            locale: lang,
            values: {
              contact: c.display_name,
              owner: alert.display_name ?? '',
              hasOwner: alert.display_name ? 'yes' : 'no',
              nickname: alert.nickname,
              type,
            },
            actionUrl: url,
            links: [
              {
                label:
                  lang === 'en'
                    ? 'Stop receiving notifications'
                    : 'Keine Benachrichtigungen mehr erhalten',
                url: `${url}?abmelden=1`,
              },
            ],
          });
          await this.db
            .updateTable('alert_deliveries')
            .set({ status: 'sent', sent_at: sql`now()` })
            .where('id', '=', delivery.id)
            .execute();
        } catch (err) {
          errors.push(err);
          await this.db
            .updateTable('alert_deliveries')
            .set({ status: 'failed', error_code: String(err).slice(0, 64) })
            .where('id', '=', delivery.id)
            .execute();
        }
      }
    }
    this.logger.info({ step, failed: errors.length }, 'alert escalated');
    if (errors.length) throw errors[0]; // outbox retries; channels already sent are skipped
  }
}
