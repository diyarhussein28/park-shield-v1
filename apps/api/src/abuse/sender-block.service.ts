import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';

type Executor = Pick<Db, 'selectFrom' | 'updateTable' | 'insertInto'>;

/** The identifiers the abuse module knows for one alert's sender (never shown to anyone). */
export interface SenderRefs {
  id: string;
  is_test: boolean;
  vehicle_id: string;
  qr_token_id: string | null;
  block_ref: Buffer | null;
  verified_phone_hash: Buffer | null;
}

export interface SenderBlockState {
  senderBlocked: boolean;
  /** When the longest active block ends; null when not blocked. */
  blockedUntil: Date | null;
}

const NONE: SenderBlockState = { senderBlocked: false, blockedUntil: null };

/**
 * Whether an alert's sender is blocked by the owner, and lifting that block (2026-11-22).
 *
 * „Same sender“ means the same identifier the existing abuse module already blocks on: the per-vehicle
 * scanner reference `block_ref` (server-side HMAC of the truncated IP and the User-Agent, valid while
 * its 30-day block lasts) or the same confirmed phone number (`verified_phone_hash`, 12-month ban for
 * this vehicle). Alerts without a shared identifier are never linked. Nothing is read from or stored
 * on the scanner's device (§ 25 TDDDG). Only the owner's own per-vehicle blocks count here: global
 * blocks are a staff matter and cannot be lifted from the app.
 */
@Injectable()
export class SenderBlockService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Block state per alert, computed in two queries for a whole list. */
  async stateFor(alerts: SenderRefs[]): Promise<Map<string, SenderBlockState>> {
    const out = new Map<string, SenderBlockState>();
    const real = alerts.filter((a) => !a.is_test);
    const refs = real.filter((a) => a.block_ref && a.qr_token_id);
    const phones = real.filter((a) => a.verified_phone_hash);
    const [blocks, bans] = await Promise.all([
      refs.length
        ? this.db
            .selectFrom('scanner_blocks')
            .select(['ref', 'qr_token_id', 'expires_at'])
            .where(
              'ref',
              'in',
              refs.map((a) => a.block_ref!),
            )
            .where(
              'qr_token_id',
              'in',
              refs.map((a) => a.qr_token_id!),
            )
            .where('expires_at', '>', sql<Date>`now()`)
            .execute()
        : [],
      phones.length
        ? this.db
            .selectFrom('phone_bans')
            .select(['phone_hash', 'vehicle_id', 'expires_at'])
            .where(
              'phone_hash',
              'in',
              phones.map((a) => a.verified_phone_hash!),
            )
            .where(
              'vehicle_id',
              'in',
              phones.map((a) => a.vehicle_id),
            )
            .where('expires_at', '>', sql<Date>`now()`)
            .execute()
        : [],
    ]);
    for (const a of alerts) {
      let until: Date | null = null;
      const later = (d: Date) => {
        if (!until || d > until) until = d;
      };
      if (a.block_ref && a.qr_token_id) {
        for (const b of blocks) {
          if (b.qr_token_id === a.qr_token_id && b.ref.equals(a.block_ref)) later(b.expires_at);
        }
      }
      if (a.verified_phone_hash) {
        for (const b of bans) {
          if (b.vehicle_id === a.vehicle_id && b.phone_hash.equals(a.verified_phone_hash)) {
            later(b.expires_at);
          }
        }
      }
      out.set(a.id, until ? { senderBlocked: true, blockedUntil: until } : NONE);
    }
    return out;
  }

  async stateOf(alert: SenderRefs): Promise<SenderBlockState> {
    return (await this.stateFor([alert])).get(alert.id) ?? NONE;
  }

  /**
   * Ends the owner's active blocks of this sender for this vehicle: the rows are set expired (the
   * retention job deletes them later) and an audit entry is written. Idempotent: nothing active →
   * nothing changes and no audit entry. The live chat that the block closed stays closed.
   */
  async unblock(trx: Executor, userId: string, alert: SenderRefs): Promise<{ unblocked: boolean }> {
    let ended = 0;
    if (alert.block_ref && alert.qr_token_id) {
      const r = await trx
        .updateTable('scanner_blocks')
        .set({ expires_at: sql`now()` })
        .where('ref', '=', alert.block_ref)
        .where('qr_token_id', '=', alert.qr_token_id)
        .where('expires_at', '>', sql<Date>`now()`)
        .executeTakeFirst();
      ended += Number(r.numUpdatedRows);
    }
    if (alert.verified_phone_hash) {
      const r = await trx
        .updateTable('phone_bans')
        .set({ expires_at: sql`now()` })
        .where('phone_hash', '=', alert.verified_phone_hash)
        .where('vehicle_id', '=', alert.vehicle_id)
        .where('created_by', '=', 'owner')
        .where('expires_at', '>', sql<Date>`now()`)
        .executeTakeFirst();
      ended += Number(r.numUpdatedRows);
    }
    if (!ended) return { unblocked: false };
    await trx
      .insertInto('audit_logs')
      .values({
        actor_id: userId,
        actor_kind: 'customer',
        action: 'sender.unblock',
        entity: 'alerts',
        entity_id: alert.id,
        meta: JSON.stringify({ vehicleId: alert.vehicle_id, blocksEnded: ended }),
      })
      .execute();
    return { unblocked: true };
  }
}
