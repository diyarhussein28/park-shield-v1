import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql, type Transaction } from 'kysely';
import type { Db } from '../core/core.module';
import { randomToken, sha256, type FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB, VALKEY } from '../core/tokens';
import type { DB as Schema } from '../db/types.generated';
import { PhoneBansService } from '../abuse/phone-bans.service';
import { filterText } from '../moderation/text-filter';
import { WordListsService } from '../moderation/word-lists.service';

export type ChatRole = 'owner' | 'scanner';
export type CloseReason = 'owner' | 'inactivity' | 'max_duration' | 'alert_deleted';

/** Valkey key while the scanner's page is connected (presence); refreshed by the socket heartbeat. */
export const presenceKey = (alertId: string) => `chat:online:${alertId}`;
export const PRESENCE_TTL_SECONDS = 45;

export interface ChatMessageView {
  id: string;
  from: ChatRole;
  text: string;
  at: Date;
}

/** Owner messages that look like personal data get a warning in the app before sending (not blocked). */
const PHONE = /(?:\+|00)?\d[\d\s/().-]{6,}\d/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const ADDRESS = /\b[\p{L}ß.-]{3,}(?:straße|strasse|str\.|weg|gasse|allee|platz|ring|damm)\s*\d+/iu;
export const looksPersonal = (text: string) =>
  PHONE.test(text) || EMAIL.test(text) || ADDRESS.test(text);

