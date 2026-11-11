import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'kysely';
import pg from 'pg';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { DB, ENV, LOGGER } from '../core/tokens';

export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

const MAX_ATTEMPTS = 10;
/** A worker that dies mid-batch blocks its events for this long, then another worker takes them. */
export const LEASE_SECONDS = 30;
/** Handlers in flight per worker; each mostly waits on the database or a provider. */
const CONCURRENCY = 8;

interface Leased {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Transactional outbox (02-architecture §3 step 3–4): producers insert events in the same transaction as
 * their data. The worker leases due events (SKIP LOCKED, so workers never take the same one) and runs
 * the handlers in parallel without holding a transaction. A NOTIFY on insert wakes it at once; the poll
 * is the fallback. Failures retry with exponential backoff; after 10 attempts the event is parked for ops.
 * Delivery is at-least-once: after a crash, events whose lease ran out are handled again.
 */
@Injectable()
export class OutboxService implements OnModuleDestroy {
  private readonly handlers = new Map<string, OutboxHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private again = false;
  private listener: pg.Client | null = null;
  private stopped = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** True while the NOTIFY listener is connected (health, tests). */
  get listening(): boolean {
    return this.listener !== null;
  }

  register(topic: string, handler: OutboxHandler): void {
    this.handlers.set(topic, handler);
  }

  /** Runs a drain now, or once more right after the one in progress. */
  private kick() {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.drain()
      .catch((err: unknown) => {
        this.logger.error({ err: String(err) }, 'outbox drain failed');
        return 0;
      })
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  start(intervalMs = 1000): void {
    this.timer = setInterval(() => this.kick(), intervalMs);
    void this.listen();
  }

  private async listen() {
    try {
      const client = new pg.Client({ connectionString: this.env.DATABASE_URL });
      client.on('notification', () => this.kick());
      // A lost connection only costs latency: the poll keeps working; reconnect after a pause.
      client.on('error', (err) => {
        this.logger.warn({ err: String(err) }, 'outbox listener lost');
        this.listener = null;
        if (!this.stopped) setTimeout(() => void this.listen(), 5000);
      });
      await client.connect();
      await client.query('LISTEN outbox_new');
      this.listener = client;
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'outbox listener unavailable, polling only');
      if (!this.stopped) setTimeout(() => void this.listen(), 5000);
    }
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.listener?.end().catch(() => undefined);
    await this.running;
  }

  private async lease(batch: number): Promise<Leased[]> {
    const topics = [...this.handlers.keys()];
    if (!topics.length) return [];
    const r = await sql<Leased>`
      UPDATE outbox_events SET locked_until = now() + make_interval(secs => ${LEASE_SECONDS})
       WHERE id IN (
         SELECT id FROM outbox_events
          WHERE processed_at IS NULL AND available_at <= now() AND attempts < ${MAX_ATTEMPTS}
            AND topic = ANY(${topics}) AND (locked_until IS NULL OR locked_until < now())
          ORDER BY id LIMIT ${batch} FOR UPDATE SKIP LOCKED)
      RETURNING id::text AS id, topic, payload, attempts`.execute(this.db);
    return r.rows;
  }

  private async run(e: Leased): Promise<boolean> {
    try {
      await this.handlers.get(e.topic)!(e.payload);
      await this.db
        .updateTable('outbox_events')
        .set({ processed_at: sql`now()`, locked_until: null })
        .where('id', '=', e.id as never)
        .execute();
      return true;
    } catch (err) {
      const attempts = e.attempts + 1;
      this.logger.error(
        { topic: e.topic, eventId: e.id, attempts, err: String(err) },
        'outbox handler failed',
      );
      await this.db
        .updateTable('outbox_events')
        .set({
          attempts,
          locked_until: null,
          available_at: sql`now() + make_interval(secs => ${Math.min(3600, 2 ** attempts * 5)})`,
        })
        .where('id', '=', e.id as never)
        .execute();
      return false;
    }
  }

  /** Processes due events until none are left; returns how many succeeded. */
  async drain(batch = 50): Promise<number> {
    let done = 0;
    for (;;) {
      const events = await this.lease(batch);
      if (!events.length) return done;
      // A small pool: at most CONCURRENCY handlers at once, in id order as far as possible.
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, events.length) }, async () => {
          while (next < events.length) {
            if (await this.run(events[next++]!)) done++;
          }
        }),
      );
      if (events.length < batch) return done;
    }
  }
}
