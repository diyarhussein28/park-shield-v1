import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { sha256 } from '../core/crypto';
import { DB, ENV } from '../core/tokens';
import type { OwnerReply } from '../db/types.generated';
import { ESCALATE_TOPIC, EscalationService } from './escalation.service';

export const OWNER_REPLIES = [
  'coming',
  'in_30_min',
  'not_nearby',
] as const satisfies readonly OwnerReply[];

/** a: the alert notification; f: the one reminder after "Ich warte noch" (fresh buttons, NT-09). */
type Generation = 'a' | 'f';
const ID_LEN = 22; // 16-byte UUID, base64url
const TOKEN_LEN = ID_LEN + 1 + 43; // + generation + 256-bit MAC

export interface ReplyLinks {
  page: string;
  coming: string;
  in_30_min: string;
  not_nearby: string;
}

const uuidToB64 = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
const b64ToUuid = (s: string) => {
  const hex = Buffer.from(s, 'base64url').toString('hex');
  return hex.length === 32
    ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    : null;
};

/**
 * Single-use reply token per alert (NT-02, 02-architecture §5): 256-bit MAC, only its hash in PostgreSQL.
 * The token is derived (HMAC with a server key) instead of stored, so every channel and every outbox
 * retry carries the same link, and links keep working after a Valkey restart (US-25). A reply clears
 * the hash; the reminder issues the second generation.
 */
