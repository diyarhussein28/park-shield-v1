import { sql } from 'kysely';
import type { Db } from '../core/core.module';

/**
 * The Alerts tab badge and the app icon badge (2026-11-22): alerts of the last 90 days the owner has
 * not opened yet (`seen_at IS NULL`). Alerts that were seen, acknowledged („Ich komme“, a reply) or
 * marked „Erledigt“ never count; neither do silently dropped ones (`blocked`).
 */
export async function unseenCount(db: Pick<Db, 'selectFrom'>, userId: string): Promise<number> {
  const row = await db
    .selectFrom('alerts as a')
    .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('v.owner_user_id', '=', userId)
    .where('a.status', '<>', 'blocked')
    .where('a.seen_at', 'is', null)
    .where('a.owner_reply', 'is', null)
    .where('a.acknowledged_by', 'is', null)
    .where('a.resolved_at', 'is', null)
    .where('a.created_at', '>', sql<Date>`now() - interval '90 days'`)
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
