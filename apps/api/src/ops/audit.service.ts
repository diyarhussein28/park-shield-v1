import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';
import { AUDIT_BUCKET, type AuditBucket } from '../providers/ports';
import { StaffService, type StaffContext } from './staff.service';

const BATCH = 500;
/**
 * Identity values are handed out at INSERT but become visible at COMMIT, so a row can appear after a
 * higher id was already streamed. Rows are only streamed once they are this old; audit inserts are
 * single autocommit statements, so this is ample.
 */
const SETTLE_SECONDS = 10;
const RETAIN_DAYS = 400; // 12 months (AD-17) plus margin; the bucket's own default is the floor.
const GENESIS = '0'.repeat(64);

const sha256 = (s: Buffer | string) => createHash('sha256').update(s).digest('hex');
const pad = (n: bigint | number | string) => String(n).padStart(12, '0');

interface Header {
  v: 1;
  prev: string;
  first: string;
  last: string;
  count: number;
}

export interface VerifyReport {
  ok: boolean;
  objects: number;
  rows: number;
  lastId: string;
  problems: string[];
}

/**
 * US-42 / AD-17: live copy of the append-only audit log to the Object Lock bucket. Each object is a
 * JSON-lines file whose first line names the previous object's hash, so the objects form a chain:
 * a deleted, reordered or edited object, or an edited row in the database, shows up in `verify`.
 */