@Injectable()
export class AckService {
  private readonly key: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) env: Env,
    @Inject(EscalationService) private readonly escalation: EscalationService,
  ) {
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- key comes from env.SESSION_SECRET
    this.key = createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'base64'))
      .update('parkshield/ack/v1')
      .digest();
    this.webBase = env.WEB_BASE_URL;
  }

  private readonly webBase: string;

  private derive(alertId: string, gen: Generation): string {
    const mac = createHmac('sha256', this.key).update(`${alertId}:${gen}`).digest('base64url');
    return `${uuidToB64(alertId)}${gen}${mac}`;
  }

  private parse(token: string): string | null {
    if (token.length !== TOKEN_LEN) return null;
    const id = b64ToUuid(token.slice(0, ID_LEN));
    const gen = token[ID_LEN];
    if (!id || (gen !== 'a' && gen !== 'f')) return null;
    const expected = Buffer.from(this.derive(id, gen));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
  }

  /** The alert's reply token; armed on first use so it never re-opens after a reply. */
  async tokenFor(alertId: string, expiresAt: Date): Promise<string> {
    const token = this.derive(alertId, 'a');
    await this.db
      .updateTable('alerts')
      .set({ ack_token_hash: sha256(token), ack_token_expires_at: expiresAt })
      .where('id', '=', alertId)
      .where('ack_token_hash', 'is', null)
      .where('owner_reply', 'is', null)
      .execute();
    return token;
  }

  /**
   * The reply token that is armed right now, or null (not sent yet, already answered). Used by the photo
   * view page (/v/…), whose own token already proves it came from the owner's notification.
   */
  async openToken(alertId: string): Promise<string | null> {
    const a = await this.db
      .selectFrom('alerts')
      .select(['ack_token_hash', 'ack_token_expires_at', 'expires_at'])
      .where('id', '=', alertId)
      .executeTakeFirst();
    if (!a?.ack_token_hash) return null;
    if ((a.ack_token_expires_at ?? a.expires_at) < new Date()) return null;
    for (const gen of ['f', 'a'] as const) {
      const token = this.derive(alertId, gen);
      if (sha256(token).equals(a.ack_token_hash)) return token;
    }
    return null;
  }

  /** Fresh reply buttons (the reminder after "Ich warte noch"). The previous link stops working. */
  async renew(alertId: string, expiresAt: Date): Promise<string> {
    const token = this.derive(alertId, 'f');
    await this.db
      .updateTable('alerts')
      .set({ ack_token_hash: sha256(token), ack_token_expires_at: expiresAt })
      .where('id', '=', alertId)
      .execute();
    return token;
  }

  links(token: string): ReplyLinks {
    const base = `${this.webBase}/antwort`;
    return {
      // The token travels in the fragment: never sent to a server log or in a Referer header.
      page: `${base}#t=${token}`,
      coming: `${base}?r=coming#t=${token}`,
      in_30_min: `${base}?r=in_30_min#t=${token}`,
      not_nearby: `${base}?r=not_nearby#t=${token}`,
    };
  }

  private async load(token: string) {
    const id = this.parse(token);
    if (!id) return null;
    const a = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .select([
        'a.id',
        'a.status',
        'a.is_test',
        'a.owner_reply',
        'a.created_at',
        'a.expires_at',
        'a.ack_token_hash',
        'a.ack_token_expires_at',
        'a.escalated_at',
        'a.vehicle_id',
        'v.owner_user_id',
        'v.nickname',
        't.escalates',
        't.label_de',
        't.label_en',
      ])
      .where('a.id', '=', id)
      .executeTakeFirst();
    if (!a) return null;
    const hash = sha256(token);
    const open = a.ack_token_hash !== null && a.ack_token_hash.equals(hash);
    // A valid link that was never armed (no notification sent with it) is treated as invalid.
    if (!open && a.owner_reply === null) return null;
    return { a, hash, open };
  }

  /** What the reply page shows before the owner taps (opening the link changes nothing). */
  async preview(token: string) {
    const found = await this.load(token);
    if (!found) throw new NotFoundException({ error: 'link_invalid' });
    const { a, open } = found;
    const expired =
      a.expires_at < new Date() || (open && (a.ack_token_expires_at ?? a.expires_at) < new Date());
    return {
      nickname: a.nickname,
      type: { de: a.label_de, en: a.label_en },
      isTest: a.is_test,
      createdAt: a.created_at,
      expiresAt: a.expires_at,
      answered: !open,
      reply: a.owner_reply,
      expired: Boolean(expired),
      escalated: a.escalated_at !== null,
    };
  }

  /** NT-10: one atomic update decides status, reply and escalate_at (02-architecture §3 step 6). */
  async reply(
    token: string,
    reply: OwnerReply,
  ): Promise<{ reply: OwnerReply; escalating: boolean }> {
    const found = await this.load(token);
    if (!found) throw new NotFoundException({ error: 'link_invalid' });
    const { a, hash, open } = found;
    if (!open) throw new ConflictException({ error: 'already_answered', reply: a.owner_reply });
    if (a.expires_at < new Date() || (a.ack_token_expires_at ?? a.expires_at) < new Date()) {
      throw new GoneException({ error: 'link_expired' });
    }

    const escalating = await this.apply(a, reply, sql`ack_token_hash = ${hash}`);
    if (escalating === null)
      throw new ConflictException({ error: 'already_answered', reply: null });
    return { reply, escalating };
  }

  /**
   * "Ich komme" (or another reply) from the owner's app: the owner session proves who it is, so no link
   * token is needed. Single use like the link: once acknowledged, a second tap changes nothing.
   */
  async replyAsOwner(
    alertId: string,
    ownerId: string,
    reply: OwnerReply,
  ): Promise<{ reply: OwnerReply; escalating: boolean }> {
    const a = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .select([
        'a.id',
        'a.is_test',
        'a.owner_reply',
        'a.acknowledged_by',
        'a.expires_at',
        'a.escalated_at',
        'a.vehicle_id',
        'v.owner_user_id',
        't.escalates',
      ])
      .where('a.id', '=', alertId)
      .where('v.owner_user_id', '=', ownerId)
      .executeTakeFirst();
    if (!a) throw new NotFoundException({ error: 'alert_not_found' });
    if (a.owner_reply === 'coming' || a.acknowledged_by) {
      throw new ConflictException({
        error: 'already_answered',
        reply: a.owner_reply,
        acknowledgedBy: a.acknowledged_by,
      });
    }
    if (a.expires_at < new Date()) throw new GoneException({ error: 'alert_expired' });
    const escalating = await this.apply(
      a,
      reply,
      sql`(owner_reply IS NULL OR owner_reply <> 'coming') AND acknowledged_by IS NULL`,
    );
    if (escalating === null)
      throw new ConflictException({ error: 'already_answered', reply: null });
    return { reply, escalating };
  }

  /**
   * NT-10: one atomic update decides status, reply, who acknowledged and escalate_at (02-architecture
   * §3 step 6). "Ich komme" ends the escalation chain, even after it started; "In ca. 30 Min" postpones
   * a chain that has not started; "Bin nicht in der Nähe" starts it now. Returns null when the guard
   * did not match (answered in the meantime), else whether an escalation starts now.
   */
  private async apply(
    a: {
      id: string;
      is_test: boolean;
      escalates: boolean;
      escalated_at: Date | null;
      owner_user_id: string | null;
      vehicle_id: string;
    },
    reply: OwnerReply,
    guard: ReturnType<typeof sql<boolean>>,
  ): Promise<boolean | null> {
    const applies =
      !a.is_test && a.escalates && (await this.escalation.applies(a.owner_user_id, a.vehicle_id));
    const escalateAt =
      reply === 'coming' || !applies
        ? sql<Date | null>`NULL::timestamptz`
        : reply === 'in_30_min'
          ? sql<Date | null>`CASE WHEN escalated_at IS NULL THEN now() + interval '30 minutes' ELSE escalate_at END`
          : sql<Date | null>`CASE WHEN escalated_at IS NULL THEN now() ELSE escalate_at END`;
    const escalating = applies && reply === 'not_nearby' && a.escalated_at === null;

    return this.db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('alerts')
        .set({
          status: 'acknowledged',
          owner_reply: reply,
          acknowledged_at: sql`coalesce(acknowledged_at, now())`,
          ...(reply === 'coming' ? { acknowledged_by: 'owner' } : {}),
          ack_token_hash: null,
          escalate_at: escalateAt,
        })
        .where('id', '=', a.id)
        .where(guard)
        .where('status', 'in', ['dispatched', 'delivered', 'acknowledged', 'escalated'])
        .returning('id')
        .executeTakeFirst();
      if (row && escalating) {
        await trx
          .insertInto('outbox_events')
          .values({ topic: ESCALATE_TOPIC, payload: JSON.stringify({ alertId: a.id }) })
          .execute();
      }
      return row ? escalating : null;
    });
  }
}
