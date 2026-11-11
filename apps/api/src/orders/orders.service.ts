import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ADDON_PRICES_CENTS, type DecalTemplate } from '@parkshield/shared';
import { sql } from 'kysely';
import { EntitlementService } from '../billing/entitlements.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB, ENV } from '../core/tokens';
import { layoutDecal } from '../decal/layout';
import { renderPrintPdf } from '../decal/pdf';
import { MailService } from '../mail/mail.service';
import {
  PAYMENTS,
  PRINT,
  type Payments,
  type PrintPartner,
  type ShippingAddress,
} from '../providers/ports';
import { TokensService } from '../vehicles/tokens.service';
import { VehiclesService } from '../vehicles/vehicles.service';

export const PRINT_TOPIC = 'print.submit';

/** US-11: the included decal, its print job and shipment tracking. */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(VehiclesService) private readonly vehicles: VehiclesService,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PRINT) private readonly printer: PrintPartner,
    @Inject(PAYMENTS) private readonly payments: Payments,
  ) {}

  /** One decal is included at the first subscription only (OW-04), never again after a later re-subscription. */
  async includedAvailable(userId: string): Promise<boolean> {
    if (!(await this.entitlements.current(userId))) return false;
    const used = await this.db
      .selectFrom('decal_orders')
      .select('id')
      .where('user_id', '=', userId)
      .where('included_in_plan', '=', true)
      .executeTakeFirst();
    return !used;
  }

  /** Free replacements granted by ops (AD-08: code revoked on the owner's behalf). */
  async freeReplacements(userId: string): Promise<number> {
    const u = await this.db
      .selectFrom('users')
      .select('free_replacements')
      .where('id', '=', userId)
      .executeTakeFirst();
    return u?.free_replacements ?? 0;
  }

  async orderIncluded(userId: string, vehicleId: string, address: ShippingAddress) {
    await this.entitlements.require(userId);
    const { token, vehicle } = await this.vehicles.currentToken(userId, vehicleId);
    const orderId = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`.execute(trx);
      const used = await trx
        .selectFrom('decal_orders')
        .select('id')
        .where('user_id', '=', userId)
        .where('included_in_plan', '=', true)
        .executeTakeFirst();
      if (used) throw new ConflictException({ error: 'included_decal_used' });
      const order = await trx
        .insertInto('decal_orders')
        .values({
          user_id: userId,
          status: 'paid',
          shipping_address_enc: this.crypto.encrypt(JSON.stringify(address)),
          key_version: this.crypto.keyVersion,
          total_gross_cents: 0,
          included_in_plan: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('decal_order_items')
        .values({
          order_id: order.id,
          qr_token_id: token.id,
          product: 'uv_vinyl_sticker',
          unit_gross_cents: 0,
        })
        .execute();
      // Sent to the printer by the worker, so a printer outage never blocks or loses the order.
      await trx
        .insertInto('outbox_events')
        .values({ topic: PRINT_TOPIC, payload: JSON.stringify({ orderId: order.id }) })
        .execute();
      return order.id;
    });
    const user = await this.db
      .selectFrom('users')
      .select(['email', 'preferred_lang'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    await this.mail.send({
      to: user.email,
      template: 'order_received',
      locale: user.preferred_lang,
      values: { nickname: vehicle.nickname },
      actionUrl: `${this.env.WEB_BASE_URL}/konto/fahrzeuge/${vehicleId}`,
    });
    return this.get(userId, orderId);
  }

  /** US-13: paid replacement decal (€5.90 incl. shipping), printed only after the payment arrives. */
  async orderReplacement(
    userId: string,
    vehicleId: string,
    address: ShippingAddress,
    locale: 'de' | 'en',
  ) {
    await this.entitlements.require(userId);
    const { token } = await this.vehicles.currentToken(userId, vehicleId);
    const user = await this.db
      .selectFrom('users')
      .select(['stripe_customer_id', 'free_replacements'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const back = `${this.env.WEB_BASE_URL}/konto/fahrzeuge/${vehicleId}`;

    // AD-08: after ops revoked a code on the owner's behalf, the replacement is free.
    if (user.free_replacements > 0) {
      const free = await this.db.transaction().execute(async (trx) => {
        const claimed = await trx
          .updateTable('users')
          .set({ free_replacements: sql`free_replacements - 1` })
          .where('id', '=', userId)
          .where('free_replacements', '>', 0)
          .executeTakeFirst();
        if (!Number(claimed.numUpdatedRows)) return null;
        const o = await trx
          .insertInto('decal_orders')
          .values({
            user_id: userId,
            status: 'paid',
            shipping_address_enc: this.crypto.encrypt(JSON.stringify(address)),
            key_version: this.crypto.keyVersion,
            total_gross_cents: 0,
            is_replacement: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('decal_order_items')
          .values({
            order_id: o.id,
            qr_token_id: token.id,
            product: 'uv_vinyl_sticker',
            unit_gross_cents: 0,
          })
          .execute();
        await trx
          .insertInto('outbox_events')
          .values({ topic: PRINT_TOPIC, payload: JSON.stringify({ orderId: o.id }) })
          .execute();
        return o;
      });
      if (free) return { id: free.id, url: `${back}?order=paid` };
    }

    if (!user.stripe_customer_id) throw new ConflictException({ error: 'no_customer' });
    const amount = ADDON_PRICES_CENTS.replacementDecal;
    const order = await this.db.transaction().execute(async (trx) => {
      const o = await trx
        .insertInto('decal_orders')
        .values({
          user_id: userId,
          status: 'pending_payment',
          shipping_address_enc: this.crypto.encrypt(JSON.stringify(address)),
          key_version: this.crypto.keyVersion,
          total_gross_cents: amount,
          is_replacement: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('decal_order_items')
        .values({
          order_id: o.id,
          qr_token_id: token.id,
          product: 'uv_vinyl_sticker',
          unit_gross_cents: amount,
        })
        .execute();
      return o;
    });
    return this.payments.createPaymentCheckout({
      customerId: user.stripe_customer_id,
      amountCents: amount,
      description: locale === 'en' ? 'ParkShield replacement decal' : 'ParkShield-Ersatzaufkleber',
      locale,
      successUrl: `${back}?order=paid`,
      cancelUrl: `${back}?order=canceled`,
      metadata: { orderId: order.id, userId },
    });
  }

  /** Payment for an order arrived: queue it for printing (idempotent). */
  async markPaid(orderId: string, paymentIntentId: string | null): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('decal_orders')
        .set({ status: 'paid', stripe_payment_intent: paymentIntentId })
        .where('id', '=', orderId)
        .where('status', '=', 'pending_payment')
        .executeTakeFirst();
      if (!Number(r.numUpdatedRows)) return;
      await trx
        .insertInto('outbox_events')
        .values({ topic: PRINT_TOPIC, payload: JSON.stringify({ orderId }) })
        .execute();
    });
  }

  async list(userId: string) {
    const rows = await this.db
      .selectFrom('decal_orders as o')
      .innerJoin('decal_order_items as i', 'i.order_id', 'o.id')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .leftJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .select([
        'o.id',
        'o.status',
        'o.included_in_plan as included',
        'o.tracking_number as trackingNumber',
        'o.created_at as createdAt',
        'o.shipped_at as shippedAt',
        'o.delivered_at as deliveredAt',
        'i.product',
        'v.id as vehicleId',
        'v.nickname',
      ])
      .where('o.user_id', '=', userId)
      .orderBy('o.created_at', 'desc')
      .execute();
    return rows;
  }

  async get(userId: string, orderId: string) {
    const row = (await this.list(userId)).find((o) => o.id === orderId);
    if (!row) throw new NotFoundException({ error: 'order_not_found' });
    return row;
  }

  /** Worker: render the CMYK print file and hand the job to the print partner. */
  async submitToPrinter(orderId: string): Promise<void> {
    const order = await this.db
      .selectFrom('decal_orders as o')
      .innerJoin('decal_order_items as i', 'i.order_id', 'o.id')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .select([
        'o.id',
        'o.status',
        'o.shipping_address_enc',
        'i.product',
        'i.quantity',
        't.id as tokenId',
        't.code_enc',
        't.cta_header',
        't.design_template_id',
      ])
      .where('o.id', '=', orderId)
      .executeTakeFirst();
    if (!order || order.status !== 'paid') return; // already submitted, cancelled, or gone
    const spec = layoutDecal({
      code: this.tokens.decrypt(order.code_enc),
      scannerBaseUrl: this.env.SCANNER_BASE_URL,
      template: order.design_template_id as DecalTemplate,
      cta: order.cta_header,
      product: order.product === 'a6_dashboard_card' ? 'a6_dashboard_card' : 'uv_vinyl_sticker',
    });
    const { reference } = await this.printer.submit({
      orderId,
      product: order.product,
      quantity: order.quantity,
      pdf: await renderPrintPdf(spec, `ParkShield ${orderId}`),
      address: JSON.parse(this.crypto.decrypt(order.shipping_address_enc)) as ShippingAddress,
    });
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('decal_orders')
        .set({ status: 'in_production', print_partner_ref: reference })
        .where('id', '=', orderId)
        .where('status', '=', 'paid')
        .execute();
      await trx
        .updateTable('qr_tokens')
        .set({ status: 'printed' })
        .where('id', '=', order.tokenId)
        .where('status', '=', 'generated')
        .execute();
    });
  }

  /** Print partner callback: shipped with tracking number, e-mailed to the owner (US-11). */
  async markShipped(orderId: string, trackingNumber: string): Promise<boolean> {
    const updated = await this.db
      .updateTable('decal_orders')
      .set({ status: 'shipped', tracking_number: trackingNumber, shipped_at: sql`now()` })
      .where('id', '=', orderId)
      .where('status', 'in', ['paid', 'in_production'])
      .returning('user_id')
      .executeTakeFirst();
    if (!updated?.user_id) return false;
    const item = await this.db
      .selectFrom('decal_order_items as i')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .select(['t.id as tokenId', 'v.id as vehicleId', 'v.nickname'])
      .where('i.order_id', '=', orderId)
      .executeTakeFirstOrThrow();
    await this.db
      .updateTable('qr_tokens')
      .set({ status: 'shipped' })
      .where('id', '=', item.tokenId)
      .where('status', 'in', ['generated', 'printed'])
      .execute();
    const user = await this.db
      .selectFrom('users')
      .select(['email', 'preferred_lang'])
      .where('id', '=', updated.user_id)
      .executeTakeFirstOrThrow();
    await this.mail.send({
      to: user.email,
      template: 'decal_shipped',
      locale: user.preferred_lang,
      values: { nickname: item.nickname, trackingNumber },
      actionUrl: `${this.env.WEB_BASE_URL}/konto/fahrzeuge/${item.vehicleId}`,
    });
    return true;
  }

  /** Delivery date starts the activation reminders (OW-15) and the 90-day address retention. */
  async markDelivered(orderId: string): Promise<boolean> {
    const r = await this.db
      .updateTable('decal_orders')
      .set({ status: 'delivered', delivered_at: sql`now()` })
      .where('id', '=', orderId)
      .where('status', '=', 'shipped')
      .executeTakeFirst();
    return Number(r.numUpdatedRows) > 0;
  }
}