@Injectable()
export class AuditStreamService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUDIT_BUCKET) private readonly bucket: AuditBucket,
  ) {}

  static body(prev: string, rows: Record<string, unknown>[]): string {
    const first = String(rows[0]!.id);
    const last = String(rows.at(-1)!.id);
    const header: Header = { v: 1, prev, first, last, count: rows.length };
    return [header, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n';
  }

  private async rows(after: string, upTo?: string, settleSeconds = SETTLE_SECONDS) {
    let q = this.db
      .selectFrom('audit_logs')
      .select([
        sql<string>`id::text`.as('id'),
        'actor_id',
        'actor_kind',
        'action',
        'is_read',
        'entity',
        'entity_id',
        'meta',
        sql<string>`to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as(
          'created_at',
        ),
      ])
      .where('id', '>', after as never)
      .orderBy('id')
      .limit(BATCH);
    q = upTo
      ? q.where('id', '<=', upTo as never)
      : q.where('created_at', '<=', sql<Date>`now() - make_interval(secs => ${settleSeconds})`);
    return q.execute();
  }

  /** Streams everything that has settled; returns the number of rows copied. */
  async flush(maxRows = 5000, settleSeconds = SETTLE_SECONDS): Promise<number> {
    let copied = 0;
    while (copied < maxRows) {
      const state = await this.db
        .selectFrom('audit_stream_state')
        .select([sql<string>`last_id::text`.as('lastId'), 'last_hash as lastHash'])
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      const rows = await this.rows(state.lastId, undefined, settleSeconds);
      if (!rows.length) break;
      const body = AuditStreamService.body(state.lastHash, rows);
      const first = rows[0]!;
      const last = rows.at(-1)!;
      const key = `audit/${first.created_at.slice(0, 10).replace(/-/g, '/')}/${pad(first.id)}-${pad(last.id)}.jsonl`;
      await this.bucket.put(
        key,
        Buffer.from(body),
        new Date(Date.now() + RETAIN_DAYS * 86_400_000),
      );
      // Only one process advances the cursor; a second one wrote the identical object ("exists").
      await this.db
        .updateTable('audit_stream_state')
        .set({
          last_id: last.id as never,
          last_hash: sha256(body),
          last_key: key,
          updated_at: sql`now()`,
        })
        .where('id', '=', 1)
        .where('last_id', '=', state.lastId as never)
        .execute();
      copied += rows.length;
    }
    return copied;
  }

  async status() {
    const s = await this.db
      .selectFrom('audit_stream_state')
      .select([
        sql<string>`last_id::text`.as('lastId'),
        'last_key as lastKey',
        'updated_at as updatedAt',
      ])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const { pending, oldest } = await this.db
      .selectFrom('audit_logs')
      .select((eb) => [
        eb.fn.countAll<string>().as('pending'),
        eb.fn.min('created_at').as('oldest'),
      ])
      .where('id', '>', s.lastId as never)
      .executeTakeFirstOrThrow();
    return { ...s, pending: Number(pending), oldestPendingAt: (oldest as Date | null) ?? null };
  }

  /** Walks the whole chain in the bucket and compares every streamed row still in the database. */
  async verify(): Promise<VerifyReport> {
    const problems: string[] = [];
    // The cursor first: objects the worker writes while we read are newer and are left out.
    const state = await this.db
      .selectFrom('audit_stream_state')
      .select(['last_hash as lastHash', sql<string>`last_id::text`.as('lastId')])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const keys = await this.bucket.list('audit/');
    const ordered: { key: string; header: Header; lines: string[]; body: Buffer }[] = [];
    for (const key of keys) {
      const body = await this.bucket.get(key);
      if (!body) {
        problems.push(`${key}: listed but not readable`);
        continue;
      }
      const lines = body.toString('utf8').trimEnd().split('\n');
      try {
        const header = JSON.parse(lines[0]!) as Header;
        if (BigInt(header.first) > BigInt(state.lastId)) continue;
        ordered.push({ key, header, lines: lines.slice(1), body });
      } catch {
        problems.push(`${key}: no header`);
      }
    }
    ordered.sort((a, b) => Number(BigInt(a.header.first) - BigInt(b.header.first)));
    let prev = GENESIS;
    let rows = 0;
    let lastId = '0';
    for (const o of ordered) {
      if (o.header.prev !== prev)
        problems.push(`${o.key}: chain broken (prev hash does not match)`);
      if (o.lines.length !== o.header.count)
        problems.push(`${o.key}: row count differs from header`);
      prev = sha256(o.body);
      rows += o.lines.length;
      // The database must still hold exactly these rows (unless retention removed them).
      const db = await this.rows(String(BigInt(o.header.first) - 1n), o.header.last);
      const inBucket = new Map(
        o.lines.map((l) => [String((JSON.parse(l) as { id: string }).id), l]),
      );
      for (const r of db) {
        const line = inBucket.get(r.id);
        if (!line) problems.push(`${o.key}: row ${r.id} is in the database but not in the bucket`);
        else if (line !== JSON.stringify(r))
          problems.push(`${o.key}: row ${r.id} differs from the database`);
      }
      lastId = o.header.last;
    }
    if (state.lastHash !== prev)
      problems.push('stream state does not match the last object in the bucket');
    if (state.lastId !== lastId && !(state.lastId === '0' && !ordered.length))
      problems.push(`stream state says ${state.lastId}, bucket ends at ${lastId}`);
    return { ok: problems.length === 0, objects: ordered.length, rows, lastId, problems };
  }
}

/** The ops audit viewer (audit.read). Looking at the trail is itself a read event. */
@Injectable()
export class AuditViewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(AuditStreamService) private readonly stream: AuditStreamService,
  ) {}

  async list(
    by: StaffContext,
    f: {
      action?: string;
      entity?: string;
      entityId?: string;
      actorId?: string;
      before?: string;
      reads?: boolean;
    },
  ) {
    let q = this.db
      .selectFrom('audit_logs as a')
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .select([
        sql<string>`a.id::text`.as('id'),
        'a.action',
        'a.is_read as isRead',
        'a.entity',
        'a.entity_id as entityId',
        'a.meta',
        'a.created_at as at',
        'a.actor_id as actorId',
        'u.display_name as actor',
      ])
      .orderBy('a.id', 'desc')
      .limit(100);
    if (f.action) q = q.where('a.action', 'like', `${f.action.replace(/[%_\\]/g, '\\$&')}%`);
    if (f.entity) q = q.where('a.entity', '=', f.entity);
    if (f.entityId) q = q.where('a.entity_id', '=', f.entityId);
    if (f.actorId) q = q.where('a.actor_id', '=', f.actorId);
    if (f.before) q = q.where('a.id', '<', f.before as never);
    if (f.reads === false) q = q.where('a.is_read', '=', false);
    const [entries, status] = await Promise.all([q.execute(), this.stream.status()]);
    await this.staff.auditRead(by.userId, 'audit.view', 'audit_logs', null, {
      filter: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)),
    });
    return { entries, stream: status };
  }
}
