import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { AuthContext } from '../auth/session.service';
import { EntitlementService } from '../billing/entitlements.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { randomToken, sha256, type FieldCrypto } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB, ENV, LOGGER } from '../core/tokens';
import type { ConsentState } from '../db/types.generated';
import { MailService } from '../mail/mail.service';
import { normalizePhone } from '../channels/channels.service';
import { EscalationService, MAX_CONTACTS } from '../notifications/escalation.service';
import { smsInviteText } from '../notifications/sms-texts';
import { SMS, type SmsSender } from '../providers/ports';

const PENDING_DAYS = 14;
/** After a downgrade, contacts are kept deactivated this long (a re-upgrade restores them). */
export const DEACTIVATED_DAYS = 30;

const normalizeEmail = (e: string) => e.trim().toLowerCase();
const maskEmail = (e: string) => {
  const [local = '', domain = ''] = e.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
};
const maskPhone = (e164: string) => `${e164.slice(0, 3)} ••• ${e164.slice(-4)}`;

/**
 * Emergency contacts ("Vertrauenspersonen", OW-07, US-24), PREMIUM only. Nobody is contacted before
 * they agree themselves: the invitation (SMS, and e-mail when given; 256-bit token, hash only) leads to a
 * page where the contact accepts or declines, and later withdraws. Unanswered and declined invitations
 * are deleted after 14 days, contacts of a downgraded owner 30 days after deactivation (run_retention).
 * Up to three contacts, escalated one after another in the owner's order.
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
    @Inject(SMS) private readonly sms: SmsSender,
    @Inject(EscalationService) private readonly escalation: EscalationService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** PREMIUM with an active subscription, else 403 (the app shows "Verfügbar im Premium-Tarif"). */
  async requirePremium(userId: string) {
    const ent = await this.entitlements.require(userId);
    if (ent.plan !== 'premium') {
      throw new ForbiddenException({ error: 'premium_required', plan: ent.plan });
    }
    return ent;
  }

  async list(userId: string) {
    const [rows, owner, ent] = await Promise.all([
      this.db
        .selectFrom('emergency_contacts as c')
        .leftJoin('vehicles as v', 'v.id', 'c.vehicle_id')
        .select([
          'c.id',
          'c.display_name',
          'c.address_enc',
          'c.phone_enc',
          'c.vehicle_id',
          'v.nickname',
          'c.consent',
          'c.escalation_order',
          'c.consent_requested_at',
          'c.consent_decided_at',
          'c.deactivated_at',
        ])
        .where('c.user_id', '=', userId)
        .orderBy('c.escalation_order')
        .orderBy('c.created_at')
        .execute(),
      this.db
        .selectFrom('users')
        .select(['display_name', 'escalation_minutes', 'escalation_enabled'])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow(),
      this.entitlements.current(userId),
    ]);
    const premium = ent?.plan === 'premium';
    return {
      premium,
      limit: premium ? Math.min(ent.limits.emergency_contacts, MAX_CONTACTS) : 0,
      ownerName: owner.display_name,
      escalationEnabled: owner.escalation_enabled,
      // OW-07: the owner's delay (3–30 min) or null for the default.
      escalationMinutes: owner.escalation_minutes,
      defaultEscalationMinutes: Number(await this.settings.get('escalation.default_minutes', 7)),
      contacts: rows.map((r, i) => ({
        id: r.id,
        position: i + 1,
        name: r.display_name,
        email: r.address_enc ? maskEmail(this.crypto.decrypt(r.address_enc)) : null,
        phone: r.phone_enc ? maskPhone(this.crypto.decrypt(r.phone_enc)) : null,
        vehicleId: r.vehicle_id,
        vehicleNickname: r.nickname,
        status: r.deactivated_at ? 'deactivated' : r.consent,
        requestedAt: r.consent_requested_at,
        decidedAt: r.consent_decided_at,
        expiresAt:
          r.consent === 'pending'
            ? new Date(r.consent_requested_at.getTime() + PENDING_DAYS * 86_400_000)
            : r.deactivated_at
              ? new Date(r.deactivated_at.getTime() + DEACTIVATED_DAYS * 86_400_000)
              : null,
      })),
    };
  }

  async invite(
    user: AuthContext,
    input: {
      name: string;
      phone?: string;
      email?: string;
      vehicleId?: string | null;
      ownerName: string;
    },
  ) {
    const ent = await this.requirePremium(user.userId);
    const limit = Math.min(ent.limits.emergency_contacts, MAX_CONTACTS);
    const phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.phone && !phone) throw new BadRequestException({ error: 'phone_invalid' });
    const email = input.email ? normalizeEmail(input.email) : null;
    if (!phone && !email) throw new BadRequestException({ error: 'contact_unreachable' });
    if (email && email === normalizeEmail(user.email))
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
    // The blind index of the phone (or e-mail) detects the same person twice.
    const phoneBidx = phone ? this.crypto.blindIndex(phone) : null;
    const emailBidx = email ? this.crypto.blindIndex(email) : null;
    const token = randomToken();

    await this.db.transaction().execute(async (trx) => {
      // Serialise invitations per owner so the plan limit cannot be overshot.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'ec:' + user.userId}))`.execute(trx);
      const existing = await trx
        .selectFrom('emergency_contacts')
        .select(['id', 'consent'])
        .where('user_id', '=', user.userId)
        .where((eb) =>
          eb.or([
            ...(phoneBidx ? [eb('phone_bidx', '=', phoneBidx)] : []),
            ...(emailBidx ? [eb('address_bidx', '=', emailBidx)] : []),
          ]),
        )
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
      if (Number(n) >= limit) {
        throw new ConflictException({ error: 'contact_limit', limit, plan: ent.plan });
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
          channel: phone ? 'sms' : 'email',
          address_enc: email ? this.crypto.encrypt(email) : null,
          address_bidx: emailBidx,
          phone_enc: phone ? this.crypto.encrypt(phone) : null,
          phone_bidx: phoneBidx,
          key_version: this.crypto.keyVersion,
          escalation_order: Number(n) + 1,
          consent_token_hash: sha256(token),
        })
        .execute();
    });

    // TODO [LEGAL REVIEW] Invitation text: who asks, what the contact receives, 14-day deletion.
    const url = `${this.env.WEB_BASE_URL}/notfallkontakt#t=${token}`;
    const ownerFirst = input.ownerName.trim().split(/\s+/)[0] ?? '';
    if (phone) {
      await this.sms.send({
        to: phone,
        body: smsInviteText(user.preferredLang, ownerFirst, url),
        tag: 'sms_ec_invite',
      });
    }
    if (email) {
      await this.mail.send({
        to: email,
        template: 'ec_invite',
        locale: user.preferredLang,
        values: { contact: input.name.trim(), owner: input.ownerName.trim() },
        actionUrl: url,
      });
    }
    return this.list(user.userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .deleteFrom('emergency_contacts')
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!Number(r.numDeletedRows)) throw new NotFoundException();
      await this.renumber(trx, userId);
    });
  }

  /** The escalation order (contact 1 → 2 → 3): the owner's list of contact ids, first is called first. */
  async reorder(userId: string, ids: string[]) {
    await this.requirePremium(userId);
    await this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('emergency_contacts')
        .select('id')
        .where('user_id', '=', userId)
        .execute();
      const mine = new Set(rows.map((r) => r.id));
      if (
        ids.length !== mine.size ||
        new Set(ids).size !== ids.length ||
        ids.some((i) => !mine.has(i))
      )
        throw new BadRequestException({ error: 'order_invalid' });
      for (const [i, id] of ids.entries()) {
        await trx
          .updateTable('emergency_contacts')
          .set({ escalation_order: i + 1 })
          .where('id', '=', id)
          .execute();
      }
    });
    return this.list(userId);
  }

  private async renumber(trx: Db, userId: string) {
    const rows = await trx
      .selectFrom('emergency_contacts')
      .select('id')
      .where('user_id', '=', userId)
      .orderBy('escalation_order')
      .orderBy('created_at')
      .execute();
    for (const [i, r] of rows.entries()) {
      await trx
        .updateTable('emergency_contacts')
        .set({ escalation_order: i + 1 })
        .where('id', '=', r.id)
        .execute();
    }
  }

  // --- escalation settings (PREMIUM) ---------------------------------------------------------

  async escalationSettings(userId: string) {
    const ent = await this.entitlements.current(userId);
    const [owner, vehicles, confirmed] = await Promise.all([
      this.db
        .selectFrom('users')
        .select(['escalation_enabled', 'escalation_minutes'])
        .where('id', '=', userId)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('vehicles')
        .select(['id', 'nickname', 'escalation_enabled'])
        .where('owner_user_id', '=', userId)
        .orderBy('created_at')
        .execute(),
      this.db
        .selectFrom('emergency_contacts')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('user_id', '=', userId)
        .where('consent', '=', 'confirmed')
        .where('deactivated_at', 'is', null)
        .executeTakeFirstOrThrow(),
    ]);
    const premium = ent?.plan === 'premium';
    const defaultMinutes = Number(await this.settings.get('escalation.default_minutes', 7));
    return {
      available: premium,
      enabled: premium && owner.escalation_enabled,
      delayMinutes: owner.escalation_minutes ?? defaultMinutes,
      confirmedContacts: Number(confirmed.n),
      // Off until a contact confirmed; then the app suggests switching it on.
      suggestEnable: premium && !owner.escalation_enabled && Number(confirmed.n) > 0,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        nickname: v.nickname,
        // null: follows the global switch.
        enabled: v.escalation_enabled,
      })),
    };
  }

  /**
   * Escalation on/off (globally and per vehicle) and the delay (3–30 min). Switching off cancels the
   * pending steps of open alerts at once; switching on applies to new alerts.
   */
  async saveEscalationSettings(
    userId: string,
    input: {
      enabled?: boolean;
      delayMinutes?: number;
      vehicles?: { id: string; enabled: boolean | null }[];
    },
  ) {
    await this.requirePremium(userId);
    await this.db.transaction().execute(async (trx) => {
      if (input.enabled !== undefined || input.delayMinutes !== undefined) {
        await trx
          .updateTable('users')
          .set({
            ...(input.enabled !== undefined ? { escalation_enabled: input.enabled } : {}),
            ...(input.delayMinutes !== undefined ? { escalation_minutes: input.delayMinutes } : {}),
          })
          .where('id', '=', userId)
          .execute();
      }
      for (const v of input.vehicles ?? []) {
        const r = await trx
          .updateTable('vehicles')
          .set({ escalation_enabled: v.enabled })
          .where('id', '=', v.id)
          .where('owner_user_id', '=', userId)
          .executeTakeFirst();
        if (!Number(r.numUpdatedRows)) throw new NotFoundException({ error: 'vehicle_not_found' });
      }
    });
    if (input.enabled === false) await this.escalation.cancelPending(userId);
    for (const v of input.vehicles ?? []) {
      if (v.enabled === false) await this.escalation.cancelPending(userId, v.id);
    }
    return this.escalationSettings(userId);
  }

  /**
   * Downgrade PREMIUM → PLUS (or the subscription ended): contacts are deactivated (kept 30 days, then
   * deleted by run_retention) and the owner is told once. A re-upgrade within the 30 days restores them.
   * Escalation itself already checks the plan at every step, so it stops at once regardless.
   */
  async syncPlans(): Promise<{ deactivated: number; restored: number }> {
    const premium = sql<boolean>`EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = emergency_contacts.user_id
      AND s.plan = 'premium' AND s.status IN ('active', 'past_due'))`;
    const deactivated = await this.db
      .updateTable('emergency_contacts')
      .set({ deactivated_at: sql`now()` })
      .where('deactivated_at', 'is', null)
      .where(sql<boolean>`NOT ${premium}`)
      .returning(['user_id'])
      .execute();
    const restored = await this.db
      .updateTable('emergency_contacts')
      .set({ deactivated_at: null })
      .where('deactivated_at', 'is not', null)
      .where(premium)
      .returning('id')
      .execute();
    const owners = [...new Set(deactivated.map((r) => r.user_id))];
    if (owners.length) {
      await this.db
        .updateTable('users')
        .set({ escalation_enabled: false })
        .where('id', 'in', owners)
        .execute();
    }
    for (const userId of owners) {
      await this.escalation.cancelPending(userId);
      const u = await this.db
        .selectFrom('users')
        .select(['email', 'preferred_lang'])
        .where('id', '=', userId)
        .executeTakeFirst();
      if (!u) continue;
      await this.mail
        .send({
          to: u.email,
          template: 'ec_deactivated',
          locale: u.preferred_lang,
          values: { until: new Date(Date.now() + DEACTIVATED_DAYS * 86_400_000) },
          actionUrl: `${this.env.WEB_BASE_URL}/konto`,
        })
        .catch((err: unknown) =>
          this.logger.warn({ err: String(err) }, 'ec_deactivated mail failed'),
        );
    }
    return { deactivated: owners.length, restored: restored.length };
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
      await this.db.transaction().execute(async (trx) => {
        await trx.deleteFrom('emergency_contacts').where('id', '=', c.id).execute();
        await this.renumber(trx, c.ownerId);
      });
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