/**
 * Owner-initiated live chat (Socket.io, gateway in chat.gateway.ts). Locked until the owner opens it;
 * text only; 500 characters and 20 messages per side; scanner messages pass the text filter (links,
 * numbers, addresses, insults); ends when the owner closes it, after 20 minutes without a message, or
 * 3 hours after opening (all configurable). PostgreSQL is the source of truth (chat_sessions); messages
 * are stored encrypted (alert_messages) and deleted with the token hash 24 h after the chat closed.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(WordListsService) private readonly wordLists: WordListsService,
    @Inject(PhoneBansService) private readonly phoneBans: PhoneBansService,
  ) {}

  async limits() {
    const [maxChars, maxPerSide, maxOwner, inactivity, maxMinutes] = await Promise.all([
      this.settings.get('chat.max_message_chars', 500),
      this.settings.get('chat.max_messages_per_side', 20),
      this.settings.get('chat.max_owner_messages', 0),
      this.settings.get('chat.inactivity_minutes', 20),
      this.settings.get('chat.max_minutes', 180),
    ]);
    return {
      maxChars: Number(maxChars),
      /** Messages the person at the vehicle may send (the anonymous side, against spam). */
      maxPerSide: Number(maxPerSide),
      /** Messages the owner may send; 0 = no limit. */
      maxOwnerMessages: Number(maxOwner),
      inactivityMinutes: Number(inactivity),
      maxMinutes: Number(maxMinutes),
    };
  }

  async quickReplies(lang: 'de' | 'en'): Promise<string[]> {
    const raw = await this.settings.get<unknown>('chat.quick_replies', {});
    const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[lang] : null;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  }

  /**
   * With the alert, in its transaction: a locked session and the scanner's chat token (256-bit, only the
   * SHA-256 is stored). The token travels in the URL fragment of the scanner's page, never to a server.
   */
  async createSession(trx: Transaction<Schema>, alertId: string): Promise<string> {
    const token = randomToken();
    await trx
      .insertInto('chat_sessions')
      .values({ alert_id: alertId, token_hash: sha256(token) })
      .execute();
    return token;
  }

  /** The scanner's socket handshake: alert id + token from the fragment. */
  async verifyScanner(alertId: string, token: string): Promise<boolean> {
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored character classes with bounded lengths, linear
    if (!/^[0-9a-f-]{36}$/.test(alertId) || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
    const row = await this.db
      .selectFrom('chat_sessions')
      .select('alert_id')
      .where('alert_id', '=', alertId)
      .where('token_hash', '=', sha256(token))
      .executeTakeFirst();
    return Boolean(row);
  }

  /** The owner of the alert's vehicle, or null. */
  async ownerOf(alertId: string): Promise<{ ownerId: string; lang: 'de' | 'en' } | null> {
    const row = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('users as u', 'u.id', 'v.owner_user_id')
      .select(['u.id', 'u.preferred_lang'])
      .where('a.id', '=', alertId)
      .executeTakeFirst();
    return row ? { ownerId: row.id, lang: row.preferred_lang } : null;
  }

  private async requireOwner(alertId: string, ownerId: string) {
    const owner = await this.ownerOf(alertId);
    if (!owner || owner.ownerId !== ownerId)
      throw new NotFoundException({ error: 'alert_not_found' });
  }

  /**
   * Abuse module first: a sender who is blocked (scanner block, per vehicle or global) or whose
   * confirmed number is banned can never be written to. Nothing here bypasses those rules.
   */
  async senderBlocked(alertId: string): Promise<boolean> {
    const a = await this.db
      .selectFrom('alerts')
      .select([
        'qr_token_id',
        'vehicle_id',
        'block_ref',
        'scanner_ref',
        'verified_phone_hash',
        'status',
        'moderation',
      ])
      .where('id', '=', alertId)
      .executeTakeFirst();
    if (!a) return true;
    if (a.status === 'blocked' || a.moderation === 'blocked') return true;
    const refs = [
      ...(a.block_ref ? [{ ref: a.block_ref, token: a.qr_token_id as string | null }] : []),
      ...(a.scanner_ref ? [{ ref: a.scanner_ref, token: null }] : []),
    ];
    for (const r of refs) {
      let q = this.db
        .selectFrom('scanner_blocks')
        .select('ref')
        .where('ref', '=', r.ref)
        .where('expires_at', '>', sql<Date>`now()`);
      q = r.token ? q.where('qr_token_id', '=', r.token) : q.where('qr_token_id', 'is', null);
      if (await q.executeTakeFirst()) return true;
    }
    return a.verified_phone_hash
      ? this.phoneBans.isBanned(a.verified_phone_hash, a.vehicle_id)
      : false;
  }

  async online(alertId: string): Promise<boolean> {
    return (await this.valkey.exists(presenceKey(alertId))) === 1;
  }

  /** State for one side: status, limits, counts, presence and (unless purged) the messages. */
  async state(alertId: string, role: ChatRole) {
    const s = await this.db
      .selectFrom('chat_sessions')
      .selectAll()
      .where('alert_id', '=', alertId)
      .executeTakeFirst();
    if (!s) return null;
    const [limits, messages, online] = await Promise.all([
      this.limits(),
      s.purged_at ? Promise.resolve([]) : this.messages(alertId),
      this.online(alertId),
    ]);
    const mine = role === 'owner' ? s.owner_msg_count : s.scanner_msg_count;
    // null = no limit for this side (the owner by default).
    const cap = role === 'owner' ? limits.maxOwnerMessages : limits.maxPerSide;
    return {
      status: s.status,
      openedAt: s.opened_at,
      closedAt: s.closed_at,
      closeReason: s.close_reason,
      purged: s.purged_at !== null,
      remaining: cap > 0 ? Math.max(0, cap - mine) : null,
      limits,
      scanner: { online, lastSeenAt: s.scanner_seen_at },
      readByOther: role === 'owner' ? s.scanner_read_at : s.owner_read_at,
      messages,
    };
  }

  async messages(alertId: string): Promise<ChatMessageView[]> {
    const rows = await this.db
      .selectFrom('alert_messages')
      .select(['id', 'sender', 'body_enc', 'created_at'])
      .where('alert_id', '=', alertId)
      .where('sender', 'in', ['owner', 'scanner'])
      .orderBy('created_at')
      .execute();
    return rows.map((m) => ({
      id: m.id,
      from: m.sender as ChatRole,
      text: this.crypto.decrypt(m.body_enc),
      at: m.created_at,
    }));
  }

  /** "Rückfrage stellen / Chat öffnen": locked → active. Only the owner, never for a blocked sender. */
  async open(alertId: string, ownerId: string) {
    await this.requireOwner(alertId, ownerId);
    if (await this.senderBlocked(alertId)) {
      throw new ForbiddenException({ error: 'sender_blocked' });
    }
    const alert = await this.db
      .selectFrom('alerts')
      .select(['expires_at', 'is_test'])
      .where('id', '=', alertId)
      .executeTakeFirstOrThrow();
    if (alert.expires_at < new Date()) throw new GoneException({ error: 'alert_expired' });
    const row = await this.db
      .updateTable('chat_sessions')
      .set({ status: 'active', opened_at: sql`now()`, last_message_at: sql`now()` })
      .where('alert_id', '=', alertId)
      .where('status', '=', 'locked')
      .returning('alert_id')
      .executeTakeFirst();
    if (!row) {
      const s = await this.db
        .selectFrom('chat_sessions')
        .select('status')
        .where('alert_id', '=', alertId)
        .executeTakeFirst();
      if (!s) throw new NotFoundException({ error: 'chat_unavailable' });
      if (s.status === 'closed') throw new ConflictException({ error: 'chat_closed' });
    }
    // The owner who opens the chat has clearly noticed the alert, so the reminder to them is
    // pointless (owner decision 2026-11-20). Escalation to trusted contacts is untouched: the owner
    // may write "I can't come", and only „Ich komme" acknowledges the alert.
    await this.db
      .updateTable('alerts')
      .set({ remind_at: null })
      .where('id', '=', alertId)
      .where('reminded_at', 'is', null)
      .execute();
    return this.state(alertId, 'owner');
  }

  /** Ends the chat (owner, inactivity, max. duration). Returns false when it was not active. */
  async close(alertId: string, reason: CloseReason, ownerId?: string): Promise<boolean> {
    if (ownerId) await this.requireOwner(alertId, ownerId);
    const row = await this.db
      .updateTable('chat_sessions')
      .set({ status: 'closed', closed_at: sql`now()`, close_reason: reason })
      .where('alert_id', '=', alertId)
      .where('status', '=', 'active')
      .returning('alert_id')
      .executeTakeFirst();
    if (row) await this.valkey.del(presenceKey(alertId));
    return Boolean(row);
  }

  /**
   * One message. Scanner text passes the filter (a blocked text never arrives); owner text is sent as
   * written (the app warns before personal data). Limits are enforced in the same atomic update.
   */
  async send(
    alertId: string,
    role: ChatRole,
    raw: string,
  ): Promise<
    | { ok: true; message: ChatMessageView }
    | { ok: false; error: 'chat_not_active' | 'too_long' | 'empty' | 'limit_reached' | 'filtered' }
  > {
    const text = raw.replace(/\s+$/g, '').replace(/^\s+/g, '');
    const limits = await this.limits();
    if (!text) return { ok: false, error: 'empty' };
    if ([...text].length > limits.maxChars) return { ok: false, error: 'too_long' };
    if (role === 'scanner') {
      const verdict = filterText(text, await this.wordLists.forFilter());
      if (!verdict.ok) return { ok: false, error: 'filtered' };
    }
    const counter = role === 'owner' ? 'owner_msg_count' : 'scanner_msg_count';
    // The person at the vehicle always has a limit; the owner only when ops sets one (0 = none).
    const cap = role === 'owner' ? limits.maxOwnerMessages : limits.maxPerSide;
    return this.db.transaction().execute(async (trx) => {
      let update = trx
        .updateTable('chat_sessions')
        .set({ [counter]: sql`${sql.ref(counter)} + 1`, last_message_at: sql`now()` })
        .where('alert_id', '=', alertId)
        .where('status', '=', 'active');
      if (cap > 0) update = update.where(sql.ref(counter), '<', cap);
      const s = await update.returning('status').executeTakeFirst();
      if (!s) {
        const cur = await trx
          .selectFrom('chat_sessions')
          .select(['status', counter])
          .where('alert_id', '=', alertId)
          .executeTakeFirst();
        return {
          ok: false as const,
          error:
            cur?.status === 'active' ? ('limit_reached' as const) : ('chat_not_active' as const),
        };
      }
      const m = await trx
        .insertInto('alert_messages')
        .values({
          alert_id: alertId,
          sender: role,
          body_enc: this.crypto.encrypt(text),
          key_version: this.crypto.keyVersion,
          moderation: role === 'scanner' ? 'passed' : 'not_required',
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow();
      return { ok: true as const, message: { id: m.id, from: role, text, at: m.created_at } };
    });
  }

  async markRead(alertId: string, role: ChatRole): Promise<Date> {
    const row = await this.db
      .updateTable('chat_sessions')
      .set(role === 'owner' ? { owner_read_at: sql`now()` } : { scanner_read_at: sql`now()` })
      .where('alert_id', '=', alertId)
      .returning(role === 'owner' ? 'owner_read_at' : 'scanner_read_at')
      .executeTakeFirst();
    const at = row ? Object.values(row)[0] : null;
    return at instanceof Date ? at : new Date();
  }

  async scannerSeen(alertId: string, connected: boolean): Promise<void> {
    if (connected) await this.valkey.set(presenceKey(alertId), '1', 'EX', PRESENCE_TTL_SECONDS);
    await this.db
      .updateTable('chat_sessions')
      .set({ scanner_seen_at: sql`now()` })
      .where('alert_id', '=', alertId)
      .execute();
  }

  async scannerGone(alertId: string): Promise<void> {
    await this.valkey.del(presenceKey(alertId));
    await this.scannerSeen(alertId, false);
  }

  /**
   * Timeouts (the gateway runs this every few seconds under a Valkey lock): no message for N minutes, or
   * M minutes after opening. Returns the chats it closed so the gateway can tell both sides.
   */
  async sweep(): Promise<{ alertId: string; reason: CloseReason }[]> {
    const l = await this.limits();
    const rows = await sql<{ alert_id: string; close_reason: CloseReason }>`
      UPDATE chat_sessions SET status = 'closed', closed_at = now(),
        close_reason = (CASE WHEN opened_at <= now() - make_interval(mins => ${l.maxMinutes})
                             THEN 'max_duration' ELSE 'inactivity' END)::chat_close_reason
       WHERE status = 'active'
         AND (opened_at <= now() - make_interval(mins => ${l.maxMinutes})
              OR last_message_at <= now() - make_interval(mins => ${l.inactivityMinutes}))
       RETURNING alert_id, close_reason`.execute(this.db);
    for (const r of rows.rows) await this.valkey.del(presenceKey(r.alert_id));
    return rows.rows.map((r) => ({ alertId: r.alert_id, reason: r.close_reason }));
  }
}
