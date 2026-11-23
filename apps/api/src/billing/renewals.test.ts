import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, mailbox, resetState, subscribe, type Harness } from '../test/harness';
import { RenewalsService } from './renewals.service';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const reminders = async () => (await mailbox(h)).filter((m) => m.tag === 'renewal_reminder');

describe('renewal reminder', () => {
  it('reminds once per yearly period, also when the job runs every hour', async () => {
    await subscribe(h, 'renew@example.de');
    await sql`UPDATE subscriptions SET interval = 'year', cancel_at_period_end = false,
      current_period_start = now() - interval '345 days', current_period_end = now() + interval '20 days'`.execute(
      h.db,
    );
    const renewals = h.app.get(RenewalsService);
    expect(await renewals.remind()).toBe(1);
    expect(await renewals.remind()).toBe(0);
    expect(await reminders()).toHaveLength(1);
  });

  it('never reminds for a store sandbox period of one hour that renews all day', async () => {
    await subscribe(h, 'sandbox@example.de');
    const renewals = h.app.get(RenewalsService);
    for (let i = 0; i < 3; i++) {
      // Each sandbox renewal moves the period by one hour.
      await sql`UPDATE subscriptions SET interval = 'year', cancel_at_period_end = false,
        current_period_start = now() + make_interval(hours => ${i}),
        current_period_end = now() + make_interval(hours => ${i + 1})`.execute(h.db);
      expect(await renewals.remind()).toBe(0);
    }
    expect(await reminders()).toHaveLength(0);
  });
});
