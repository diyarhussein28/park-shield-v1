import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB, ENV, VALKEY } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { StaffService, type StaffContext } from './staff.service';

const DAY = 86_400_000;
const REMINDER_KEY = 'ops:access-review:reminded';

export interface ReviewRow {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  permissions: string[];
  hasPasskey: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  inactiveDays: number;
}

/**
 * US-45 permission review: a quarterly report of all staff with their roles, last sign-in and passkey,
 * a review that keeps or removes each person (stored and audit-logged), and automatic removal of
 * roles from staff who have not signed in for `staff.inactive_days`. Nobody is ever removed if that
 * would leave no one who can manage staff.
 */
@Injectable()
export class AccessReviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private async rows(): Promise<ReviewRow[]> {
    const r = await sql<{
      id: string;
      email: string;
      name: string | null;
      roles: string[];
      permissions: string[];
      has_passkey: boolean;
      created_at: Date;
      last_login_at: Date | null;
    }>`
      SELECT u.id, u.email, u.display_name AS name, u.created_at, u.last_login_at,
             array_agg(DISTINCT a.role_code ORDER BY a.role_code) AS roles,
             coalesce(array_agg(DISTINCT p.permission_code ORDER BY p.permission_code)
                        FILTER (WHERE p.permission_code IS NOT NULL), '{}') AS permissions,
             EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id) AS has_passkey
        FROM users u
        JOIN staff_role_assignments a ON a.user_id = u.id
        LEFT JOIN staff_role_permissions p ON p.role_code = a.role_code
       WHERE u.kind = 'staff' AND u.status = 'active'
       GROUP BY u.id
       ORDER BY u.email`.execute(this.db);
    return r.rows.map((x) => ({
      id: x.id,
      email: x.email,
      name: x.name,
      roles: x.roles,
      permissions: x.permissions,
      hasPasskey: x.has_passkey,
      createdAt: x.created_at,
      lastLoginAt: x.last_login_at,
      inactiveDays: Math.floor((Date.now() - (x.last_login_at ?? x.created_at).getTime()) / DAY),
    }));
  }

  private async lastReview() {
    return this.db
      .selectFrom('staff_access_reviews as r')
      .leftJoin('users as u', 'u.id', 'r.reviewed_by')
      .select(['r.reviewed_at as at', 'u.display_name as by', 'r.kept', 'r.removed', 'r.note'])
      .orderBy('r.reviewed_at', 'desc')
      .executeTakeFirst();
  }

  async report(by: StaffContext) {
    const [staff, last, inactiveDays, intervalDays] = await Promise.all([
      this.rows(),
      this.lastReview(),
      this.settings.get('staff.inactive_days', 90),
      this.settings.get('staff.review_interval_days', 90),
    ]);
    const dueAt = last ? new Date(last.at.getTime() + intervalDays * DAY) : new Date();
    await this.staff.auditRead(by.userId, 'staff.review_report', 'users', null, {
      staff: staff.length,
    });
    return { staff, last: last ?? null, dueAt, due: dueAt <= new Date(), inactiveDays };
  }

  async csv(by: StaffContext): Promise<string> {
    const { staff } = await this.report(by);
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      'email,name,roles,permissions,passkey,last_sign_in,inactive_days',
      ...staff.map((s) =>
        [
          q(s.email),
          q(s.name ?? ''),
          q(s.roles.join(' ')),
          q(s.permissions.join(' ')),
          s.hasPasskey ? 'yes' : 'no',
          s.lastLoginAt?.toISOString() ?? '',
          String(s.inactiveDays),
        ].join(','),
      ),
    ];
    return `${lines.join('\n')}\n`;
  }

  /** Removes all roles and ends all sessions; refuses if nobody could manage staff afterwards. */
  private async strip(userIds: string[], actor: string | null) {
    if (!userIds.length) return;
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('staff_role_assignments').where('user_id', 'in', userIds).execute();
      const managers = await sql<{ n: number }>`
        SELECT count(DISTINCT a.user_id)::int AS n FROM staff_role_assignments a
          JOIN staff_role_permissions p ON p.role_code = a.role_code
          JOIN users u ON u.id = a.user_id
         WHERE p.permission_code = 'staff.manage' AND u.status = 'active'`.execute(trx);
      if (!managers.rows[0]?.n) throw new ConflictException({ error: 'last_manager' });
    });
    await this.db
      .updateTable('sessions')
      .set({ revoked_at: sql`now()` })
      .where('user_id', 'in', userIds)
      .where('is_staff', '=', true)
      .where('revoked_at', 'is', null)
      .$if(actor !== null, (q) => q.where('user_id', '<>', actor!))
      .execute();
  }

  /** The quarterly review: every person with a role is either kept or removed. */
  async review(by: StaffContext, input: { keep: string[]; remove: string[]; note: string }) {
    const current = await this.rows();
    const ids = new Set(current.map((s) => s.id));
    const decided = new Set([...input.keep, ...input.remove]);
    if (input.keep.some((id) => input.remove.includes(id)))
      throw new BadRequestException({ error: 'conflicting_decision' });
    if (decided.size !== ids.size || [...ids].some((id) => !decided.has(id)))
      throw new BadRequestException({ error: 'incomplete', expected: ids.size });
    await this.strip(input.remove, by.userId);
    const row = await this.db
      .insertInto('staff_access_reviews')
      .values({
        reviewed_by: by.userId,
        kept: input.keep.length,
        removed: input.remove.length,
        note: input.note,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const removed = current.filter((s) => input.remove.includes(s.id));
    await this.staff.audit(by.userId, 'staff.access_review', 'staff_access_reviews', row.id, {
      kept: input.keep.length,
      removed: removed.map((s) => ({ id: s.id, roles: s.roles })),
      note: input.note,
    });
    for (const s of removed)
      await this.staff.audit(by.userId, 'staff.roles', 'users', s.id, {
        roles: [],
        review: row.id,
      });
    return { id: row.id, kept: input.keep.length, removed: removed.length };
  }

  /** Worker job: roles end after `staff.inactive_days` without a sign-in (never the last manager). */
  async expireInactive(): Promise<number> {
    const days = await this.settings.get('staff.inactive_days', 90);
    const stale = (await this.rows()).filter((s) => s.inactiveDays >= days);
    const expired: typeof stale = [];
    for (const s of stale) {
      try {
        await this.strip([s.id], null);
        expired.push(s);
        await this.staff.audit(null, 'staff.expired', 'users', s.id, {
          roles: s.roles,
          inactiveDays: s.inactiveDays,
        });
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err; // the last manager stays
      }
    }
    if (expired.length) {
      await this.mail.send({
        to: await this.settings.get('ops.alert_email', 'datenschutz@parkshield.de'),
        template: 'staff_expired',
        locale: 'de',
        values: { count: expired.length, list: expired.map((s) => s.email).join(', '), days },
        actionUrl: `${this.env.OPS_BASE_URL}/mitarbeitende/pruefung`,
      });
    }
    return expired.length;
  }

  /** Worker job: one reminder a week while the quarterly review is overdue. */
  async remindDue(): Promise<boolean> {
    const interval = await this.settings.get('staff.review_interval_days', 90);
    const last = await this.lastReview();
    if (last && last.at.getTime() + interval * DAY > Date.now()) return false;
    if (!(await this.rows()).length) return false;
    const fresh = await this.valkey.set(REMINDER_KEY, '1', 'EX', 7 * 86_400, 'NX');
    if (!fresh) return false;
    await this.mail.send({
      to: await this.settings.get('ops.alert_email', 'datenschutz@parkshield.de'),
      template: 'staff_review_due',
      locale: 'de',
      values: { days: interval },
      actionUrl: `${this.env.OPS_BASE_URL}/mitarbeitende/pruefung`,
    });
    return true;
  }
}
