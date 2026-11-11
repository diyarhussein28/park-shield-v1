import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpsApp, OpsAppModule } from '../apps';
import { loadEnv } from '../config/env';
import { createLogger } from '../core/logger';
import { OPS_ACCESS, type OpsAccess } from '../ops/access';
import { StaffService } from '../ops/staff.service';
import { createHarness, resetState, type Harness } from '../test/harness';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'] as const;
const ZERO = '00000000-0000-4000-8000-000000000000';

interface Route {
  method: (typeof METHODS)[number];
  path: string;
  access: OpsAccess;
}

function opsRoutes(): Route[] {
  const env = loadEnv();
  const controllers = (OpsAppModule.forRoot(env, createLogger(env)).controllers ?? []) as (new (
    ...a: never[]
  ) => object)[];
  const out: Route[] = [];
  for (const ctrl of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
    const classAccess = Reflect.getMetadata(OPS_ACCESS, ctrl) as OpsAccess | undefined;
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      const handler = Object.getOwnPropertyDescriptor(ctrl.prototype, name)?.value as unknown;
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (path === undefined) continue;
      out.push({
        method: METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number]!,
        path: `/${[base, path].filter((p) => p && p !== '/').join('/')}`,
        access: (Reflect.getMetadata(OPS_ACCESS, handler) ?? classAccess) as OpsAccess,
      });
    }
  }
  return out;
}

/** Placeholder values: ids are a well-formed UUID that exists nowhere, everything else unknown. */
const url = (path: string) =>
  path.replace(/:(\w+)/g, (_m, name: string) => (/id$/i.test(name) ? ZERO : 'x'));

/**
 * StaffOnly routes that check permissions in the handler (either of two): with no permission at all
 * they must refuse too.
 */
const MANUAL_CHECK = new Set([
  'GET /ops/v1/break-glass',
  'GET /ops/v1/partners',
  'GET /ops/v1/promo-codes',
]);

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
  await h.db.deleteFrom('staff_roles').where('code', 'like', 'authz_%').execute();
  await ops.close();
  await h.close();
});
beforeEach(() => resetState(h));

let n = 0;
/** A staff session whose only permissions are exactly `perms` (through a throwaway role). */
async function staffWith(perms: string[]) {
  const id = ++n;
  const role = `authz_${id}`;
  await h.db
    .insertInto('staff_roles')
    .values({ code: role, name: `authz ${id}` })
    .execute();
  if (perms.length)
    await h.db
      .insertInto('staff_role_permissions')
      .values(perms.map((p) => ({ role_code: role, permission_code: p })))
      .execute();
  const u = await h.db
    .insertInto('users')
    .values({ email: `authz-${id}@parkshield.de`, kind: 'staff', display_name: `authz ${id}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.db
    .insertInto('staff_role_assignments')
    .values({ user_id: u.id, role_code: role })
    .execute();
  const s = await staff.createSession(u.id, 'Chrome · Windows');
  return { cookie: `ps_ops_session=${s.token}; ps_ops_csrf=${s.csrf}`, csrf: s.csrf };
}

async function call(r: Route, who?: { cookie: string; csrf: string }, csrf = true) {
  const res = await ops.inject({
    method: r.method as 'GET',
    url: url(r.path),
    headers: who ? { cookie: who.cookie, ...(csrf ? { 'x-csrf-token': who.csrf } : {}) } : {},
    ...(r.method === 'GET' || r.method === 'HEAD' ? {} : { payload: {} }),
  });
  const json = String(res.headers['content-type'] ?? '').includes('application/json');
  return {
    status: res.statusCode,
    error: json ? (res.json() as { error?: string } | null)?.error : undefined,
  };
}

describe('api-ops authorisation matrix (US-45, ASVS 4.1–4.2)', () => {
  const routes = opsRoutes();
  // Logout ends the session the loops below reuse; its access is the same as /me (StaffOnly).
  const guarded = routes.filter(
    (r) => r.access.kind !== 'public' && !(r.method === 'POST' && r.path === '/ops/v1/auth/logout'),
  );

  it('covers the whole ops API', () => {
    expect(guarded.length).toBeGreaterThan(50);
  });

  it('every non-public route refuses requests without a staff session', async () => {
    for (const r of guarded) expect((await call(r)).status, `${r.method} ${r.path}`).toBe(401);
  });

  it('every write refuses a staff session without the CSRF header', async () => {
    const all = await staffWith([]);
    for (const r of guarded.filter((x) => x.method !== 'GET')) {
      const res = await call(r, all, false);
      expect(res, `${r.method} ${r.path}`).toEqual({ status: 403, error: 'csrf_failed' });
    }
  });

  it('a staff member without permissions reaches no permission route', async () => {
    const none = await staffWith([]);
    for (const r of guarded) {
      const key = `${r.method} ${r.path}`;
      const res = await call(r, none);
      if (r.access.kind === 'permission')
        expect(res, key).toEqual({ status: 403, error: 'permission_missing' });
      else if (MANUAL_CHECK.has(key)) expect(res.status, key).toBe(403);
    }
  });

  it('exactly the declared permissions open a route, and each one of them is needed', async () => {
    const sets = new Map<string, string[]>();
    for (const r of guarded)
      if (r.access.kind === 'permission')
        sets.set([...r.access.permissions].sort().join('+'), [...r.access.permissions]);
    for (const [key, perms] of sets) {
      const exact = await staffWith(perms);
      const lacking = await Promise.all(perms.map((p) => staffWith(perms.filter((x) => x !== p))));
      for (const r of guarded.filter(
        (x) => x.access.kind === 'permission' && [...x.access.permissions].sort().join('+') === key,
      )) {
        const name = `${r.method} ${r.path}`;
        expect((await call(r, exact)).error, `${name} with ${key}`).not.toBe('permission_missing');
        for (const [i, who] of lacking.entries())
          expect(await call(r, who), `${name} without ${perms[i]}`).toEqual({
            status: 403,
            error: 'permission_missing',
          });
      }
    }
  });
});
