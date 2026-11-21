import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ADDON_PRICES_CENTS, type DecalTemplate } from '@parkshield/shared';
import { sql } from 'kysely';
import { EntitlementService } from '../billing/entitlements.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
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
import { returnUrls } from '../billing/app-return';

export const PRINT_TOPIC = 'print.submit';

/** US-11: printed decals (welcome print, paid prints), print jobs and shipment tracking. */
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
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /**
   * The free welcome print (owner decision 2026-11-21): one printed and shipped decal is included in
   * the first year's subscription, once per account (`users.free_welcome_print_used`).
   */
  async includedAvailable(userId: string): Promise<boolean> {
    if (!(await this.entitlements.current(userId))) return false;
    const u = await this.db
      .selectFrom('users')
      .select('free_welcome_print_used')
      .where('id', '=', userId)
      .executeTakeFirst();
    return u ? !u.free_welcome_print_used : false;
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

  /** Price of a printed and shipped decal after the welcome print (setting, default 3 €). */
  async printPrice(): Promise<number> {
    return Number(
      await this.settings.get('prices.print_shipped_cents', ADDON_PRICES_CENTS.printShipped),
    );
  }

  /**
   * The print options screen: self-printing is always free; printing and shipping is free once (the
   * welcome print or an ops-granted replacement), then it costs `prices.print_shipped_cents`.
   */
  async printOptions(userId: string) {
    const [welcome, granted, price] = await Promise.all([
      this.includedAvailable(userId),
      this.freeReplacements(userId),
      this.printPrice(),
    ]);
    const free = welcome || granted > 0;
    return {
      selfPrint: { priceCents: 0 },
      shipped: { priceCents: free ? 0 : price, free, welcomePrint: welcome },
    };
  }

  /**
   * „Drucken und zusenden lassen“: free once (the welcome print, or a replacement ops granted), after
   * that a one-time Stripe payment (3 € incl. VAT by default) and printed once the payment arrives.
   * Returns `{ id, url }` for a free order (url = where to go next) or the checkout `{ url }`.
   */
  async orderPrint(
    userId: string,
    vehicleId: string,
    address: ShippingAddress,
    locale: 'de' | 'en',
    appReturn?: string,
  ): Promise<{ id?: string; url: string; free: boolean }> {
    await this.entitlements.require(userId);
    const { token, vehicle } = await this.vehicles.currentToken(userId, vehicleId);
    const page = `${this.env.WEB_BASE_URL}/konto/fahrzeuge/${vehicleId}`;
    // Website: back to the vehicle page; native app: through the bounce page into the app.
    const back = returnUrls(this.env, 'order', appReturn, {
      success: `${page}?order=paid`,
      cancel: `${page}?order=canceled`,
    });

    const freeId = await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`.execute(trx);
      // The welcome print first (once per account), then a replacement ops granted (AD-08).
      const welcome = await trx
        .updateTable('users')
        .set({ free_welcome_print_used: true })
        .where('id', '=', userId)
        .where('free_welcome_print_used', '=', false)
        .executeTakeFirst();
      let kind: 'welcome' | 'granted' | null = Number(welcome.numUpdatedRows) ? 'welcome' : null;
      if (!kind) {
        const granted = await trx
          .updateTable('users')
          .set({ free_replacements: sql`free_replacements - 1` })
          .where('id', '=', userId)
          .where('free_replacements', '>', 0)
          .executeTakeFirst();
        if (Number(granted.numUpdatedRows)) kind = 'granted';
      }
      if (!kind) return null;
      const o = await trx
        .insertInto('decal_orders')
        .values({
          user_id: userId,
          status: 'paid',
          shipping_address_enc: this.crypto.encrypt(JSON.stringify(address)),
          key_version: this.crypto.keyVersion,
          total_gross_cents: 0,
          included_in_plan: kind === 'welcome',
          is_replacement: kind === 'granted',
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
      // Sent to the printer by the worker, so a printer outage never blocks or loses the order.
      await trx
        .insertInto('outbox_events')
        .values({ topic: PRINT_TOPIC, payload: JSON.stringify({ orderId: o.id }) })
        .execute();
      return o.id;
    });
    if (freeId) {
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
        actionUrl: page,
      });
      return { id: freeId, url: back.success, free: true };
    }

    const user = await this.db
      .selectFrom('users')
      .select(['stripe_customer_id'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (!user.stripe_customer_id) throw new ConflictException({ error: 'no_customer' });
    const amount = await this.printPrice();
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
          paid_print: true,
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
    // TODO [LEGAL REVIEW] Withdrawal right for the 3 € print order (personalised code, § 312g Abs. 2
    // Nr. 1 BGB?). Until the lawyer decides, the order is treated like any other one-time purchase.
    const checkout = await this.payments.createPaymentCheckout({
      customerId: user.stripe_customer_id,
      amountCents: amount,
      description:
        locale === 'en' ? 'ParkShield decal, printed and shipped' : 'ParkShield-Aufkleber, Druck und Versand',
      locale,
      successUrl: back.success,
      cancelUrl: back.cancel,
      metadata: { orderId: order.id, userId },
    });
    return { id: order.id, url: checkout.url, free: false };
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

  /**
   * Worker: render the CMYK print file and hand the job to the print partner (ON_DEMAND). In
   * FROM_STOCK mode nothing is printed: the order waits as `paid` until the packer scans a sticker.
   */
  async submitToPrinter(orderId: string): Promise<void> {
    if ((await this.settings.get('fulfillment.mode', 'on_demand')) === 'from_stock') return;
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
    // Shipping state lives on the order; the tag is already assigned and stays so.
    await this.db
      .updateTable('decal_orders')
      .set({ status: 'in_production', print_partner_ref: reference })
      .where('id', '=', orderId)
      .where('status', '=', 'paid')
      .execute();
  }

  /** Print partner callback: shipped with tracking number, e-mailed to the owner (US-11). */
  async markShipped(orderId: string, trackingNumber: string): Promise<boolean> {
    const updated = await this.db
      .updateTable('decal_orders')
      .set({ status: 'shipped', tracking_number: trackingNumber, shipped_at: sql`now()` })
      .where('id', '=', orderId)
      .where('status', 'in', ['paid', 'in_production', 'packed'])
      .returning('user_id')
      .executeTakeFirst();
    if (!updated?.user_id) return false;
    const item = await this.db
      .selectFrom('decal_order_items as i')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .select(['v.id as vehicleId', 'v.nickname'])
      .where('i.order_id', '=', orderId)
      .executeTakeFirstOrThrow();
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
