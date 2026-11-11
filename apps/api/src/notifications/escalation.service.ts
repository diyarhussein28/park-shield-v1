import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Logger } from 'pino';
import { fakeProviders, type Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB, ENV, LOGGER } from '../core/tokens';
import type { DB as Schema } from '../db/types.generated';
import { MailService } from '../mail/mail.service';

export const ESCALATE_TOPIC = 'alert.escalate';

/**
 * Escalation to emergency contacts (NT-03, 02-architecture §3 step 8). `escalate_at` is the single
 * source of truth: replies only ever change it, and the conditional UPDATE below (escalated_at IS NULL,
 * a confirmed contact exists) makes a stale or duplicate job harmless.
 */
@Injectable()
export class EscalationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  /** Does the owner have a confirmed emergency contact for this vehicle (or for all vehicles)? */
  async hasContact(
    ownerId: string | null,
    vehicleId: string,
    db: Kysely<Schema> = this.db,
  ): Promise<boolean> {
    if (!ownerId) return false;
    const row = await db
      .selectFrom('emergency_contacts')
      .select('id')
      .where('user_id', '=', ownerId)
      .where('consent', '=', 'confirmed')
      .where((eb) => eb.or([eb('vehicle_id', 'is', null), eb('vehicle_id', '=', vehicleId)]))
      .executeTakeFirst();
    return Boolean(row);
  }

  /** escalate_at for a new alert: only for escalating types with a confirmed contact (step 3). */
  async initialEscalateAt(input: {
    ownerId: string | null;
    vehicleId: string;
    escalates: boolean;
    isTest: boolean;
  }): Promise<Date | null> {
    if (input.isTest || !input.escalates) return null;
    if (!input.ownerId || !(await this.hasContact(input.ownerId, input.vehicleId))) return null;
    // OW-07: the owner's own delay (3–30 min), else the default from settings.
    const owner = await this.db
      .selectFrom('users')
      .select('escalation_minutes')
      .where('id', '=', input.ownerId)
      .executeTakeFirst();
    const minutes =
      owner?.escalation_minutes ?? Number(await this.settings.get('escalation.default_minutes', 7));
    return new Date(Date.now() + minutes * 60_000);
  }

  private dueCondition() {
    return sql<boolean>`escalated_at IS NULL AND escalate_at <= now() AND expires_at > now()
      AND status IN ('dispatched', 'delivered', 'acknowledged')
      AND EXISTS (
        SELECT 1 FROM vehicles v JOIN emergency_contacts c ON c.user_id = v.owner_user_id
         WHERE v.id = alerts.vehicle_id AND c.consent = 'confirmed'
           AND (c.vehicle_id IS NULL OR c.vehicle_id = alerts.vehicle_id))`;
  }

  /** Sweeper (every few seconds): marks due alerts escalated and queues the notification, atomically. */
  async sweep(): Promise<number> {
    const rows = await sql<{ id: string }>`
      WITH due AS (
        UPDATE alerts SET status = 'escalated', escalated_at = now()
         WHERE ${this.dueCondition()}
         RETURNING id)
      INSERT INTO outbox_events (topic, payload)
      SELECT ${ESCALATE_TOPIC}, jsonb_build_object('alertId', id) FROM due
      RETURNING id`.execute(this.db);
    return rows.rows.length;
  }

  /** Outbox handler: escalate if due (immediate "Bin nicht in der Nähe"), then notify the contacts once. */
  async run(alertId: string): Promise<void> {
    await this.db
      .updateTable('alerts')
      .set({ status: 'escalated', escalated_at: sql`now()` })
      .where('id', '=', alertId)
      .where(this.dueCondition())
      .execute();
    await this.notifyContacts(alertId);
  }

  private async notifyContacts(alertId: string): Promise<void> {
    const alert = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('users as u', 'u.id', 'v.owner_user_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .select([
        'a.id',
        'a.vehicle_id',
        'a.escalated_at',
        'v.nickname',
        'u.id as ownerId',
        'u.display_name',
        'u.preferred_lang',
        't.label_de',
        't.label_en',
      ])
      .where('a.id', '=', alertId)
      .executeTakeFirst();
    if (!alert?.escalated_at) return;

    const contacts = await this.db
      .selectFrom('emergency_contacts')
      .select(['id', 'display_name', 'address_enc', 'channel'])
      .where('user_id', '=', alert.ownerId)
      .where('consent', '=', 'confirmed')
      .where((eb) => eb.or([eb('vehicle_id', 'is', null), eb('vehicle_id', '=', alert.vehicle_id)]))
      .orderBy('escalation_order')
      .execute();
    const emailOn = await this.settings.get<unknown>('channels.email.enabled', true);
    const provider = fakeProviders(this.env).mail ? 'dev' : 'brevo';
    const errors: unknown[] = [];

    for (const c of contacts) {
      // Replays never notify a contact twice.
      const done = await this.db
        .selectFrom('alert_deliveries')
        .select('id')
        .where('alert_id', '=', alertId)
        .where('emergency_contact_id', '=', c.id)
        .where('status', 'in', ['sent', 'delivered', 'read'])
        .executeTakeFirst();
      if (done) continue;
      const base = {
        alert_id: alertId,
        recipient: 'emergency_contact' as const,
        emergency_contact_id: c.id,
        channel: 'email' as const,
        provider,
        cost_micros_eur: 0,
      };
      if (!(emailOn === true || emailOn === 'true')) {
        await this.db
          .insertInto('alert_deliveries')
          .values({ ...base, status: 'suppressed', suppressed_reason: 'kill_switch' })
          .execute();
        continue;
      }
      const delivery = await this.db
        .insertInto('alert_deliveries')
        .values(base)
        .returning('id')
        .executeTakeFirstOrThrow();
      try {
        // NT-03: incident type and vehicle nickname only. No location, no scanner data, no message text.
        await this.mail.send({
          to: this.crypto.decrypt(c.address_enc),
          template: 'escalation',
          locale: alert.preferred_lang,
          values: {
            contact: c.display_name,
            owner: alert.display_name ?? '',
            hasOwner: alert.display_name ? 'yes' : 'no',
            nickname: alert.nickname,
            type: alert.preferred_lang === 'en' ? alert.label_en : alert.label_de,
          },
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
    this.logger.info({ contacts: contacts.length, failed: errors.length }, 'alert escalated');
    if (errors.length) throw errors[0]; // outbox retries; contacts already notified are skipped
  }
}
