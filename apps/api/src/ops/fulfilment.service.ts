import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DecalTemplate } from '@parkshield/shared';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB, ENV } from '../core/tokens';
import type { OrderStatus, PartnerKind } from '../db/types.generated';
import { layoutDecal } from '../decal/layout';
import { renderPrintBatchPdf } from '../decal/pdf';
import { MailService } from '../mail/mail.service';
import { OrdersService, PRINT_TOPIC } from '../orders/orders.service';
import type { ShippingAddress } from '../providers/ports';
import { TokensService } from '../vehicles/tokens.service';
import { maskAddress, maskEmail } from './mask';
import { StaffService, type StaffContext } from './staff.service';

export const ORDER_FILTERS = ['open', 'attention', 'shipped', 'returned', 'all'] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number];
export const MAX_BATCH = 1000;

/**
 * US-39 / AD-07: order pipeline (Generated → Printed → Shipped → Activated), returned shipments,
 * reprints with address correction through break-glass, partners and pre-printed batches.
 * Staff never see a decal code or a full address here.
 */
@Injectable()
export class FulfilmentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private orderQuery() {
    return this.db
      .selectFrom('decal_orders as o')
      .innerJoin('decal_order_items as i', 'i.order_id', 'o.id')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .leftJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .leftJoin('users as u', 'u.id', 'o.user_id')
      .select([
        'o.id',
        'o.status',
        'o.created_at as createdAt',
        'o.shipped_at as shippedAt',
        'o.delivered_at as deliveredAt',
        'o.returned_at as returnedAt',
        'o.tracking_number as trackingNumber',
        'o.print_partner_ref as printRef',
        'o.total_gross_cents as totalCents',
        'o.included_in_plan as included',
        'o.is_replacement as replacement',
        'o.reprint_of as reprintOf',
        'o.ops_note as note',
        'i.product',
        't.code_hint as codeHint',
        't.status as tokenStatus',
        'v.nickname',
        'u.id as customerId',
        'u.email',
      ]);
  }

  private present(
    r: Awaited<ReturnType<ReturnType<FulfilmentService['orderQuery']>['execute']>>[number],
  ) {
    const { email, ...rest } = r;
    return { ...rest, customer: email ? maskEmail(email) : null };
  }

  async listOrders(by: StaffContext, filter: OrderFilter) {
    let q = this.orderQuery();
    if (filter === 'open') q = q.where('o.status', 'in', ['paid', 'in_production', 'shipped']);
    if (filter === 'shipped') q = q.where('o.status', 'in', ['shipped', 'delivered']);
    if (filter === 'returned') q = q.where('o.status', '=', 'returned');
    // Waiting too long: paid but not with the printer after a day, or shipped two weeks ago.
    if (filter === 'attention')
      q = q.where((eb) =>
        eb.or([
          eb.and([
            eb('o.status', '=', 'paid'),
            eb('o.created_at', '<', sql<Date>`now() - interval '24 hours'`),
          ]),
          eb.and([
            eb('o.status', '=', 'in_production'),
            eb('o.created_at', '<', sql<Date>`now() - interval '5 days'`),
          ]),
          eb('o.status', '=', 'returned'),
        ]),
      );
    const rows = await q.orderBy('o.created_at', 'desc').limit(200).execute();
    await this.staff.auditRead(by.userId, 'orders.list', 'decal_orders', null, { filter });
    return { orders: rows.map((r) => this.present(r)) };
  }

  async getOrder(by: StaffContext, orderId: string) {
    const row = await this.orderQuery()
      .select(['o.shipping_address_enc'])
      .where('o.id', '=', orderId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException({ error: 'order_not_found' });
    const { shipping_address_enc, ...order } = row;
    const reprints = await this.db
      .selectFrom('decal_orders')
      .select(['id', 'status', 'created_at as createdAt'])
      .where('reprint_of', '=', orderId)
      .orderBy('created_at')
      .execute();
    await this.staff.auditRead(by.userId, 'order.view', 'decal_orders', orderId);
    return {
      order: {
        ...this.present(order),
        address: shipping_address_enc.length
          ? maskAddress(this.crypto.decrypt(shipping_address_enc))
          : null,
      },
      reprints,
    };
  }

  async markShipped(by: StaffContext, orderId: string, trackingNumber: string) {
    if (!(await this.orders.markShipped(orderId, trackingNumber)))
      throw new ConflictException({ error: 'wrong_status' });
    await this.staff.audit(by.userId, 'order.shipped', 'decal_orders', orderId);
  }

  async markDelivered(by: StaffContext, orderId: string) {
    if (!(await this.orders.markDelivered(orderId)))
      throw new ConflictException({ error: 'wrong_status' });
    await this.staff.audit(by.userId, 'order.delivered', 'decal_orders', orderId);
  }

  /** The parcel came back: the customer is told and asked to check the address with support. */
  async markReturned(by: StaffContext, orderId: string, note: string) {
    const r = await this.db
      .updateTable('decal_orders')
      .set({ status: 'returned', returned_at: sql`now()`, ops_note: note })
      .where('id', '=', orderId)
      .where('status', 'in', ['shipped', 'delivered'])
      .returning('user_id')
      .executeTakeFirst();
    if (!r) throw new ConflictException({ error: 'wrong_status' });
    await this.staff.audit(by.userId, 'order.returned', 'decal_orders', orderId, { note });
    if (!r.user_id) return;
    const owner = await this.db
      .selectFrom('decal_order_items as i')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .innerJoin('users as u', 'u.id', 'v.owner_user_id')
      .select(['u.email', 'u.preferred_lang', 'v.nickname', 'v.id as vehicleId'])
      .where('i.order_id', '=', orderId)
      .executeTakeFirst();
    if (!owner) return;
    await this.mail.send({
      to: owner.email,
      template: 'decal_returned',
      locale: owner.preferred_lang,
      values: { nickname: owner.nickname },
      actionUrl: `${this.env.WEB_BASE_URL}/hilfe/kontakt`,
    });
  }

  /**
   * Reprint for a lost, damaged or returned decal: a free order for the same code. A new address
   * needs a valid break-glass grant on this order's address (AD-07: "address correction via
   * break-glass"); otherwise the stored, still encrypted address is reused without decrypting it.
   */
  async reprint(
    by: StaffContext,
    orderId: string,
    input: { reason: string; address?: ShippingAddress },
  ) {
    const old = await this.db
      .selectFrom('decal_orders as o')
      .innerJoin('decal_order_items as i', 'i.order_id', 'o.id')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .select([
        'o.user_id',
        'o.status',
        'o.shipping_address_enc',
        'i.product',
        'i.qr_token_id as tokenId',
        't.status as tokenStatus',
      ])
      .where('o.id', '=', orderId)
      .executeTakeFirst();
    if (!old) throw new NotFoundException({ error: 'order_not_found' });
    if (old.tokenStatus === 'revoked') throw new ConflictException({ error: 'token_revoked' });
    if (old.status === 'pending_payment' || old.status === 'canceled')
      throw new ConflictException({ error: 'wrong_status' });

    let addressEnc = old.shipping_address_enc;
    if (input.address) {
      const grant = await this.db
        .selectFrom('break_glass_requests')
        .select('id')
        .where('requester_id', '=', by.userId)
        .where('target_entity', '=', 'decal_orders.shipping_address')
        .where('target_id', '=', orderId)
        .where('status', '=', 'approved')
        .where('valid_until', '>', sql<Date>`now()`)
        .executeTakeFirst();
      if (!grant) throw new ForbiddenException({ error: 'break_glass_required' });
      addressEnc = this.crypto.encrypt(JSON.stringify(input.address));
    }
    if (!addressEnc.length) throw new ConflictException({ error: 'address_missing' });

    const id = await this.db.transaction().execute(async (trx) => {
      const o = await trx
        .insertInto('decal_orders')
        .values({
          user_id: old.user_id,
          status: 'paid',
          shipping_address_enc: addressEnc,
          key_version: this.crypto.keyVersion,
          total_gross_cents: 0,
          is_replacement: true,
          reprint_of: orderId,
          ops_note: input.reason,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('decal_order_items')
        .values({
          order_id: o.id,
          qr_token_id: old.tokenId,
          product: old.product,
          unit_gross_cents: 0,
        })
        .execute();
      await trx
        .insertInto('outbox_events')
        .values({ topic: PRINT_TOPIC, payload: JSON.stringify({ orderId: o.id }) })
        .execute();
      return o.id;
    });
    await this.staff.audit(by.userId, 'order.reprint', 'decal_orders', id, {
      reprintOf: orderId,
      reason: input.reason,
      addressCorrected: Boolean(input.address),
    });
    return { id };
  }

  // ---------------------------------------------------------------- partners

  async partners() {
    const rows = await this.db
      .selectFrom('partners as p')
      .select((eb) => [
        'p.id',
        'p.name',
        'p.kind',
        'p.contact_email as contactEmail',
        'p.commission_pct as commissionPct',
        'p.is_active as active',
        'p.created_at as createdAt',
        eb
          .selectFrom('token_batches as b')
          .select((e) => e.fn.coalesce(e.fn.sum<string>('b.quantity'), sql<string>`0`).as('n'))
          .whereRef('b.partner_id', '=', 'p.id')
          .as('codes'),
        eb
          .selectFrom('qr_tokens as t')
          .innerJoin('token_batches as b', 'b.id', 't.batch_id')
          .select((e) => e.fn.countAll<string>().as('n'))
          .whereRef('b.partner_id', '=', 'p.id')
          .where('t.vehicle_id', 'is not', null)
          .as('claimed'),
        eb
          .selectFrom('promo_redemptions as r')
          .innerJoin('promo_codes as c', 'c.id', 'r.promo_code_id')
          .select((e) => e.fn.countAll<string>().as('n'))
          .whereRef('c.partner_id', '=', 'p.id')
          .as('redemptions'),
      ])
      .orderBy('p.name')
      .execute();
    return {
      partners: rows.map((r) => ({
        ...r,
        commissionPct: Number(r.commissionPct),
        codes: Number(r.codes ?? 0),
        claimed: Number(r.claimed ?? 0),
        redemptions: Number(r.redemptions ?? 0),
      })),
    };
  }

  async createPartner(
    by: StaffContext,
    input: { name: string; kind: PartnerKind; contactEmail?: string; commissionPct: number },
  ) {
    const p = await this.db
      .insertInto('partners')
      .values({
        name: input.name,
        kind: input.kind,
        contact_email: input.contactEmail || null,
        commission_pct: String(input.commissionPct),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.staff.audit(by.userId, 'partner.create', 'partners', p.id, { name: input.name });
    return { id: p.id };
  }

  async setPartnerActive(by: StaffContext, partnerId: string, active: boolean) {
    const r = await this.db
      .updateTable('partners')
      .set({ is_active: active })
      .where('id', '=', partnerId)
      .executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new NotFoundException({ error: 'partner_not_found' });
    await this.staff.audit(
      by.userId,
      active ? 'partner.activate' : 'partner.deactivate',
      'partners',
      partnerId,
    );
  }

  // ---------------------------------------------------------------- batches

  async batches() {
    const rows = await this.db
      .selectFrom('token_batches as b')
      .leftJoin('partners as p', 'p.id', 'b.partner_id')
      .leftJoin('promo_codes as c', 'c.id', 'b.promo_code_id')
      .select((eb) => [
        'b.id',
        'b.quantity',
        'b.status',
        'b.note',
        'b.created_at as createdAt',
        'b.printed_at as printedAt',
        'b.shipped_at as shippedAt',
        'p.name as partner',
        'c.code as promoCode',
        eb
          .selectFrom('qr_tokens as t')
          .select((e) => e.fn.countAll<string>().as('n'))
          .whereRef('t.batch_id', '=', 'b.id')
          .where('t.vehicle_id', 'is not', null)
          .as('claimed'),
        eb
          .selectFrom('qr_tokens as t')
          .select((e) => e.fn.countAll<string>().as('n'))
          .whereRef('t.batch_id', '=', 'b.id')
          .where('t.status', '=', 'active')
          .as('active'),
      ])
      .orderBy('b.created_at', 'desc')
      .execute();
    return {
      batches: rows.map((r) => ({
        ...r,
        claimed: Number(r.claimed ?? 0),
        active: Number(r.active ?? 0),
      })),
    };
  }

  async createBatch(
    by: StaffContext,
    input: { partnerId: string; promoCodeId?: string; quantity: number; note?: string },
  ) {
    const partner = await this.db
      .selectFrom('partners')
      .select(['id', 'is_active'])
      .where('id', '=', input.partnerId)
      .executeTakeFirst();
    if (!partner?.is_active) throw new NotFoundException({ error: 'partner_not_found' });
    if (input.promoCodeId) {
      const promo = await this.db
        .selectFrom('promo_codes')
        .select('id')
        .where('id', '=', input.promoCodeId)
        .executeTakeFirst();
      if (!promo) throw new NotFoundException({ error: 'promo_not_found' });
    }
    const id = await this.db.transaction().execute(async (trx) => {
      const b = await trx
        .insertInto('token_batches')
        .values({
          partner_id: input.partnerId,
          promo_code_id: input.promoCodeId ?? null,
          quantity: input.quantity,
          note: input.note || null,
          created_by: by.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (let i = 0; i < input.quantity; i++) await this.tokens.issue(trx, null, b.id);
      return b.id;
    });
    await this.staff.audit(by.userId, 'batch.create', 'token_batches', id, {
      quantity: input.quantity,
      partnerId: input.partnerId,
    });
    return { id };
  }

  /** The print file holds every code of the batch, so producing it is logged like a decryption. */
  async batchPrintFile(by: StaffContext, batchId: string): Promise<Buffer> {
    const tokens = await this.db
      .selectFrom('qr_tokens')
      .select(['code_enc', 'cta_header', 'design_template_id'])
      .where('batch_id', '=', batchId)
      .where('vehicle_id', 'is', null)
      .where('status', '<>', 'revoked')
      .orderBy('created_at')
      .execute();
    if (!tokens.length) throw new NotFoundException({ error: 'batch_empty' });
    const specs = tokens.map((t) =>
      layoutDecal({
        code: this.tokens.decrypt(t.code_enc),
        scannerBaseUrl: this.env.SCANNER_BASE_URL,
        template: t.design_template_id as DecalTemplate,
        cta: t.cta_header,
        product: 'uv_vinyl_sticker',
      }),
    );
    await this.staff.auditRead(by.userId, 'batch.print_file', 'token_batches', batchId, {
      codes: tokens.length,
    });
    return renderPrintBatchPdf(specs, `ParkShield batch ${batchId}`);
  }

  async advanceBatch(by: StaffContext, batchId: string, to: 'printed' | 'shipped') {
    const from = to === 'printed' ? 'generated' : 'printed';
    const tokenFrom: ('generated' | 'printed')[] =
      to === 'printed' ? ['generated'] : ['generated', 'printed'];
    const ok = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('token_batches')
        .set({
          status: to,
          ...(to === 'printed' ? { printed_at: sql`now()` } : { shipped_at: sql`now()` }),
        })
        .where('id', '=', batchId)
        .where('status', '=', from)
        .executeTakeFirst();
      if (!Number(r.numUpdatedRows)) return false;
      await trx
        .updateTable('qr_tokens')
        .set({ status: to })
        .where('batch_id', '=', batchId)
        .where('vehicle_id', 'is', null)
        .where('status', 'in', tokenFrom)
        .execute();
      return true;
    });
    if (!ok) throw new ConflictException({ error: 'wrong_status' });
    await this.staff.audit(by.userId, `batch.${to}`, 'token_batches', batchId);
  }
}

export const ORDER_STATUSES: OrderStatus[] = [
  'pending_payment',
  'paid',
  'in_production',
  'shipped',
  'delivered',
  'returned',
  'canceled',
  'refunded',
];
