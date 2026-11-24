import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
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
import { vehicleLabelOk } from '../vehicles/vehicle-label';
import { ProfileService } from '../profile/profile.service';
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
    @Inject(ProfileService) private readonly profiles: ProfileService,
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
  async printOptions(userId: string, vehicleId: string) {
    // Only for the owner's own vehicle (404 otherwise, like every other vehicle route).
    const vehicle = await this.vehicles.get(userId, vehicleId);
    const [welcome, granted, price, design, address] = await Promise.all([
      this.includedAvailable(userId),
      this.freeReplacements(userId),
      this.printPrice(),
      vehicle.decal
        ? this.db
            .selectFrom('qr_tokens')
            .select(['design_template_id', 'cta_header'])
            .where('id', '=', vehicle.decal.tokenId)
            .executeTakeFirst()
        : undefined,
      this.profiles.postalAddress(userId),
    ]);
    const free = welcome || granted > 0;
    return {
      selfPrint: { priceCents: 0 },
      shipped: { priceCents: free ? 0 : price, free, welcomePrint: welcome },
      // B1: what will be printed (the confirmation step shows it before the order is placed).
      personalization: {
        label: vehicle.nickname,
        labelValid: vehicleLabelOk(vehicle.nickname),
        template: design?.design_template_id ?? null,
        cta: design?.cta_header ?? null,
      },
      // A7: the postal address from the sign-up profile (Apple/Google give us none).
      addressPrefill: address
        ? {
            name: address.name,
            line1: address.line1,
            ...(address.line2 ? { line2: address.line2 } : {}),
            postalCode: address.postalCode,
            city: address.city,
            country: 'DE' as const,
          }
        : null,
    };
  }

  /** The customer's choices frozen at confirmation (B1); printed from this, never from later edits. */
  private snapshot(
    token: { design_template_id: string; cta_header: string },
    label: string,
  ): { template: string; cta: string; label: string } {
    return { template: token.design_template_id, cta: token.cta_header, label: label.trim() };
  }

  /**
   * B4/B6: a withdrawal or a store refund BEFORE personalisation cancels the fulfillment order, so
   * nothing is shipped. Confirmed (personalised) orders stay; old orders without `personalized_at`
   * that were not printed yet are cancelled. Returns the number of cancelled orders.
   */
  async cancelUnpersonalized(userId: string): Promise<number> {
    const r = await this.db
      .updateTable('decal_orders')
      .set({ status: 'canceled', canceled_at: sql`now()` })
      .where('user_id', '=', userId)
      .where('personalized_at', 'is', null)
      .where('status', 'in', ['pending_payment', 'paid'])
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }

  /** Whether a sticker was personalised for this customer before `at` (B4 sticker deduction). */
  async personalizedBefore(userId: string, at: Date): Promise<boolean> {
    const row = await this.db
      .selectFrom('decal_orders')
      .select('id')
      .where('user_id', '=', userId)
      .where('personalized_at', 'is not', null)
      .where('personalized_at', '<=', at)
      .where('status', '<>', 'pending_payment')
      .where('status', '<>', 'canceled')
      .executeTakeFirst();
    return Boolean(row);
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
    // B1: the vehicle label is printed on the sticker; it must be valid before anything is ordered.
    if (!vehicleLabelOk(vehicle.nickname))
      throw new UnprocessableEntityException({ error: 'label_invalid' });
    const design = this.snapshot(token, vehicle.nickname);
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
          // Confirmed in the personalisation step: frozen now, only then it enters the print queue.
          personalized_at: sql`now()`,
          design_snapshot: JSON.stringify(design),
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

    // A3: the 3 € print is always a Stripe payment (physical goods never use in-app purchase), also
    // for App Store / Google Play subscribers: their Stripe customer is created now, linked to the user.
    const user = await this.db
      .selectFrom('users')
      .select(['stripe_customer_id', 'email', 'preferred_lang'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      customerId = await this.payments.ensureCustomer({
        email: user.email,
        userId,
        locale: user.preferred_lang,
      });
      await this.db
        .updateTable('users')
        .set({ stripe_customer_id: customerId })
        .where('id', '=', userId)
        .where('stripe_customer_id', 'is', null)
        .execute();
    }
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
          // B5: personalised at order time (confirmed before payment); printed once paid.
          personalized_at: sql`now()`,
          design_snapshot: JSON.stringify(design),
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
    // B5: the printed sticker is made to the customer's specification (design and vehicle label), so
    // there is no right of withdrawal for it (§ 312g Abs. 2 Nr. 1 BGB); the notice is shown before the
    // payment. TODO [LEGAL REVIEW]
    const checkout = await this.payments.createPaymentCheckout({
      customerId,
      amountCents: amount,
      description:
        locale === 'en'
          ? 'ParkShield decal, printed and shipped'
          : 'ParkShield-Aufkleber, Druck und Versand',
      locale,
      successUrl: back.success,
      cancelUrl: back.cancel,
      metadata: { orderId: order.id, userId },
    });
    return { id: order.id, url: checkout.url, free: false };
  }

  /** Payment for an order arrived: queue it for printing (idempotent). */
  async markPaid(orderId: string, paymentIntentId: string | null): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('decal_orders')
        .set({ status: 'paid', stripe_payment_intent: paymentIntentId })
        .where('id', '=', orderId)
        .where('status', '=', 'pending_payment')
        .executeTakeFirst();
      if (!Number(r.numUpdatedRows)) return false;
      await trx
        .insertInto('outbox_events')
        .values({ topic: PRINT_TOPIC, payload: JSON.stringify({ orderId }) })
        .execute();
      return true;
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
        'o.design_snapshot',
      ])
      .where('o.id', '=', orderId)
      .executeTakeFirst();
    if (!order || order.status !== 'paid') return; // already submitted, cancelled, or gone
    // B1: the frozen snapshot of the confirmation; later design changes never reach this order.
    const snap = order.design_snapshot as {
      template?: string;
      cta?: string;
      label?: string;
    } | null;
    const spec = layoutDecal({
      code: this.tokens.decrypt(order.code_enc),
      scannerBaseUrl: this.env.SCANNER_BASE_URL,
      template: (snap?.template ?? order.design_template_id) as DecalTemplate,
      cta: snap?.cta ?? order.cta_header,
      label: snap?.label ?? null,
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
      actionUrl: `${this.env.WEB_BASE_URL}/app`,
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
