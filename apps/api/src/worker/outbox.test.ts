import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { createLogger } from '../core/logger';
import { createHarness, resetState, type Harness } from '../test/harness';
import { OutboxService } from './outbox.service';

let h: Harness;
const env = loadEnv();

beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const outbox = () => new OutboxService(h.db, createLogger(env), env);
const add = (n: number, topic = 'test.topic') =>
  h.db
    .insertInto('outbox_events')
    .values(Array.from({ length: n }, (_, i) => ({ topic, payload: JSON.stringify({ i }) })))
    .execute();
const pending = async () =>
  (
    await h.db
      .selectFrom('outbox_events')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('processed_at', 'is', null)
      .executeTakeFirstOrThrow()
  ).n;

describe('outbox (02-architecture §3, US-45 chaos drills)', () => {
  it('two workers draining at once handle every event exactly once', async () => {
    await add(120);
    const seen: number[] = [];
    const a = outbox();
    const b = outbox();
    for (const w of [a, b])
      w.register('test.topic', async (p) => {
        await new Promise((ok) => setTimeout(ok, 2));
        seen.push(p.i as number);
      });
    const [x, y] = await Promise.all([a.drain(10), b.drain(10)]);
    expect(x + y).toBe(120);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toHaveLength(120);
    expect(Number(await pending())).toBe(0);
  });

  it('a worker that dies mid-batch loses nothing: the lease runs out and another worker takes over', async () => {
    await add(5);
    // The "dead" worker leased the events and never finished them.
    await sql`UPDATE outbox_events SET locked_until = now() + interval '30 seconds'`.execute(h.db);
    const w = outbox();
    const seen: number[] = [];
    w.register('test.topic', async (p) => void seen.push(p.i as number));
    expect(await w.drain()).toBe(0); // still leased: not touched
    await sql`UPDATE outbox_events SET locked_until = now() - interval '1 second'`.execute(h.db);
    expect(await w.drain()).toBe(5);
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('a failing handler retries with backoff and the others go on', async () => {
    await add(3);
    const w = outbox();
    w.register('test.topic', async (p) => {
      if (p.i === 1) throw new Error('provider down');
    });
    expect(await w.drain()).toBe(2);
    const failed = await h.db
      .selectFrom('outbox_events')
      .select(['attempts', 'locked_until', sql<boolean>`available_at > now()`.as('later')])
      .where('processed_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(failed).toMatchObject({ attempts: 1, locked_until: null, later: true });
  });

  it('wakes up on NOTIFY instead of waiting for the poll', async () => {
    const w = outbox();
    const seen: number[] = [];
    w.register('test.topic', async (p) => void seen.push(p.i as number));
    w.start(60_000); // the poll would only come after a minute
    try {
      await expect.poll(() => w.listening, { timeout: 10_000 }).toBe(true);
      await add(1);
      await expect.poll(() => seen, { timeout: 3000 }).toEqual([0]);
    } finally {
      await w.onModuleDestroy();
    }
  });
});
