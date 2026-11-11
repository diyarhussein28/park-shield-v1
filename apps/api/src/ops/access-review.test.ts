import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpsApp } from '../apps';
import { loadEnv } from '../config/env';
import { createLogger } from '../core/logger';
import { createHarness, mailbox, resetState, type Harness } from '../test/harness';
import { AccessReviewService } from './access-review.service';
import { StaffService } from './staff.service';

let h: Harness;
let ops: NestFastifyApplication;
let staff: StaffService;

beforeAll(async () => {
  h = await createHarness();
  const env = loadEnv({
    BREVO_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    D360_API_KEY: '',
    PRINT_PARTNER: '',
  });
  ops = await buildOpsApp(env, createLogger(env));
  await ops.init();
  await ops.getHttpAdapter().getInstance().ready();
  staff = ops.get(StaffService);
});
afterAll(async () => {
  await ops.close();
  await h.close();
});
beforeEach(() => resetState(h));

async function member(email: string, roles: string[]) {
  const { userId } = await staff.invite(null, { email, name: email.split('@')[0]!, roles });
  const s = await staff.createSession(userId, 'Chrome · Windows');
  return {
    userId,
    headers: { cookie: `ps_ops_session=${s.token}; ps_ops_csrf=${s.csrf}`, 'x-csrf-token': s.csrf },
  };
}

describe('quarterly permission review (US-45)', () => {
  it('reports everyone with roles, records the review in the audit log and ends removed access', async () => {
    const boss = await member('chefin@parkshield.de', ['superadmin']);
    const support = await member('support@parkshield.de', ['support']);
    const report = (
      await ops.inject({ method: 'GET', url: '/ops/v1/staff/review', headers: boss.headers })
    ).json();
    expect(report.due).toBe(true);
    expect(report.staff.map((s: { email: string }) => s.email)).toEqual([
      'chefin@parkshield.de',
      'support@parkshield.de',
    ]);
    expect(report.staff[1]).toMatchObject({
      roles: ['support'],
      hasPasskey: false,
      inactiveDays: 0,
    });
    expect(report.staff[1].lastLoginAt).not.toBeNull();

    const csv = await ops.inject({
      method: 'GET',
      url: '/ops/v1/staff/review.csv',
      headers: boss.headers,
    });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('"support@parkshield.de"');

    const incomplete = await ops.inject({
      method: 'POST',
      url: '/ops/v1/staff/review',
      headers: boss.headers,
      payload: { keep: [boss.userId], remove: [], note: 'Q4-Prüfung durch Geschäftsführung' },
    });
    expect(incomplete.json()).toMatchObject({ error: 'incomplete', expected: 2 });

    const done = await ops.inject({
      method: 'POST',
      url: '/ops/v1/staff/review',
      headers: boss.headers,
      payload: {
        keep: [boss.userId],
        remove: [support.userId],
        note: 'Q4-Prüfung durch Geschäftsführung',
      },
    });
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({ kept: 1, removed: 1 });
    expect(
      (await ops.inject({ method: 'GET', url: '/ops/v1/me', headers: support.headers })).statusCode,
    ).toBe(401);
    const audit = await h.db
      .selectFrom('audit_logs')
      .select(['actor_id', 'meta'])
      .where('action', '=', 'staff.access_review')
      // The audit log is append-only and never reset between runs: only this run's review.
      .where('actor_id', '=', boss.userId)
      .executeTakeFirstOrThrow();
    expect(audit.actor_id).toBe(boss.userId);
    expect(audit.meta).toMatchObject({
      kept: 1,
      removed: [{ id: support.userId, roles: ['support'] }],
    });
    const after = (
      await ops.inject({ method: 'GET', url: '/ops/v1/staff/review', headers: boss.headers })
    ).json();
    expect(after).toMatchObject({ due: false, last: { kept: 1, removed: 1 } });
    expect(after.staff).toHaveLength(1);

    const lockout = await ops.inject({
      method: 'POST',
      url: '/ops/v1/staff/review',
      headers: boss.headers,
      payload: { keep: [], remove: [boss.userId], note: 'Versehentlich alle entfernen' },
    });
    expect(lockout.json().error).toBe('last_manager');
    const admin = await member('admin@parkshield.de', ['admin']);
    expect(
      (await ops.inject({ method: 'GET', url: '/ops/v1/staff/review', headers: admin.headers }))
        .statusCode,
    ).toBe(403);
  });

  it('removes the roles of staff inactive for 90 days, but never the last manager', async () => {
    const boss = await member('chefin@parkshield.de', ['superadmin']);
    const old = await member('alt@parkshield.de', ['finance']);
    await sql`UPDATE users SET last_login_at = now() - interval '100 days' WHERE id IN (${boss.userId}, ${old.userId})`.execute(
      h.db,
    );
    const svc = ops.get(AccessReviewService);
    expect(await svc.expireInactive()).toBe(1);
    const roles = await h.db.selectFrom('staff_role_assignments').select('user_id').execute();
    expect(roles.map((r) => r.user_id)).toEqual([boss.userId]);
    expect(
      await h.db
        .selectFrom('audit_logs')
        .select(['actor_id', 'entity_id'])
        .where('action', '=', 'staff.expired')
        .where('entity_id', 'in', [boss.userId, old.userId]) // this run's staff only
        .execute(),
    ).toEqual([{ actor_id: null, entity_id: old.userId }]);
    const mail = (await mailbox(h)).find((m) => m.tag === 'staff_expired');
    expect(mail?.text).toContain('alt@parkshield.de');
    expect(await svc.expireInactive()).toBe(0);
  });

  it('reminds the team once a week while the review is overdue', async () => {
    await member('chefin@parkshield.de', ['superadmin']);
    const svc = ops.get(AccessReviewService);
    expect(await svc.remindDue()).toBe(true);
    expect(await svc.remindDue()).toBe(false);
    expect((await mailbox(h)).filter((m) => m.tag === 'staff_review_due')).toHaveLength(1);
  });
});
