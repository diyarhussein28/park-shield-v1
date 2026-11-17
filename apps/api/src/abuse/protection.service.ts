import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';

type Executor = Pick<Db, 'selectFrom' | 'insertInto' | 'deleteFrom'>;

export interface ProtectionStatus {
  active: boolean;
  source: 'auto' | 'manual' | null;
  activeUntil: Date | null;
}

/**
 * Protected Mode per vehicle (abuse protection §4). While it is active, everyone who scans the vehicle
 * can still send everything and the alert type is delivered at once; only free text (and later photos)
 * of senders without a confirmed phone number is hidden behind "Anzeigen" in the portal.
 */
@Injectable()
export class ProtectionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async status(vehicleId: string, db: Executor = this.db): Promise<ProtectionStatus> {
    const row = await db
      .selectFrom('vehicle_protection')
      .select(['active', 'source', 'active_until'])
      .where('vehicle_id', '=', vehicleId)
      .executeTakeFirst();
    const active =
      Boolean(row?.active) && (row!.active_until === null || row!.active_until > new Date());
    return {
      active,
      source: active ? (row!.source as 'auto' | 'manual') : null,
      activeUntil: active ? row!.active_until : null,
    };
  }

  async isActive(vehicleId: string): Promise<boolean> {
    return (await this.status(vehicleId)).active;
  }

  private async owned(userId: string, vehicleId: string) {
    const v = await this.db
      .selectFrom('vehicles')
      .select('id')
      .where('id', '=', vehicleId)
      .where('owner_user_id', '=', userId)
      .executeTakeFirst();
    if (!v) throw new NotFoundException();
  }

  async statusFor(userId: string, vehicleId: string): Promise<ProtectionStatus> {
    await this.owned(userId, vehicleId);
    return this.status(vehicleId);
  }

  /** The owner switches it on (no end date) or off at any time, also while it runs automatically. */
  async setManual(userId: string, vehicleId: string, active: boolean): Promise<ProtectionStatus> {
    await this.owned(userId, vehicleId);
    if (active) {
      await this.db
        .insertInto('vehicle_protection')
        .values({ vehicle_id: vehicleId, active: true, source: 'manual', active_until: null })
        .onConflict((oc) =>
          oc.column('vehicle_id').doUpdateSet({
            active: true,
            source: 'manual',
            active_until: null,
            updated_at: sql`now()`,
          }),
        )
        .execute();
    } else {
      await this.db.deleteFrom('vehicle_protection').where('vehicle_id', '=', vehicleId).execute();
    }
    return this.status(vehicleId);
  }

  /**
   * Automatic trigger, called in the transaction that stores an owner's block/report: N reports for the
   * same vehicle within the window switch Protected Mode on for D days, and each further report extends
   * it. A manual switch without an end date stays as it is. Returns true when it is active afterwards
   * because of this rule.
   */
  async afterReport(trx: Executor, vehicleId: string): Promise<boolean> {
    const threshold = Number(await this.settings.get('abuse.protected_mode_reports', 2));
    const windowDays = Number(await this.settings.get('abuse.protected_mode_window_days', 30));
    const days = Number(await this.settings.get('abuse.protected_mode_days', 30));
    const { n } = await trx
      .selectFrom('abuse_reports as r')
      .innerJoin('alerts as a', 'a.id', 'r.alert_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('r.kind', '=', 'owner_report')
      .where('a.vehicle_id', '=', vehicleId)
      .where('r.created_at', '>', sql<Date>`now() - make_interval(days => ${windowDays})`)
      .executeTakeFirstOrThrow();
    if (Number(n) < threshold) return false;
    const until = sql<Date>`now() + make_interval(days => ${days})`;
    await trx
      .insertInto('vehicle_protection')
      .values({ vehicle_id: vehicleId, active: true, source: 'auto', active_until: until })
      .onConflict((oc) =>
        oc.column('vehicle_id').doUpdateSet({
          active: true,
          source: sql`CASE WHEN vehicle_protection.active AND vehicle_protection.active_until IS NULL
                           THEN vehicle_protection.source ELSE 'auto' END`,
          active_until: sql`CASE WHEN vehicle_protection.active AND vehicle_protection.active_until IS NULL
                                 THEN NULL
                                 ELSE greatest(vehicle_protection.active_until, ${until}) END`,
          updated_at: sql`now()`,
        }),
      )
      .execute();
    return true;
  }
}
