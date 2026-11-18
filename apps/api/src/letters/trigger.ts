import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.generated';

/** Outbox topic: "maybe create the welcome letter for this customer" (idempotent handler). */
export const WELCOME_LETTER_TOPIC = 'welcome_letter.check';

/**
 * Queues the check in the same transaction as the change that may complete the conditions
 * (payment confirmed, first vehicle registered). Whichever comes last creates the letter; the
 * handler does nothing when a condition is still missing or the letter already exists.
 */
export async function queueWelcomeLetterCheck(
  db: Kysely<DB> | Transaction<DB>,
  userId: string,
): Promise<void> {
  await db
    .insertInto('outbox_events')
    .values({ topic: WELCOME_LETTER_TOPIC, payload: JSON.stringify({ userId }) })
    .execute();
}
