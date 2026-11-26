import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  checkStatusText,
  normalizeStatusText,
  STATUS_EXTEND_MINUTES,
  STATUS_MAX_MINUTES,
  type StatusDuration,
  type StatusPreset,
} from '@parkshield/shared';
import { sql, type Selectable, type Transaction } from 'kysely';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { DB, ENV, LOGGER } from '../core/tokens';
import type { DB as Schema } from '../db/types.generated';
import { contractState, scannerDecision } from '../legal/rules';
import { APP_BRB_CATEGORY, appPushText } from '../notifications/push-texts';
import { APP_PUSH, type AppPushSender } from '../providers/ports';

export const STATUS_PREWARN_TOPIC = 'vehicle_status.prewarn';
export const STATUS_EXPIRE_TOPIC = 'vehicle_status.expire';
/** The pre-expiry push goes out this long before expires_at. */
const PREWARN_SECONDS = 60;

export interface StatusInput {
  presetKey?: StatusPreset;
  customText?: string;
  durationMin: StatusDuration;
}

/** What the owner's app gets (GET/PUT/extend). */
export interface OwnerStatus {
  presetKey: StatusPreset | null;
  customText: string | null;
  durationMin: number;
  startedAt: Date;
  expiresAt: Date;
  /** „+5 Min“ would still move expires_at (it is below now + 60 min). */
  canExtend: boolean;
  /** „1 Person wartet“: scanners who tapped „Ich warte“ during this status. */
  waitingCount: number;
}

type Row = Selectable<Schema['vehicle_status']>;

/**
 * „Bin gleich zurück“ / "Be right back" (owner spec 2026-11-26, docs/vehicle-status.md).
 *
 * Background work follows the codebase's pattern (no BullMQ): every create/replace and „+5 Min“ raises
 * `version` and queues two delayed outbox events in the same transaction — the pre-expiry push at
 * expires_at − 60 s and the expiry at expires_at. A handler whose version is no longer the row's is a
 * no-op. The worker also sweeps expired rows every few seconds, and every read checks
 * `expires_at > now()` itself, so a late job never shows an expired status.
 */
