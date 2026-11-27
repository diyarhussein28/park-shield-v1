import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';
import type { DB as Database } from '../db/types.generated';
import { TagsService } from './tags.service';

/** Days the old code keeps working after the stock sticker was shipped (owner, 2026-11-27). */
export const OLD_CODE_GRACE_DAYS_DEFAULT = 14;

type Exec = Kysely<Database> | Transaction<Database>;

/**
 * The change-over from a vehicle's old code to the code of the stock sticker that was packed for it
 * (phase 3, 2026-11-27, docs/nfc-sticker-plan.md). The stock code works from the moment it is packed;
 * the old code (and any PDF printed with it) keeps working until the owner tests the new sticker
 * („Aufkleber testen“) or `fulfillment.old_code_grace_days` after shipping, so the vehicle is never
 * without a working code while the sticker travels. „Sperren“ stops both at once.
 */
@Injectable()
export class ChangeOverService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(TagsService) private readonly tags: TagsService,
  ) {}

  /** The sticker of this order is on its way: the vehicle's other live codes get their deadline. */
  async startOnShipping(orderId: string): Promise<void> {
    const item = await this.db
      .selectFrom('decal_order_items as i')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .select(['t.id as tokenId', 't.vehicle_id as vehicleId', 't.serial_no as serialNo'])
      .where('i.order_id', '=', orderId)
      .executeTakeFirst();
    // Only stock stickers start a change-over; an on-demand print carries the vehicle's own code.
    if (!item?.vehicleId || item.serialNo === null) return;
    const days = Number(
      await this.settings.get('fulfillment.old_code_grace_days', OLD_CODE_GRACE_DAYS_DEFAULT),
    );
    await this.db
      .updateTable('qr_tokens')
      .set({ retire_after: sql<Date>`now() + make_interval(days => ${days})` })
      .where('vehicle_id', '=', item.vehicleId)
      .where('status', '=', 'assigned')
      .where('id', '<>', item.tokenId)
      .where('retire_after', 'is', null)
      .execute();
  }

  /** The parcel came back: the old code keeps working without a deadline until the next shipment. */
  async pauseOnReturn(orderId: string): Promise<void> {
    const item = await this.db
      .selectFrom('decal_order_items as i')
      .innerJoin('qr_tokens as t', 't.id', 'i.qr_token_id')
      .select(['t.id as tokenId', 't.vehicle_id as vehicleId'])
      .where('i.order_id', '=', orderId)
      .executeTakeFirst();
    if (!item?.vehicleId) return;
    await this.db
      .updateTable('qr_tokens')
      .set({ retire_after: null })
      .where('vehicle_id', '=', item.vehicleId)
      .where('status', '=', 'assigned')
      .where('id', '<>', item.tokenId)
      .execute();
  }

  /**
   * The owner tested this code: it is on the car, so every older live code of the vehicle stops
   * (same transaction as the test).
   */
  async retireOlder(trx: Exec, tokenId: string): Promise<number> {
    const t = await trx
      .selectFrom('qr_tokens')
      .select(['vehicle_id', 'assigned_at'])
      .where('id', '=', tokenId)
      .executeTakeFirst();
    if (!t?.vehicle_id || !t.assigned_at) return 0;
    const older = await trx
      .selectFrom('qr_tokens')
      .select('id')
      .where('vehicle_id', '=', t.vehicle_id)
      .where('status', '=', 'assigned')
      .where('id', '<>', tokenId)
      .where('assigned_at', '<', t.assigned_at)
      .execute();
    for (const o of older)
      await this.tags.transition(trx, o.id, 'revoked', 'owner', 'retired_change_over');
    return older.length;
  }

  /** Worker: old codes whose deadline passed stop working. Idempotent. */
  async sweep(): Promise<number> {
    const due = await this.db
      .selectFrom('qr_tokens')
      .select('id')
      .where('status', '=', 'assigned')
      .where('retire_after', '<=', sql<Date>`now()`)
      .limit(500)
      .execute();
    for (const d of due)
      await this.db.transaction().execute(async (trx) => {
        const still = await trx
          .selectFrom('qr_tokens')
          .select('status')
          .where('id', '=', d.id)
          .forUpdate()
          .executeTakeFirst();
        if (still?.status === 'assigned')
          await this.tags.transition(trx, d.id, 'revoked', 'system', 'retired_change_over');
      });
    return due.length;
  }
}
