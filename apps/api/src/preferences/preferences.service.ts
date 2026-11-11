import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';
import type { VehicleModeKind } from '../db/types.generated';
import { mutedByQuietHours } from './quiet-hours';

export const MAX_RULES = 7;
export const MAX_MODE_MINUTES = 12 * 60;

export type MuteReason = 'quiet_hours' | 'sensitive_spot';

const toMask = (days: number[]) => days.reduce((m, d) => m | (1 << d), 0);
const fromMask = (mask: number) => [0, 1, 2, 3, 4, 5, 6].filter((d) => (mask & (1 << d)) !== 0);
const hhmm = (t: string) => t.slice(0, 5);

/**
 * Quiet hours and temporary modes (OW-06, OW-17, US-26), and the protection score (OW-14, US-28).
 * Muting never drops an alert: it is recorded as a suppressed delivery with its reason, so it shows in
 * the history, and escalation to an emergency contact still applies.
 */
@Injectable()
export class PreferencesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // --- quiet hours ------------------------------------------------------------------------------

  async listRules(userId: string) {
    const [rules, user] = await Promise.all([
      this.db
        .selectFrom('notification_rules')
        .select(['id', 'vehicle_id', 'quiet_start', 'quiet_end', 'days_mask', 'urgent_override'])
        .where('user_id', '=', userId)
        .orderBy('created_at')
        .execute(),
      this.db
        .selectFrom('users')
        .select('timezone')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      timezone: user.timezone,
      rules: rules.map((r) => ({
        id: r.id,
        vehicleId: r.vehicle_id,
        days: fromMask(r.days_mask),
        start: hhmm(r.quiet_start),
        end: hhmm(r.quiet_end),
        urgentBypass: r.urgent_override,
      })),
    };
  }

  async addRule(
    userId: string,
    input: {
      days: number[];
      start: string;
      end: string;
      urgentBypass: boolean;
      vehicleId?: string | null;
    },
  ) {
    if (!input.days.length) throw new BadRequestException({ error: 'days_required' });
    if (input.vehicleId) await this.ownVehicle(userId, input.vehicleId);
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'qh:' + userId}))`.execute(trx);
      const { n } = await trx
        .selectFrom('notification_rules')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('user_id', '=', userId)
        .executeTakeFirstOrThrow();
      if (Number(n) >= MAX_RULES)
        throw new ConflictException({ error: 'rule_limit', limit: MAX_RULES });
      await trx
        .insertInto('notification_rules')
        .values({
          user_id: userId,
          vehicle_id: input.vehicleId ?? null,
          quiet_start: input.start,
          quiet_end: input.end,
          days_mask: toMask(input.days),
          urgent_override: input.urgentBypass,
        })
        .execute();
    });
    return this.listRules(userId);
  }

  async removeRule(userId: string, id: string): Promise<void> {
    const r = await this.db
      .deleteFrom('notification_rules')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!Number(r.numDeletedRows)) throw new NotFoundException();
  }

  // --- temporary modes --------------------------------------------------------------------------

  private async ownVehicle(userId: string, vehicleId: string) {
    const v = await this.db
      .selectFrom('vehicles')
      .select('id')
      .where('id', '=', vehicleId)
      .where('owner_user_id', '=', userId)
      .executeTakeFirst();
    if (!v) throw new NotFoundException({ error: 'vehicle_not_found' });
  }

  private activeMode(vehicleId: string) {
    return this.db
      .selectFrom('vehicle_modes')
      .select(['mode', 'starts_at as startsAt', 'ends_at as endsAt'])
      .where('vehicle_id', '=', vehicleId)
      .where('starts_at', '<=', sql<Date>`now()`)
      .where('ends_at', '>', sql<Date>`now()`)
      .orderBy('ends_at', 'desc')
      .executeTakeFirst();
  }

  async getMode(userId: string, vehicleId: string) {
    await this.ownVehicle(userId, vehicleId);
    return { mode: (await this.activeMode(vehicleId)) ?? null };
  }

  /** OW-17: one mode at a time per vehicle, at most 12 h. Starting a new one replaces the old. */
  async startMode(userId: string, vehicleId: string, mode: VehicleModeKind, minutes: number) {
    await this.ownVehicle(userId, vehicleId);
    if (minutes < 15 || minutes > MAX_MODE_MINUTES)
      throw new BadRequestException({ error: 'duration_invalid' });
    await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('vehicle_modes')
        .where('vehicle_id', '=', vehicleId)
        .where('ends_at', '>', sql<Date>`now()`)
        .execute();
      await trx
        .insertInto('vehicle_modes')
        .values({
          vehicle_id: vehicleId,
          mode,
          ends_at: sql`now() + make_interval(mins => ${minutes})`,
        })
        .execute();
    });
    return this.getMode(userId, vehicleId);
  }

  async endMode(userId: string, vehicleId: string): Promise<void> {
    await this.ownVehicle(userId, vehicleId);
    await this.db
      .deleteFrom('vehicle_modes')
      .where('vehicle_id', '=', vehicleId)
      .where('ends_at', '>', sql<Date>`now()`)
      .execute();
  }

  /** Should this alert reach the owner right now? null = yes. Tests and reminders are never muted. */
  async muteReason(input: {
    userId: string;
    vehicleId: string;
    severity: string;
    isTest: boolean;
    now?: Date;
  }): Promise<MuteReason | null> {
    if (input.isTest) return null;
    const mode = await this.activeMode(input.vehicleId);
    // "Sensitive spot": urgent alerts only (OW-17).
    if (mode?.mode === 'sensitive_spot' && input.severity !== 'urgent') return 'sensitive_spot';
    const [rules, user] = await Promise.all([
      this.db
        .selectFrom('notification_rules')
        .select(['quiet_start', 'quiet_end', 'days_mask', 'urgent_override'])
        .where('user_id', '=', input.userId)
        .where((eb) =>
          eb.or([eb('vehicle_id', 'is', null), eb('vehicle_id', '=', input.vehicleId)]),
        )
        .execute(),
      this.db
        .selectFrom('users')
        .select('timezone')
        .where('id', '=', input.userId)
        .executeTakeFirstOrThrow(),
    ]);
    const muted = mutedByQuietHours(
      rules.map((r) => ({
        quietStart: r.quiet_start,
        quietEnd: r.quiet_end,
        daysMask: r.days_mask,
        urgentOverride: r.urgent_override,
      })),
      input.severity,
      input.now ?? new Date(),
      user.timezone,
    );
    return muted ? 'quiet_hours' : null;
  }

  // --- protection score (OW-14) ------------------------------------------------------------------

  /** Computed from data, never stored (US-28). Four steps of 25 %. */
  async protection(userId: string) {
    const row = await sql<{ email: boolean; channel: boolean; contact: boolean; decal: boolean }>`
      SELECT
        (u.email_verified_at IS NOT NULL) AS email,
        (EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
          OR EXISTS (SELECT 1 FROM contact_channels c WHERE c.user_id = u.id AND c.type = 'whatsapp'
                      AND c.verified_at IS NOT NULL AND c.is_enabled)) AS channel,
        EXISTS (SELECT 1 FROM emergency_contacts e WHERE e.user_id = u.id AND e.consent = 'confirmed') AS contact,
        EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                 WHERE v.owner_user_id = u.id AND t.status <> 'revoked' AND t.last_test_at IS NOT NULL) AS decal
      FROM users u WHERE u.id = ${userId}`.execute(this.db);
    const steps = row.rows[0] ?? { email: false, channel: false, contact: false, decal: false };
    const done = Object.values(steps).filter(Boolean).length;
    // On iOS, a push subscription exists only for the home-screen app, so any subscription counts.
    return { percent: done * 25, steps };
  }
}