@Injectable()
export class VehicleStatusService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(APP_PUSH) private readonly appPush: AppPushSender,
  ) {}

  get enabled(): boolean {
    return this.env.VEHICLE_STATUS_ENABLED;
  }

  private assertEnabled() {
    if (!this.enabled) throw new NotFoundException({ error: 'feature_disabled' });
  }

  private async ownVehicle(userId: string, vehicleId: string) {
    const v = await this.db
      .selectFrom('vehicles')
      .select('id')
      .where('id', '=', vehicleId)
      .where('owner_user_id', '=', userId)
      .executeTakeFirst();
    if (!v) throw new NotFoundException({ error: 'not_found' });
  }

  /**
   * Only for a vehicle whose decal works right now: a current code („Sperren“ revokes it) and a
   * subscription the scan page accepts (the same rule as the scan page, legal/rules.scannerDecision).
   */
  private async assertEligible(userId: string, vehicleId: string) {
    const [token, sub] = await Promise.all([
      this.db
        .selectFrom('qr_tokens')
        .select('id')
        .where('vehicle_id', '=', vehicleId)
        .where('status', '=', 'assigned')
        .executeTakeFirst(),
      this.db
        .selectFrom('subscriptions')
        .select(['status', 'cancel_at_period_end', 'past_due_since'])
        .where('user_id', '=', userId)
        .where('status', 'in', ['active', 'past_due'])
        .orderBy('created_at', 'desc')
        .executeTakeFirst(),
    ]);
    if (!token) throw new ConflictException({ error: 'vehicle_inactive' });
    const page = scannerDecision({
      tag: 'assigned',
      contract: sub
        ? contractState({ status: sub.status, cancel_at_period_end: sub.cancel_at_period_end })
        : null,
      pastDueSince: sub?.past_due_since ?? null,
      now: new Date(),
      pastDueGraceDays: await this.settings.get('scanner.past_due_grace_days', 21),
    });
    if (page !== 'alert') throw new ConflictException({ error: 'subscription_inactive' });
  }

  private toOwner(r: Row): OwnerStatus {
    const cap = Date.now() + STATUS_MAX_MINUTES * 60_000;
    return {
      presetKey: (r.preset_key as StatusPreset | null) ?? null,
      customText: r.custom_text,
      durationMin: r.duration_min,
      startedAt: r.started_at,
      expiresAt: r.expires_at,
      // A second of slack: right after setting 60 min the cap is reached.
      canExtend: r.expires_at.getTime() < cap - 1000,
      waitingCount: r.waiting_signal_count,
    };
  }

  /** The active status of a vehicle, never an expired one (also when the expiry job is late). */
  async active(vehicleId: string, executor: Pick<Db, 'selectFrom'> = this.db) {
    if (!this.enabled) return null;
    return (
      (await executor
        .selectFrom('vehicle_status')
        .selectAll()
        .where('vehicle_id', '=', vehicleId)
        .where('expires_at', '>', sql<Date>`now()`)
        .executeTakeFirst()) ?? null
    );
  }

  async get(userId: string, vehicleId: string): Promise<OwnerStatus | null> {
    await this.ownVehicle(userId, vehicleId);
    const r = await this.active(vehicleId);
    return r ? this.toOwner(r) : null;
  }

  /** PUT: create or replace (a new status: started now, nobody waiting yet). */
  async set(userId: string, vehicleId: string, input: StatusInput): Promise<OwnerStatus> {
    this.assertEnabled();
    await this.ownVehicle(userId, vehicleId);
    await this.assertEligible(userId, vehicleId);
    let customText: string | null = null;
    if (input.customText !== undefined) {
      customText = normalizeStatusText(input.customText);
      const problem = checkStatusText(customText);
      if (problem) throw new UnprocessableEntityException({ error: `text_${problem}` });
    }
    await this.limits.enforce('vehicle_status.change', vehicleId);
    const row = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .insertInto('vehicle_status')
        .values({
          vehicle_id: vehicleId,
          preset_key: customText === null ? (input.presetKey ?? null) : null,
          custom_text: customText,
          duration_min: input.durationMin,
          started_at: sql<Date>`now()`,
          expires_at: sql<Date>`now() + make_interval(mins => ${input.durationMin})`,
          version: 1,
          waiting_signal_count: 0,
        })
        .onConflict((oc) =>
          oc.column('vehicle_id').doUpdateSet({
            preset_key: (eb) => eb.ref('excluded.preset_key'),
            custom_text: (eb) => eb.ref('excluded.custom_text'),
            duration_min: (eb) => eb.ref('excluded.duration_min'),
            started_at: (eb) => eb.ref('excluded.started_at'),
            expires_at: (eb) => eb.ref('excluded.expires_at'),
            version: sql`vehicle_status.version + 1`,
            waiting_signal_count: 0,
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.queueJobs(trx, r);
      return r;
    });
    return this.toOwner(row);
  }

  /** „+5 Min“: expires_at = min(expires_at + 5 min, now + 60 min); 409 `at_cap` when nothing moves. */
  async extend(userId: string, vehicleId: string, minutes = STATUS_EXTEND_MINUTES) {
    this.assertEnabled();
    await this.ownVehicle(userId, vehicleId);
    await this.limits.enforce('vehicle_status.change', vehicleId);
    const row = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('vehicle_status')
        .set({
          expires_at: sql<Date>`least(expires_at + make_interval(mins => ${minutes}), now() + make_interval(mins => ${STATUS_MAX_MINUTES}))`,
          version: sql`version + 1`,
        })
        .where('vehicle_id', '=', vehicleId)
        .where('expires_at', '>', sql<Date>`now()`)
        // At the cap already (a second of slack): nothing to extend.
        .where(
          sql<boolean>`expires_at < now() + make_interval(mins => ${STATUS_MAX_MINUTES}) - interval '1 second'`,
        )
        .returningAll()
        .executeTakeFirst();
      if (r) await this.queueJobs(trx, r);
      return r;
    });
    if (row) return this.toOwner(row);
    const current = await this.active(vehicleId);
    if (!current) throw new NotFoundException({ error: 'no_status' });
    throw new ConflictException({ error: 'at_cap', status: this.toOwner(current) });
  }

  /** „Beenden“. Idempotent. */
  async end(userId: string, vehicleId: string): Promise<void> {
    this.assertEnabled();
    await this.ownVehicle(userId, vehicleId);
    await this.limits.enforce('vehicle_status.change', vehicleId);
    await this.db.deleteFrom('vehicle_status').where('vehicle_id', '=', vehicleId).execute();
  }

  private async queueJobs(trx: Transaction<Schema>, r: Row) {
    const payload = JSON.stringify({ vehicleId: r.vehicle_id, version: r.version });
    await trx
      .insertInto('outbox_events')
      .values([
        {
          topic: STATUS_PREWARN_TOPIC,
          payload,
          available_at: sql<Date>`${r.expires_at}::timestamptz - make_interval(secs => ${PREWARN_SECONDS})`,
        },
        { topic: STATUS_EXPIRE_TOPIC, payload, available_at: r.expires_at },
      ])
      .execute();
  }

  // --- worker --------------------------------------------------------------------------------------

  /** Pre-expiry push with „+5 Min“ / „Beenden“: only for the version that queued it, while it runs. */
  async prewarn(vehicleId: string, version: number): Promise<void> {
    const r = await this.db
      .selectFrom('vehicle_status as s')
      .innerJoin('vehicles as v', 'v.id', 's.vehicle_id')
      .select(['s.version', 's.expires_at', 'v.owner_user_id'])
      .where('s.vehicle_id', '=', vehicleId)
      .executeTakeFirst();
    if (!r || r.version !== version || !r.owner_user_id) return;
    if (r.expires_at.getTime() <= Date.now()) return;
    await this.pushOwner(r.owner_user_id, vehicleId, 'brb_expiring');
  }

  /** Expiry of one version; a newer version (extended, replaced) is left alone. */
  async expire(vehicleId: string, version: number): Promise<void> {
    const gone = await this.db
      .deleteFrom('vehicle_status')
      .where('vehicle_id', '=', vehicleId)
      .where('version', '=', version)
      .where('expires_at', '<=', sql<Date>`now() + interval '2 seconds'`)
      .returning('vehicle_id')
      .executeTakeFirst();
    if (gone) await this.ended([vehicleId]);
  }

  /** Safety net every few seconds: whatever expired is deleted, whether or not its job ran. */
  async sweep(): Promise<number> {
    const rows = await this.db
      .deleteFrom('vehicle_status')
      .where('expires_at', '<=', sql<Date>`now()`)
      .returning('vehicle_id')
      .execute();
    if (rows.length) await this.ended(rows.map((r) => r.vehicle_id));
    return rows.length;
  }

  /** Silent data push so an open app drops the banner at once (it also refetches on focus). */
  private async ended(vehicleIds: string[]) {
    const owners = await this.db
      .selectFrom('vehicles')
      .select(['id', 'owner_user_id'])
      .where('id', 'in', vehicleIds)
      .execute();
    for (const o of owners) {
      if (o.owner_user_id) await this.pushOwner(o.owner_user_id, o.id, 'brb_ended', true);
    }
  }

  /** Generic text and ids only (FCM is Google): never the message, the label or the plate. */
  private async pushOwner(
    userId: string,
    vehicleId: string,
    kind: 'brb_expiring' | 'brb_ended',
    silent = false,
  ) {
    const devices = await this.db
      .selectFrom('user_devices')
      .select(['id', 'fcm_token', 'locale'])
      .where('user_id', '=', userId)
      .execute();
    const lang = await this.db
      .selectFrom('users')
      .select('preferred_lang')
      .where('id', '=', userId)
      .executeTakeFirst();
    await Promise.all(
      devices.map(async (d) => {
        const text = appPushText(d.locale ?? lang?.preferred_lang ?? 'de', 'brbExpiring');
        const r = await this.appPush.send({
          token: d.fcm_token,
          ...text,
          data: { vehicleId, kind },
          ...(silent ? { silent: true } : { category: APP_BRB_CATEGORY }),
          urgent: !silent,
          ttlSeconds: silent ? 300 : PREWARN_SECONDS,
          collapseKey: `brb-${vehicleId}`,
        });
        if (!r.ok) this.logger.info({ kind, gone: r.invalidToken }, 'brb push not delivered');
      }),
    );
  }

  // --- scanner -------------------------------------------------------------------------------------

  /** What the scan page shows (server-side check, never cached): the message and the time left. */
  async forScan(vehicleId: string) {
    const r = await this.active(vehicleId);
    if (!r) return null;
    const secondsLeft = Math.max(1, Math.ceil((r.expires_at.getTime() - Date.now()) / 1000));
    return {
      presetKey: (r.preset_key as StatusPreset | null) ?? null,
      customText: r.custom_text,
      secondsLeft,
      minutesLeft: Math.max(1, Math.ceil(secondsLeft / 60)),
    };
  }
}
