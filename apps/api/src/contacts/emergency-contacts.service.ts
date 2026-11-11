import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { AuthContext } from '../auth/session.service';
import { EntitlementService } from '../billing/entitlements.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { randomToken, sha256, type FieldCrypto } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB, ENV } from '../core/tokens';
import type { ConsentState } from '../db/types.generated';
import { MailService } from '../mail/mail.service';

const PENDING_DAYS = 14;

const normalizeEmail = (e: string) => e.trim().toLowerCase();
const maskEmail = (e: string) => {
  const [local = '', domain = ''] = e.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
};

/**
 * Emergency contacts (OW-07, US-24). Nobody is contacted before they agree themselves: the invitation
 * link (256-bit token, hash only) leads to a page where the contact accepts or declines, and later
 * withdraws. Unanswered and declined invitations are deleted after 14 days by run_retention().
 * MVP channel: e-mail (WhatsApp for contacts needs its own opt-in template).
 */
@Injectable()
export class EmergencyContactsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async list(userId: string) {
    const [rows, owner, ent] = await Promise.all([
      this.db
        .selectFrom('emergency_contacts as c')
        .leftJoin('vehicles as v', 'v.id', 'c.vehicle_id')
        .select([
          'c.id',
          'c.display_name',
          'c.address_enc',
          'c.vehicle_id',
          'v.nickname',
          'c.consent',
          'c.consent_requested_at',
          'c.consent_decided_at',
        ])
        .where('c.user_id', '=', userId)
        .orderBy('c.created_at')
        .execute(),
      this.db
        .selectFrom('users')
        .select(['display_name', 'escalation_minutes'])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow(),
      this.entitlements.current(userId),
    ]);
    return {
      limit: ent?.limits.emergency_contacts ?? 0,
      ownerName: owner.display_name,
      // OW-07: the owner's delay (3–30 min) or null for the default.
      escalationMinutes: owner.escalation_minutes,
      defaultEscalationMinutes: Number(await this.settings.get('escalation.default_minutes', 7)),
      contacts: rows.map((r) => ({
        id: r.id,
        name: r.display_name,
        email: maskEmail(this.crypto.decrypt(r.address_enc)),
        vehicleId: r.vehicle_id,
        vehicleNickname: r.nickname,
        status: r.consent,
        requestedAt: r.consent_requested_at,
        decidedAt: r.consent_decided_at,
        expiresAt:
          r.consent === 'pending'
            ? new Date(r.consent_requested_at.getTime() + PENDING_DAYS * 86_400_000)
            : null,
      })),
    };
  }

  async invite(
    user: AuthContext,
    input: { name: string; email: string; vehicleId?: string | null; ownerName: string },
  ) {
    const ent = await this.entitlements.require(user.userId);
    const email = normalizeEmail(input.email);
    if (email === normalizeEmail(user.email))
      throw new BadRequestException({ error: 'contact_is_self' });
    if (input.vehicleId) {
      const v = await this.db
        .selectFrom('vehicles')
        .select('id')
        .where('id', '=', input.vehicleId)
        .where('owner_user_id', '=', user.userId)
        .executeTakeFirst();
      if (!v) throw new NotFoundException({ error: 'vehicle_not_found' });
    }
    const bidx = this.crypto.blindIndex(email);
    const token = randomToken();

    await this.db.transaction().execute(async (trx) => {
      // Serialise invitations per owner so the plan limit cannot be overshot.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'ec:' + user.userId}))`.execute(trx);
      const existing = await trx
        .selectFrom('emergency_contacts')
        .select(['id', 'consent'])
        .where('user_id', '=', user.userId)
        .where('address_bidx', '=', bidx)
        .executeTakeFirst();
      if (existing && existing.consent !== 'declined') {
        throw new ConflictException({ error: 'contact_exists' });
      }
      if (existing)
        await trx.deleteFrom('emergency_contacts').where('id', '=', existing.id).execute();
      const { n } = await trx
        .selectFrom('emergency_contacts')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('user_id', '=', user.userId)
        .where('consent', 'in', ['pending', 'confirmed'])
        .executeTakeFirstOrThrow();
      if (Number(n) >= ent.limits.emergency_contacts) {
        throw new ConflictException({
          error: 'contact_limit',
          limit: ent.limits.emergency_contacts,
          plan: ent.plan,
        });
      }
      await this.limits.enforce('contact.invite', user.userId);
      await trx
        .updateTable('users')
        .set({ display_name: input.ownerName.trim() })
        .where('id', '=', user.userId)
        .execute();
      await trx
        .insertInto('emergency_contacts')
        .values({
          user_id: user.userId,
          vehicle_id: input.vehicleId ?? null,
          display_name: input.name.trim(),
          channel: 'email',
          address_enc: this.crypto.encrypt(email),
          address_bidx: bidx,
          key_version: this.crypto.keyVersion,
          escalation_order: Number(n) + 1,
          consent_token_hash: sha256(token),
        })
        .execute();
    });

    await this.mail.send({
      to: email,
      template: 'ec_invite',
      locale: user.preferredLang,
      values: { contact: input.name.trim(), owner: input.ownerName.trim() },
      actionUrl: `${this.env.WEB_BASE_URL}/notfallkontakt#t=${token}`,
    });
    return this.list(user.userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    const r = await this.db
      .deleteFrom('emergency_contacts')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!Number(r.numDeletedRows)) throw new NotFoundException();
  }

  // --- the contact's side (no account) -------------------------------------------------------

  private byToken(token: string) {
    return this.db
      .selectFrom('emergency_contacts as c')
      .innerJoin('users as u', 'u.id', 'c.user_id')
      .leftJoin('vehicles as v', 'v.id', 'c.vehicle_id')
      .select([
        'c.id',
        'c.display_name',
        'c.consent',
        'u.id as ownerId',
        'u.email as ownerEmail',
        'u.display_name as ownerName',
        'u.preferred_lang',
        'v.nickname',
      ])
      .where('c.consent_token_hash', '=', sha256(token))
      .executeTakeFirst();
  }

  async invitation(token: string) {
    const c = await this.byToken(token);
    if (!c) throw new NotFoundException({ error: 'invitation_invalid' });
    return {
      contactName: c.display_name,
      ownerName: c.ownerName,
      vehicleNickname: c.nickname,
      status: c.consent,
      lang: c.preferred_lang,
    };
  }

  /** accept / decline a pending invitation, or withdraw later. Withdrawing deletes the contact. */
  async decide(
    token: string,
    decision: 'accept' | 'decline' | 'withdraw',
  ): Promise<{ status: ConsentState | 'removed' }> {
    const c = await this.byToken(token);
    if (!c) throw new NotFoundException({ error: 'invitation_invalid' });
    let status: ConsentState | 'removed';
    if (decision === 'withdraw') {
      if (c.consent !== 'confirmed') throw new ConflictException({ error: 'not_confirmed' });
      await this.db.deleteFrom('emergency_contacts').where('id', '=', c.id).execute();
      status = 'removed';
    } else {
      if (c.consent !== 'pending')
        throw new ConflictException({ error: 'already_decided', status: c.consent });
      status = decision === 'accept' ? 'confirmed' : 'declined';
      await this.db
        .updateTable('emergency_contacts')
        .set({ consent: status, consent_decided_at: sql`now()` })
        .where('id', '=', c.id)
        .where('consent', '=', 'pending')
        .execute();
    }
    await this.mail.send({
      to: c.ownerEmail,
      template: 'ec_decided',
      locale: c.preferred_lang,
      values: { contact: c.display_name, decision: status === 'removed' ? 'withdrawn' : status },
      actionUrl: `${this.env.WEB_BASE_URL}/konto/notfallkontakte`,
    });
    return { status };
  }
}
