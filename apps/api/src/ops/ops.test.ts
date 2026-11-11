import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpsApp, OpsAppModule } from '../apps';
import { loadEnv, repoRoot } from '../config/env';
import { createLogger } from '../core/logger';
import { createHarness, resetState, signIn, type Harness } from '../test/harness';
import { OPS_ACCESS, type OpsAccess } from './access';
import { StaffService } from './staff.service';

let h: Harness; // public app (for the 404 check and shared DB/Valkey)
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

/** A signed-in staff member with the given roles (the passkey ceremony is covered in E2E). */
async function staffSession(email: string, roles: string[]) {
  const { userId } = await staff.invite(null, { email, name: email.split('@')[0]!, roles });
  const s = await staff.createSession(userId, 'Chrome · Windows');
  const cookie = `ps_ops_session=${s.token}; ps_ops_csrf=${s.csrf}`;
  return { userId, headers: { cookie, 'x-csrf-token': s.csrf }, cookie };
}

describe('ops access policy (US-34)', () => {
  it('every api-ops route declares an access policy; public ones are allow-listed', () => {
    const env = loadEnv();
    const controllers = (OpsAppModule.forRoot(env, createLogger(env)).controllers ?? []) as (new (
      ...a: never[]
    ) => object)[];
    const PUBLIC_ALLOWED = new Set([
      'GET /ops/v1/health',
      'POST /ops/v1/auth/login/options',
      'POST /ops/v1/auth/login/verify',
      'POST /ops/v1/auth/invite/view',
      'POST /ops/v1/auth/invite/options',
      'POST /ops/v1/auth/invite/verify',
    ]);
    const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
    const routes: string[] = [];
    for (const ctrl of controllers) {
      const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
      const classAccess = Reflect.getMetadata(OPS_ACCESS, ctrl) as OpsAccess | undefined;
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = (ctrl.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue;
        const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const route = `${method} /${[base, path].filter((p) => p && p !== '/').join('/')}`;
        routes.push(route);
        const access = (Reflect.getMetadata(OPS_ACCESS, handler) ?? classAccess) as
          OpsAccess | undefined;
        expect(access, `${route} has no access policy`).toBeDefined();
        if (access!.kind === 'public')
          expect(PUBLIC_ALLOWED.has(route), `${route} must not be public`).toBe(true);
        if (access!.kind === 'permission') expect(access!.permissions.length).toBeGreaterThan(0);
      }
    }
    expect(routes.length).toBeGreaterThan(8);
  });

  it('ops routes do not exist on the public API, and Caddy rejects /ops/* on the public site', async () => {
    for (const url of ['/ops/v1/health', '/ops/v1/me', '/ops/v1/staff']) {
      expect((await h.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
    const caddy = readFileSync(
      join(repoRoot(), 'infra/ansible/roles/caddy/templates/Caddyfile.j2'),
      'utf8',
    );
    expect(caddy).toMatch(/@ops path \/ops\/\*\s+respond @ops 404/);
    expect(caddy).not.toMatch(/reverse_proxy[^\n]*:4001/); // api-ops is never proxied from the public site
  });
});

describe('staff sessions and permissions (AD-01, AD-02)', () => {
  it('needs a staff session; customer sessions do not work in ops', async () => {
    expect((await ops.inject({ method: 'GET', url: '/ops/v1/me' })).statusCode).toBe(401);
    const customer = await signIn(h, 'kunde@example.de');
    const cookie = customer.cookie.replace('ps_session', 'ps_ops_session');
    expect(
      (await ops.inject({ method: 'GET', url: '/ops/v1/me', headers: { cookie } })).statusCode,
    ).toBe(401);
  });

  it('shows the staff member’s roles and permissions; checks permissions, not roles', async () => {
    const support = await staffSession('support@parkshield.de', ['support']);
    const me = (
      await ops.inject({ method: 'GET', url: '/ops/v1/me', headers: support.headers })
    ).json();
    expect(me).toMatchObject({ email: 'support@parkshield.de', roles: ['support'] });
    expect(me.permissions).toEqual([
      'alerts.read_metadata',
      'customer.read_masked',
      'pii.decrypt_request',
    ]);
    const denied = await ops.inject({
      method: 'GET',
      url: '/ops/v1/staff',
      headers: support.headers,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'permission_missing', missing: ['staff.manage'] });
  });

  it('a superadmin invites staff and changes roles; every change is audit-logged', async () => {
    const admin = await staffSession('admin@parkshield.de', ['superadmin']);
    const noCsrf = await ops.inject({
      method: 'POST',
      url: '/ops/v1/staff',
      headers: { cookie: admin.cookie },
      payload: { email: 'neu@parkshield.de', name: 'Neu', roles: ['support'] },
    });
    expect(noCsrf.statusCode).toBe(403);
    const invite = await ops.inject({
      method: 'POST',
      url: '/ops/v1/staff',
      headers: admin.headers,
      payload: { email: 'neu@parkshield.de', name: 'Neu', roles: ['support'] },
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().link).toMatch(/\/einladung#t=[A-Za-z0-9_-]{43}$/);
    const token = invite.json().link.split('#t=')[1];
    expect(
      (
        await ops.inject({ method: 'POST', url: '/ops/v1/auth/invite/view', payload: { token } })
      ).json(),
    ).toEqual({
      email: 'neu@parkshield.de',
      name: 'Neu',
    });
    const options = (
      await ops.inject({ method: 'POST', url: '/ops/v1/auth/invite/options', payload: { token } })
    ).json();
    expect(options.authenticatorSelection).toMatchObject({
      userVerification: 'required',
      residentKey: 'required',
    });
    expect(options.rp).toMatchObject({ id: 'localhost', name: 'ParkShield Ops' });

    const customer = await signIn(h, 'kunde@example.de');
    void customer;
    const clash = await ops.inject({
      method: 'POST',
      url: '/ops/v1/staff',
      headers: admin.headers,
      payload: { email: 'kunde@example.de', name: 'X', roles: ['support'] },
    });
    expect(clash.json().error).toBe('email_is_customer');

    const list = (
      await ops.inject({ method: 'GET', url: '/ops/v1/staff', headers: admin.headers })
    ).json();
    const neu = list.staff.find((x: { email: string }) => x.email === 'neu@parkshield.de');
    expect(neu).toMatchObject({ roles: ['support'], hasPasskey: false });
    const put = await ops.inject({
      method: 'PUT',
      url: `/ops/v1/staff/${neu.id}/roles`,
      headers: admin.headers,
      payload: { roles: ['finance'] },
    });
    expect(put.statusCode).toBe(200);
    const actions = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('entity_id', '=', neu.id)
      .execute();
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['staff.invite', 'staff.roles']),
    );
  });

  it('never removes the last person who can manage staff', async () => {
    const admin = await staffSession('admin@parkshield.de', ['superadmin']);
    const r = await ops.inject({
      method: 'PUT',
      url: `/ops/v1/staff/${admin.userId}/roles`,
      headers: admin.headers,
      payload: { roles: ['support'] },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('last_manager');
  });

  it('ends after 30 minutes without a request, slides on activity, and after 12 hours at most', async () => {
    const s = await staffSession('support@parkshield.de', ['support']);
    await sql`UPDATE sessions SET expires_at = now() + interval '1 minute' WHERE is_staff`.execute(
      h.db,
    );
    expect(
      (await ops.inject({ method: 'GET', url: '/ops/v1/me', headers: s.headers })).statusCode,
    ).toBe(200);
    const slid = await h.db
      .selectFrom('sessions')
      .select('expires_at')
      .where('is_staff', '=', true)
      .executeTakeFirstOrThrow();
    expect(slid.expires_at.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);

    await sql`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE is_staff`.execute(
      h.db,
    );
    expect(
      (await ops.inject({ method: 'GET', url: '/ops/v1/me', headers: s.headers })).statusCode,
    ).toBe(401);

    const t = await staffSession('other@parkshield.de', ['support']);
    await sql`UPDATE sessions SET created_at = now() - interval '13 hours' WHERE is_staff AND revoked_at IS NULL`.execute(
      h.db,
    );
    expect(
      (await ops.inject({ method: 'GET', url: '/ops/v1/me', headers: t.headers })).statusCode,
    ).toBe(401);
  });

  it('logout ends the session', async () => {
    const s = await staffSession('support@parkshield.de', ['support']);
    expect(
      (await ops.inject({ method: 'POST', url: '/ops/v1/auth/logout', headers: s.headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (await ops.inject({ method: 'GET', url: '/ops/v1/me', headers: s.headers })).statusCode,
    ).toBe(401);
  });
});
