import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { sha256 } from '../core/crypto';
import { DB, ENV } from '../core/tokens';
import { MailService } from '../mail/mail.service';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The emergency contact's side of an escalation (/k/<token>, no account). The link carries "Ich komme"
 * and "Keine Benachrichtigungen mehr erhalten". Opening it changes nothing (mail scanners); only the tap
 * (POST) does. The first "Ich komme" (owner or contact) acknowledges the alert and ends the chain.
 */
@Injectable()
export class ContactLinkService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private async resolve(token: string) {
    if (!TOKEN.test(token)) return null;
    return this.db
      .selectFrom('alert_deliveries as d')
      .innerJoin('alerts as a', 'a.id', 'd.alert_id')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('users as u', 'u.id', 'v.owner_user_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .leftJoin('emergency_contacts as c', 'c.id', 'd.emergency_contact_id')
      .select([
        'a.id as alertId',
        'a.status',
        'a.created_at',
        'a.expires_at',
        'a.owner_reply',
        'a.acknowledged_by',
        'd.escalation_step as step',
        'd.emergency_contact_id as contactId',
        'c.display_name as contactName',
        'v.nickname',
        'u.email as ownerEmail',
        'u.preferred_lang',
        't.label_de',
        't.label_en',
      ])
      .where('d.ack_token_hash', '=', sha256(token))
      .limit(1)
      .executeTakeFirst();
  }

  /** What /k/<token> shows: the type and vehicle label only (no plate, no scanner text, no photo). */
  async preview(token: string) {
    const r = await this.resolve(token);
    if (!r) throw new NotFoundException({ error: 'link_invalid' });
    return {
      type: { de: r.label_de, en: r.label_en },
      nickname: r.nickname,
      createdAt: r.created_at,
      lang: r.preferred_lang,
      expired: r.expires_at < new Date(),
      acknowledged: r.owner_reply === 'coming' || r.acknowledged_by !== null,
      acknowledgedByMe: r.step !== null && r.acknowledged_by === `contact_${r.step}`,
      subscribed: r.contactId !== null,
    };
  }

  /** "Ich komme" from contact N: acknowledges the alert atomically (single use for everyone). */
  async acknowledge(token: string): Promise<{ acknowledged: true }> {
    const r = await this.resolve(token);
    if (!r?.step) throw new NotFoundException({ error: 'link_invalid' });
    if (r.expires_at < new Date()) throw new GoneException({ error: 'link_expired' });
    const by = `contact_${Math.min(Math.max(r.step, 1), 3)}`;
    const row = await this.db
      .updateTable('alerts')
      .set({
        status: 'acknowledged',
        owner_reply: 'coming',
        acknowledged_by: by,
        acknowledged_at: sql`coalesce(acknowledged_at, now())`,
        ack_token_hash: null,
        escalate_at: null,
      })
      .where('id', '=', r.alertId)
      .where('acknowledged_by', 'is', null)
      .where((eb) => eb.or([eb('owner_reply', 'is', null), eb('owner_reply', '<>', 'coming')]))
      .where('status', 'in', ['dispatched', 'delivered', 'acknowledged', 'escalated'])
      .where('expires_at', '>', sql<Date>`now()`)
      .returning('id')
      .executeTakeFirst();
    if (!row) throw new ConflictException({ error: 'already_answered' });
    return { acknowledged: true };
  }

  /** Opt-out from an escalation message: deletes the contact and tells the owner. */
  async optOut(token: string): Promise<{ removed: true }> {
    const r = await this.resolve(token);
    if (!r) throw new NotFoundException({ error: 'link_invalid' });
    if (r.contactId) {
      const removed = await this.db
        .deleteFrom('emergency_contacts')
        .where('id', '=', r.contactId)
        .executeTakeFirst();
      if (Number(removed.numDeletedRows)) {
        await this.mail.send({
          to: r.ownerEmail,
          template: 'ec_decided',
          locale: r.preferred_lang,
          values: { contact: r.contactName ?? '', decision: 'withdrawn' },
          actionUrl: `${this.env.WEB_BASE_URL}/konto/notfallkontakte`,
        });
      }
    }
    return { removed: true };
  }
}
