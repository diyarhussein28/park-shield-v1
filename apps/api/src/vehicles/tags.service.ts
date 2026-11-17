import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Logger } from 'pino';
import { LOGGER } from '../core/tokens';
import type { DB } from '../db/types.generated';
import { assertTagTransition, InvalidTagTransition, type TagStatus } from '../legal/rules';

export type TagActor = 'system' | 'owner' | 'admin' | 'stripe_webhook';

/**
 * The tag lifecycle (in_stock → assigned → revoked) as an explicit state machine. Every change goes
 * through here, is checked against the allowed transitions and written to tag_events. Tag state never
 * says anything about the subscription; the scanner combines both (rules.scannerDecision).
 */
@Injectable()
export class TagsService {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  async transition(
    trx: Kysely<DB> | Transaction<DB>,
    tokenId: string,
    to: TagStatus,
    actor: TagActor,
    reason: string,
    vehicleId?: string,
  ): Promise<void> {
    const t = await trx
      .selectFrom('qr_tokens')
      .select(['status', 'vehicle_id'])
      .where('id', '=', tokenId)
      .forUpdate()
      .executeTakeFirst();
    if (!t) throw new ConflictException({ error: 'tag_not_found' });
    try {
      assertTagTransition(t.status, to);
    } catch (err) {
      if (err instanceof InvalidTagTransition) {
        this.logger.warn({ tokenId, from: t.status, to, actor, reason }, 'invalid tag transition');
        throw new ConflictException({ error: 'invalid_tag_transition', from: t.status, to });
      }
      throw err;
    }
    await trx
      .updateTable('qr_tokens')
      .set(
        to === 'assigned'
          ? { status: to, vehicle_id: vehicleId ?? t.vehicle_id, assigned_at: sql`now()` }
          : to === 'revoked'
            ? {
                status: to,
                revoked_at: sql`now()`,
                revoke_reason: reason,
                test_window_until: null,
              }
            : { status: to },
      )
      .where('id', '=', tokenId)
      .execute();
    await trx
      .insertInto('tag_events')
      .values({ qr_token_id: tokenId, from_status: t.status, to_status: to, actor, reason })
      .execute();
  }

  /** Records the first state of a newly issued tag. */
  async created(
    trx: Kysely<DB> | Transaction<DB>,
    tokenId: string,
    status: TagStatus,
    actor: TagActor,
    reason: string,
  ): Promise<void> {
    await trx
      .insertInto('tag_events')
      .values({ qr_token_id: tokenId, from_status: null, to_status: status, actor, reason })
      .execute();
  }

  /** Revokes every live tag of a user's vehicles (withdrawal: the contract is undone). */
  async revokeAllOfUser(
    trx: Kysely<DB> | Transaction<DB>,
    userId: string,
    actor: TagActor,
    reason: string,
  ): Promise<number> {
    const tags = await trx
      .selectFrom('qr_tokens as t')
      .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .select('t.id')
      .where('v.owner_user_id', '=', userId)
      .where('t.status', '=', 'assigned')
      .execute();
    for (const t of tags) await this.transition(trx, t.id, 'revoked', actor, reason);
    return tags.length;
  }
}
