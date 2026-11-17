import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';

type Executor = Pick<Db, 'selectFrom' | 'insertInto'>;

/**
 * Phone bans (abuse protection §5): an owner's block of a sender who had confirmed a number bans that
 * number for this vehicle for 12 months. A global ban only exists after staff review (ops).
 */
@Injectable()
export class PhoneBansService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async isBanned(hash: Buffer, vehicleId: string): Promise<boolean> {
    const hit = await this.db
      .selectFrom('phone_bans')
      .select('id')
      .where('phone_hash', '=', hash)
      .where('expires_at', '>', sql<Date>`now()`)
      .where((eb) => eb.or([eb('vehicle_id', '=', vehicleId), eb('vehicle_id', 'is', null)]))
      .executeTakeFirst();
    return Boolean(hit);
  }

  /** Idempotent: a second block of the same number for the same vehicle keeps the first ban. */
  async banForVehicle(trx: Executor, hash: Buffer, vehicleId: string): Promise<void> {
    const months = Number(await this.settings.get('abuse.phone_ban_months', 12));
    const existing = await trx
      .selectFrom('phone_bans')
      .select('id')
      .where('phone_hash', '=', hash)
      .where('vehicle_id', '=', vehicleId)
      .where('expires_at', '>', sql<Date>`now()`)
      .executeTakeFirst();
    if (existing) return;
    await trx
      .insertInto('phone_bans')
      .values({
        phone_hash: hash,
        vehicle_id: vehicleId,
        reason: 'owner_block',
        created_by: 'owner',
        expires_at: sql`now() + make_interval(months => ${months})`,
      })
      .execute();
  }
}
