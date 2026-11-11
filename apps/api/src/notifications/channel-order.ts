import type { Kysely } from 'kysely';
import type { SettingsService } from '../core/settings.service';
import type { DB } from '../db/types.generated';

/** Channels an owner can order (SMS follows with Premium, NT-07). */
export const ORDERABLE = ['webpush', 'email', 'whatsapp'] as const;
export type OrderableChannel = (typeof ORDERABLE)[number];

const isOrderable = (v: unknown): v is OrderableChannel =>
  typeof v === 'string' && (ORDERABLE as readonly string[]).includes(v);

/** The default order from settings (NT-01: cheapest first, NT-11: editable without deploy). */
export async function defaultOrder(settings: SettingsService): Promise<OrderableChannel[]> {
  const raw = await settings.get<unknown>('channels.order', ORDERABLE);
  const list = Array.isArray(raw) ? raw.filter(isOrderable) : [];
  return [...new Set([...list, ...ORDERABLE])];
}

/**
 * The owner's order (OW-05), stored as contact_channels.priority. Owners who never changed it follow the
 * default; channels missing from their saved order are appended in default order.
 */
export async function channelOrder(
  db: Kysely<DB>,
  settings: SettingsService,
  userId: string,
): Promise<OrderableChannel[]> {
  const fallback = await defaultOrder(settings);
  const rows = await db
    .selectFrom('contact_channels')
    .select(['type', 'priority', 'address_bidx'])
    .where('user_id', '=', userId)
    .where('type', 'in', [...ORDERABLE])
    .execute();
  const customised = rows.some((r) => r.address_bidx === null);
  if (!customised) return fallback;
  const prio = new Map<OrderableChannel, number>();
  for (const r of rows) if (isOrderable(r.type)) prio.set(r.type, r.priority);
  return [...fallback].sort(
    (a, b) =>
      (prio.get(a) ?? 100 + fallback.indexOf(a)) - (prio.get(b) ?? 100 + fallback.indexOf(b)),
  );
}

/** Saves the owner's order as the priority of each channel's row (created without address if needed). */
export async function saveChannelOrder(
  db: Kysely<DB>,
  userId: string,
  order: OrderableChannel[],
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (const [i, type] of order.entries()) {
      const priority = i + 1;
      // Updates the linked WhatsApp row too; an unlinked one keeps its place in an address-less row,
      // which dispatch ignores (never verified).
      const updated = await trx
        .updateTable('contact_channels')
        .set({ priority })
        .where('user_id', '=', userId)
        .where('type', '=', type)
        .executeTakeFirst();
      if (!Number(updated.numUpdatedRows)) {
        await trx
          .insertInto('contact_channels')
          .values({ user_id: userId, type, priority, verified_at: null })
          .execute();
      }
    }
  });
}
