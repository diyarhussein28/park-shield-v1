import {
  ALERT_TYPE_DEFAULTS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
} from '@parkshield/shared';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { DB } from './types.generated';

// The database seed is the runtime truth; the shared constants are what the code type-checks against.
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});
afterAll(() => db.destroy());

describe('shared constants match the migration seed', () => {
  it('alert types', async () => {
    const rows = await db
      .selectFrom('alert_types')
      .select(['code', 'severity', 'escalates', 'sort_order'])
      .orderBy('sort_order')
      .execute();
    expect(
      rows.map((r) => ({
        code: r.code,
        severity: r.severity,
        escalates: r.escalates,
        sortOrder: r.sort_order,
      })),
    ).toEqual(ALERT_TYPE_DEFAULTS);
  });

  it('permissions and role grants', async () => {
    const perms = await db.selectFrom('permissions').select('code').execute();
    expect(perms.map((p) => p.code).sort()).toEqual([...PERMISSIONS].sort());
    const grants = await db
      .selectFrom('staff_role_permissions')
      .select(['role_code', 'permission_code'])
      .execute();
    for (const role of STAFF_ROLES) {
      const fromDb = grants
        .filter((g) => g.role_code === role)
        .map((g) => g.permission_code)
        .sort();
      expect(fromDb, role).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });
});
