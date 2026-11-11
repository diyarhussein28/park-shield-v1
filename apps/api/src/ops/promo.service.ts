import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';
import type { PromoKind } from '../db/types.generated';
import { PAYMENTS, type Payments } from '../providers/ports';
import { StaffService, type StaffContext } from './staff.service';

export interface PromoInput {
  code: string;
  kind: PromoKind;
  /** percent (1–100), cents, or months (1–24) */
  value: number;
  appliesTo?: ('plus' | 'premium')[];
  priceLockMonths?: number | null;
  maxRedemptions?: number | null;
  validUntil?: Date | null;
  partnerId?: string | null;
}

/**
 * AD-13 promo codes: percent, amount or extra months, synced to Stripe Coupons (extra months move the
 * renewal instead), with max redemptions, expiry, partner attribution and the founders' price lock.
 */
@Injectable()
export class PromoService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  async list() {
    const rows = await this.db
      .selectFrom('promo_codes as c')
      .leftJoin('partners as p', 'p.id', 'c.partner_id')
      .select((eb) => [
        'c.id',
        'c.code',
        'c.kind',
        'c.value',
        'c.applies_to as appliesTo',
        'c.price_lock_months as priceLockMonths',
        'c.max_redemptions as maxRedemptions',
        'c.valid_until as validUntil',
        'c.is_active as active',
        'c.stripe_coupon_id as stripeCouponId',
        'c.created_at as createdAt',
        'p.name as partner',
        eb
          .selectFrom('promo_redemptions as r')
          .select((e) => e.fn.countAll<string>().as('n'))
          .whereRef('r.promo_code_id', '=', 'c.id')
          .as('redemptions'),
      ])
      .orderBy('c.created_at', 'desc')
      .execute();
    return {
      promos: rows.map((r) => ({
        ...r,
        appliesTo: r.appliesTo as string[] | null,
        redemptions: Number(r.redemptions ?? 0),
        synced: r.kind === 'extra_months' || Boolean(r.stripeCouponId),
      })),
    };
  }

  async create(by: StaffContext, input: PromoInput) {
    const code = input.code.trim().toUpperCase();
    if (input.kind === 'percent_off' && (input.value < 1 || input.value > 100))
      throw new BadRequestException({ error: 'value_out_of_range' });
    if (input.kind === 'extra_months' && (input.value < 1 || input.value > 24))
      throw new BadRequestException({ error: 'value_out_of_range' });
    const exists = await this.db
      .selectFrom('promo_codes')
      .select('id')
      .where('code', '=', code)
      .executeTakeFirst();
    if (exists) throw new ConflictException({ error: 'promo_exists' });
    if (input.partnerId) {
      const p = await this.db
        .selectFrom('partners')
        .select('id')
        .where('id', '=', input.partnerId)
        .executeTakeFirst();
      if (!p) throw new NotFoundException({ error: 'partner_not_found' });
    }
    // Extra months are not a Stripe discount: the renewal moves after the first payment.
    const coupon =
      input.kind === 'extra_months'
        ? null
        : await this.payments.createCoupon({
            code,
            kind: input.kind,
            value: input.value,
            maxRedemptions: input.maxRedemptions ?? null,
            validUntil: input.validUntil ?? null,
          });
    const row = await this.db
      .insertInto('promo_codes')
      .values({
        code,
        kind: input.kind,
        value: input.value,
        stripe_coupon_id: coupon?.couponId ?? null,
        partner_id: input.partnerId ?? null,
        applies_to: input.appliesTo?.length ? input.appliesTo : null,
        price_lock_months: input.priceLockMonths ?? null,
        max_redemptions: input.maxRedemptions ?? null,
        valid_until: input.validUntil ?? null,
        created_by: by.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.staff.audit(by.userId, 'promo.create', 'promo_codes', row.id, {
      code,
      kind: input.kind,
      value: input.value,
      priceLockMonths: input.priceLockMonths ?? null,
    });
    return { id: row.id };
  }

  async deactivate(by: StaffContext, id: string) {
    const row = await this.db
      .updateTable('promo_codes')
      .set({ is_active: false })
      .where('id', '=', id)
      .where('is_active', '=', true)
      .returning(['stripe_coupon_id', 'code'])
      .executeTakeFirst();
    if (!row) throw new NotFoundException({ error: 'promo_not_found' });
    if (row.stripe_coupon_id) await this.payments.deleteCoupon(row.stripe_coupon_id);
    await this.staff.audit(by.userId, 'promo.deactivate', 'promo_codes', id, { code: row.code });
  }
}
