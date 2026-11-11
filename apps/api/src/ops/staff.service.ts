import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { randomToken, sha256 } from '../core/crypto';
import { DB, ENV, VALKEY } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { STAFF_IDLE_MINUTES, STAFF_MAX_HOURS } from './access';

export interface StaffContext {
  sessionId: string;
  userId: string;
  email: string;
  name: string | null;
  permissions: Set<string>;
  roles: string[];
  expiresAt: Date;
}

const INVITE_TTL = 72 * 3600;
const inviteKey = (token: string) => `ops:invite:${sha256(token).toString('hex')}`;

/** Staff accounts, sessions, roles and invitations for the ops app (AD-01, AD-02, US-34). */
@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  // --- sessions -------------------------------------------------------------------------------

  async createSession(userId: string, device: string) {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + STAFF_IDLE_MINUTES * 60_000);
    await this.db
      .insertInto('sessions')
      .values({
        user_id: userId,
        token_hash: sha256(token),
        user_agent: device,
        is_staff: true,
        expires_at: expiresAt,
      })
      .execute();
    // Last sign-in for the permission review and the expiry of inactive staff (US-45).
    await this.db
      .updateTable('users')
      .set({ last_login_at: sql`now()` })
      .where('id', '=', userId)
      .execute();
    await this.audit(userId, 'staff.login', 'users', userId);
    return { token, csrf: randomToken(18), expiresAt };
  }

  /** Resolves and slides the idle timeout; never past the absolute maximum. */
  async resolve(token: string | undefined): Promise<StaffContext | null> {
    if (!token) return null;
    const row = await this.db
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select(['s.id', 's.created_at', 'u.id as userId', 'u.email', 'u.display_name'])
      .where('s.token_hash', '=', sha256(token))
      .where('s.is_staff', '=', true)
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', sql<Date>`now()`)
      .where('s.created_at', '>', sql<Date>`now() - make_interval(hours => ${STAFF_MAX_HOURS})`)
      .where('u.kind', '=', 'staff')
      .where('u.status', '=', 'active')
      .executeTakeFirst();
    if (!row) return null;
    const max = row.created_at.getTime() + STAFF_MAX_HOURS * 3600_000;
    const expiresAt = new Date(Math.min(Date.now() + STAFF_IDLE_MINUTES * 60_000, max));
    await this.db
      .updateTable('sessions')
      .set({ expires_at: expiresAt })
      .where('id', '=', row.id)
      .execute();
    const { roles, permissions } = await this.access(row.userId);
    return {
      sessionId: row.id,
      userId: row.userId,
      email: row.email,
      name: row.display_name,
      roles,
      permissions,
      expiresAt,
    };
  }

  async revoke(sessionId: string) {
    await this.db
      .updateTable('sessions')
      .set({ revoked_at: sql`now()` })
      .where('id', '=', sessionId)
      .execute();
  }

  async access(userId: string) {
    const rows = await this.db
      .selectFrom('staff_role_assignments as a')
      .leftJoin('staff_role_permissions as p', 'p.role_code', 'a.role_code')
      .select(['a.role_code', 'p.permission_code'])
      .where('a.user_id', '=', userId)
      .execute();
    return {
      roles: [...new Set(rows.map((r) => r.role_code))].sort(),
      permissions: new Set(
        rows.map((r) => r.permission_code).filter((p): p is string => Boolean(p)),
      ),
    };
  }

  // --- invitations ----------------------------------------------------------------------------

  /** Creates (or re-invites) a staff account; the link lets the person register their passkey. */
  async invite(by: string | null, input: { email: string; name: string; roles: string[] }) {
    const email = input.email.trim().toLowerCase();
    await this.assertRoles(input.roles);
    const userId = await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('users')
        .select(['id', 'kind'])
        .where('email', '=', email)
        .executeTakeFirst();
      // Staff and customer accounts never share an identity (separate app, separate sessions).
      if (existing && existing.kind !== 'staff')
        throw new ConflictException({ error: 'email_is_customer' });
      const id =
        existing?.id ??
        (
          await trx
            .insertInto('users')
            .values({
              email,
              kind: 'staff',
              display_name: input.name.trim(),
              email_verified_at: sql`now()`,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      await this.setRolesTx(trx, id, input.roles, by);
      return id;
    });
    const token = randomToken();
    await this.valkey.set(inviteKey(token), userId, 'EX', INVITE_TTL);
    const link = `${this.env.OPS_BASE_URL}/einladung#t=${token}`;
    await this.mail.send({
      to: email,
      template: 'staff_invite',
      locale: 'de',
      values: { name: input.name.trim() },
      actionUrl: link,
    });
    await this.audit(by, 'staff.invite', 'users', userId, { roles: input.roles });
    return { userId, link };
  }

  async inviteTarget(token: string) {
    const userId = await this.valkey.get(inviteKey(token));
    if (!userId) throw new NotFoundException({ error: 'invitation_invalid' });
    const u = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'display_name'])
      .where('id', '=', userId)
      .where('kind', '=', 'staff')
      .executeTakeFirst();
    if (!u) throw new NotFoundException({ error: 'invitation_invalid' });
    return { userId: u.id, email: u.email, name: u.display_name };
  }

  async consumeInvite(token: string) {
    await this.valkey.del(inviteKey(token));
  }

  // --- roles ----------------------------------------------------------------------------------

  async roles() {
    const rows = await this.db
      .selectFrom('staff_roles as r')
      .leftJoin('staff_role_permissions as p', 'p.role_code', 'r.code')
      .select(['r.code', 'r.name', 'p.permission_code'])
      .orderBy('r.code')
      .execute();
    const map = new Map<string, { code: string; name: string; permissions: string[] }>();
    for (const r of rows) {
      const e = map.get(r.code) ?? { code: r.code, name: r.name, permissions: [] };
      if (r.permission_code) e.permissions.push(r.permission_code);
      map.set(r.code, e);
    }
    return [...map.values()];
  }

  async list() {
    const rows = await this.db
      .selectFrom('users as u')
      .leftJoin('staff_role_assignments as a', 'a.user_id', 'u.id')
      .select(['u.id', 'u.email', 'u.display_name', 'u.status', 'a.role_code'])
      .where('u.kind', '=', 'staff')
      .orderBy('u.email')
      .execute();
    const passkeys = await this.db
      .selectFrom('webauthn_credentials as c')
      .innerJoin('users as u', 'u.id', 'c.user_id')
      .select(['c.user_id'])
      .where('u.kind', '=', 'staff')
      .execute();
    const withKey = new Set(passkeys.map((p) => p.user_id));
    const map = new Map<
      string,
      {
        id: string;
        email: string;
        name: string | null;
        status: string;
        roles: string[];
        hasPasskey: boolean;
      }
    >();
    for (const r of rows) {
      const e = map.get(r.id) ?? {
        id: r.id,
        email: r.email,
        name: r.display_name,
        status: r.status,
        roles: [],
        hasPasskey: withKey.has(r.id),
      };
      if (r.role_code) e.roles.push(r.role_code);
      map.set(r.id, e);
    }
    return [...map.values()];
  }

  private async assertRoles(roles: string[]) {
    if (!roles.length) throw new BadRequestException({ error: 'roles_required' });
    const known = await this.db
      .selectFrom('staff_roles')
      .select('code')
      .where('code', 'in', roles)
      .execute();
    if (known.length !== new Set(roles).size)
      throw new BadRequestException({ error: 'role_unknown' });
  }

  private async setRolesTx(trx: Db, userId: string, roles: string[], by: string | null) {
    await trx.deleteFrom('staff_role_assignments').where('user_id', '=', userId).execute();
    await trx
      .insertInto('staff_role_assignments')
      .values(
        [...new Set(roles)].map((role_code) => ({ user_id: userId, role_code, granted_by: by })),
      )
      .execute();
  }

  async setRoles(by: StaffContext, userId: string, roles: string[]) {
    await this.assertRoles(roles);
    const target = await this.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .where('kind', '=', 'staff')
      .executeTakeFirst();
    if (!target) throw new NotFoundException();
    await this.db.transaction().execute(async (trx) => {
      await this.setRolesTx(trx, userId, roles, by.userId);
      // Never lock everyone out: at least one active staff member must keep staff.manage.
      const managers = await sql<{ n: number }>`
        SELECT count(DISTINCT a.user_id)::int AS n FROM staff_role_assignments a
          JOIN staff_role_permissions p ON p.role_code = a.role_code
          JOIN users u ON u.id = a.user_id
         WHERE p.permission_code = 'staff.manage' AND u.status = 'active'`.execute(trx);
      if (!managers.rows[0]?.n) throw new ConflictException({ error: 'last_manager' });
    });
    // A changed role applies to the next request; ending sessions makes a removal immediate.
    await this.db
      .updateTable('sessions')
      .set({ revoked_at: sql`now()` })
      .where('user_id', '=', userId)
      .where('is_staff', '=', true)
      .where('revoked_at', 'is', null)
      .where('user_id', '<>', by.userId)
      .execute();
    await this.audit(by.userId, 'staff.roles', 'users', userId, { roles });
  }

  async audit(
    actor: string | null,
    action: string,
    entity: string,
    entityId: string | null,
    meta: Record<string, unknown> = {},
  ) {
    await this.db
      .insertInto('audit_logs')
      .values({
        actor_id: actor,
        actor_kind: actor ? 'staff' : null,
        action,
        entity,
        entity_id: entityId,
        meta: JSON.stringify(meta),
      })
      .execute();
  }

  /** AD-17: reads are audited too (opening a customer, a trace, a decrypted field). */
  async auditRead(
    actor: string,
    action: string,
    entity: string,
    entityId: string | null,
    meta: Record<string, unknown> = {},
  ) {
    await this.db
      .insertInto('audit_logs')
      .values({
        actor_id: actor,
        actor_kind: 'staff',
        action,
        is_read: true,
        entity,
        entity_id: entityId,
        meta: JSON.stringify(meta),
      })
      .execute();
  }
}
