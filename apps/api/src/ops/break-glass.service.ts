import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { StaffService, type StaffContext } from './staff.service';

export const BREAK_GLASS_MINUTES = 15;

/** The fields that can be opened, one at a time (AD-06). */
export const TARGETS = {
  'vehicles.plate': { de: 'Kennzeichen', en: 'licence plate' },
  'decal_orders.shipping_address': { de: 'Lieferadresse', en: 'shipping address' },
  'contact_channels.whatsapp': { de: 'WhatsApp-Nummer', en: 'WhatsApp number' },
  'emergency_contacts.email': {
    de: 'E-Mail-Adresse Ihres Notfallkontakts',
    en: 'your emergency contact’s e-mail address',
  },
} as const;
export type Target = keyof typeof TARGETS;

/**
 * Four-eyes break-glass decryption (AD-06, US-36): a request with reason and ticket, approved by a
 * second staff member (never the requester, enforced in the database too), valid 15 minutes for that
 * one field. Every reveal is a read in the audit log; the customer is told on the first one.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  /** The ciphertext and its owner, or null when the field does not exist (or is empty). */
  private async locate(
    target: Target,
    id: string,
  ): Promise<{ enc: Buffer; ownerId: string } | null> {
    const db = this.db;
    switch (target) {
      case 'vehicles.plate': {
        const r = await db
          .selectFrom('vehicles')
          .select(['plate_enc', 'owner_user_id'])
          .where('id', '=', id)
          .executeTakeFirst();
        return r?.plate_enc && r.owner_user_id
          ? { enc: r.plate_enc, ownerId: r.owner_user_id }
          : null;
      }
      case 'decal_orders.shipping_address': {
        const r = await db
          .selectFrom('decal_orders')
          .select(['shipping_address_enc', 'user_id'])
          .where('id', '=', id)
          .executeTakeFirst();
        return r?.user_id && r.shipping_address_enc.length
          ? { enc: r.shipping_address_enc, ownerId: r.user_id }
          : null;
      }
      case 'contact_channels.whatsapp': {
        const r = await db
          .selectFrom('contact_channels')
          .select(['address_enc', 'user_id'])
          .where('id', '=', id)
          .where('type', '=', 'whatsapp')
          .executeTakeFirst();
        return r?.address_enc ? { enc: r.address_enc, ownerId: r.user_id } : null;
      }
      case 'emergency_contacts.email': {
        const r = await db
          .selectFrom('emergency_contacts')
          .select(['address_enc', 'user_id'])
          .where('id', '=', id)
          .executeTakeFirst();
        return r ? { enc: r.address_enc, ownerId: r.user_id } : null;
      }
    }
  }

  async request(
    by: StaffContext,
    input: {
      target: Target;
      targetId: string;
      reason: string;
      ticketRef: string;
      notifyCustomer: boolean;
    },
  ) {
    if (!(await this.locate(input.target, input.targetId)))
      throw new NotFoundException({ error: 'field_not_found' });
    const row = await this.db
      .insertInto('break_glass_requests')
      .values({
        requester_id: by.userId,
        target_entity: input.target,
        target_id: input.targetId,
        reason: input.reason.trim(),
        ticket_ref: input.ticketRef.trim(),
        notify_customer: input.notifyCustomer,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.staff.audit(by.userId, 'pii.decrypt_request', input.target, input.targetId, {
      request: row.id,
      ticket: input.ticketRef,
    });
    return { id: row.id };
  }

  async list(by: StaffContext) {
    const rows = await this.db
      .selectFrom('break_glass_requests as b')
      .innerJoin('users as r', 'r.id', 'b.requester_id')
      .leftJoin('users as a', 'a.id', 'b.approver_id')
      .select([
        'b.id',
        'b.target_entity',
        'b.target_id',
        'b.reason',
        'b.ticket_ref',
        'b.status',
        'b.notify_customer',
        'b.approved_at',
        'b.valid_until',
        'b.first_revealed_at',
        'b.created_at',
        'b.requester_id',
        'r.email as requester',
        'a.email as approver',
      ])
      .where((eb) =>
        eb.or([
          eb('b.requester_id', '=', by.userId),
          // Approvers see open requests of others; nobody can approve their own (AD-06).
          ...(by.permissions.has('pii.decrypt_approve')
            ? [eb.and([eb('b.status', '=', 'requested'), eb('b.requester_id', '<>', by.userId)])]
            : []),
        ]),
      )
      .where('b.created_at', '>', sql<Date>`now() - interval '30 days'`)
      .orderBy('b.created_at', 'desc')
      .limit(100)
      .execute();
    const now = new Date();
    return {
      requests: rows.map((r) => ({
        id: r.id,
        target: r.target_entity,
        targetId: r.target_id,
        reason: r.reason,
        ticketRef: r.ticket_ref,
        status:
          r.status === 'approved' && r.valid_until && r.valid_until < now ? 'expired' : r.status,
        notifyCustomer: r.notify_customer,
        approvedAt: r.approved_at,
        validUntil: r.valid_until,
        createdAt: r.created_at,
        mine: r.requester_id === by.userId,
        requester: r.requester,
        approver: r.approver,
      })),
    };
  }

  async decide(by: StaffContext, id: string, approve: boolean) {
    const r = await this.db
      .selectFrom('break_glass_requests')
      .select(['requester_id', 'status', 'target_entity', 'target_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException();
    if (r.requester_id === by.userId) throw new ForbiddenException({ error: 'own_request' });
    if (r.status !== 'requested') throw new ConflictException({ error: 'already_decided' });
    await this.db
      .updateTable('break_glass_requests')
      .set(
        approve
          ? {
              status: 'approved',
              approver_id: by.userId,
              approved_at: sql`now()`,
              valid_until: sql`now() + make_interval(mins => ${BREAK_GLASS_MINUTES})`,
            }
          : { status: 'rejected', approver_id: by.userId },
      )
      .where('id', '=', id)
      .where('status', '=', 'requested')
      .execute();
    await this.staff.audit(
      by.userId,
      approve ? 'pii.decrypt_approve' : 'pii.decrypt_reject',
      r.target_entity,
      r.target_id,
      { request: id },
    );
  }

  /** The requester opens the field while the grant is valid. Logged every time. */
  async reveal(by: StaffContext, id: string) {
    const r = await this.db
      .selectFrom('break_glass_requests')
      .select([
        'requester_id',
        'status',
        'target_entity',
        'target_id',
        'valid_until',
        'first_revealed_at',
        'notify_customer',
        'ticket_ref',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r || r.requester_id !== by.userId) throw new NotFoundException();
    if (r.status !== 'approved' || !r.valid_until || r.valid_until < new Date()) {
      throw new ConflictException({ error: 'not_valid' });
    }
    const target = r.target_entity as Target;
    if (!(target in TARGETS)) throw new BadRequestException();
    const field = await this.locate(target, r.target_id);
    if (!field) throw new NotFoundException({ error: 'field_not_found' });
    const value = this.crypto.decrypt(field.enc);
    await this.staff.auditRead(by.userId, 'pii.decrypt', target, r.target_id, { request: id });

    const first = await this.db
      .updateTable('break_glass_requests')
      .set({ first_revealed_at: sql`now()` })
      .where('id', '=', id)
      .where('first_revealed_at', 'is', null)
      .executeTakeFirst();
    if (Number(first.numUpdatedRows) && r.notify_customer) {
      const owner = await this.db
        .selectFrom('users')
        .select(['email', 'preferred_lang'])
        .where('id', '=', field.ownerId)
        .executeTakeFirst();
      if (owner) {
        await this.mail.send({
          to: owner.email,
          template: 'break_glass_notice',
          locale: owner.preferred_lang,
          values: {
            field: TARGETS[target][owner.preferred_lang],
            when: new Date(),
            ticket: r.ticket_ref ?? '-',
          },
        });
      }
    }
    return { value, validUntil: r.valid_until };
  }
}
