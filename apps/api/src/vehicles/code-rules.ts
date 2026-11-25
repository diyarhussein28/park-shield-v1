import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';
import type { CodeIssueKind, DB as Database } from '../db/types.generated';

/**
 * New-code rules (owner decision 2026-11-24, docs/handover.md §14):
 * - at most one new code per vehicle every `codes.reissue_cooldown_days` (10) days, counted from the
 *   newest code of the vehicle (the first one included);
 * - after a „Sperren“ (no active code) the owner gets `codes.free_reissues_per_year` (1) new code free
 *   per subscription year; otherwise a new code comes with a printed sticker for
 *   `prices.print_shipped_cents` (3 €, Stripe only — phase 3);
 * - staff with `codes.override_cooldown` may issue one anyway (audited).
 * Every code issued to a vehicle is recorded in `code_issuances` (`recordIssuance`).
 */
export const COOLDOWN_DAYS_DEFAULT = 10;
export const FREE_PER_YEAR_DEFAULT = 1;
export const PRINT_PRICE_DEFAULT = 300;

type Executor = Kysely<Database> | Transaction<Database>;

export type NewCodeBlock = 'subscription_required' | 'cooldown' | 'code_active' | 'free_used';

export interface NewCodeEligibility {
  /** „Neuen Code erstellen (kostenlos)“: no active code, outside the cooldown, free one left. */
  freeAvailable: boolean;
  /** „Neuer Code + gedruckter Aufkleber (3 €)“: outside the cooldown (replaces an active code). */
  paidAvailable: boolean;
  /** While the cooldown runs: the first moment a new code is possible again (UTC). */
  nextEligibleAt: Date | null;
  lastIssuedAt: Date | null;
  cooldownDays: number;
  priceCents: number;
  freePerYear: number;
  freeUsed: number;
  hasActiveCode: boolean;
  /** Why the free code is not available (null when it is). */
  reason: NewCodeBlock | null;
  /** The vehicle's first and only code is locked: the cooldown does not apply (2026-11-25). */
  firstLock: boolean;
}

/**
 * Start of the subscription year `now` falls in: the anchor (first purchase) plus whole years. A
 * contract bought on 29 Feb starts its years on 1 Mar in other years (Date rolls over).
 */
export function subscriptionYearStart(anchor: Date, now: Date): Date {
  const at = (years: number) => {
    const d = new Date(anchor);
    d.setUTCFullYear(anchor.getUTCFullYear() + years);
    return d;
  };
  let years = Math.max(0, now.getUTCFullYear() - anchor.getUTCFullYear());
  while (years > 0 && at(years) > now) years--;
  return at(years);
}

/** One row per code issued to a vehicle, inside the transaction that issued it. */
export async function recordIssuance(
  trx: Executor,
  input: {
    vehicleId: string;
    userId: string;
    tokenId: string;
    kind: CodeIssueKind;
    subscriptionId?: string | null;
    subscriptionYearStart?: Date | null;
    stripeRef?: string | null;
  },
): Promise<void> {
  await trx
    .insertInto('code_issuances')
    .values({
      vehicle_id: input.vehicleId,
      user_id: input.userId,
      qr_token_id: input.tokenId,
      kind: input.kind,
      subscription_id: input.subscriptionId ?? null,
      subscription_year_start: input.subscriptionYearStart ?? null,
      stripe_ref: input.stripeRef ?? null,
    })
    .execute();
}

/** Audit entry of every replaced code (owner, staff or the system). */
export async function auditCodeReplaced(
  trx: Executor,
  actor: { id: string | null; kind: 'customer' | 'staff' | null },
  input: { vehicleId: string; tokenId: string; kind: CodeIssueKind; reason?: string },
): Promise<void> {
  await trx
    .insertInto('audit_logs')
    .values({
      actor_id: actor.id,
      actor_kind: actor.kind,
      action: 'qr_code.replaced',
      entity: 'vehicles',
      entity_id: input.vehicleId,
      meta: JSON.stringify({
        kind: input.kind,
        tokenId: input.tokenId,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    })
    .execute();
}

/** Serialises every new-code decision of one account (one plan, one vehicle per account). */
export async function lockCodes(trx: Transaction<Database>, userId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${`codes:${userId}`}))`.execute(trx);
}

@Injectable()
export class CodeRulesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async cooldownDays(): Promise<number> {
    return Number(await this.settings.get('codes.reissue_cooldown_days', COOLDOWN_DAYS_DEFAULT));
  }

  /** The live subscription and the start of its current subscription year. */
  async subscriptionYear(
    exec: Executor,
    userId: string,
    now = new Date(),
  ): Promise<{ subscriptionId: string; yearStart: Date } | null> {
    const s = await exec
      .selectFrom('subscriptions')
      .select(['id', 'original_purchase_at', 'created_at'])
      .where('user_id', '=', userId)
      .where('status', 'in', ['active', 'past_due'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    if (!s) return null;
    return {
      subscriptionId: s.id,
      yearStart: subscriptionYearStart(new Date(s.original_purchase_at ?? s.created_at), now),
    };
  }

  /** The one place that decides about a new code; call it inside the issuing transaction. */
  async eligibility(
    exec: Executor,
    userId: string,
    vehicleId: string,
    now = new Date(),
  ): Promise<NewCodeEligibility & { subscriptionId: string | null; yearStart: Date | null }> {
    const [cooldownDays, freePerYear, priceCents, year, active, last, codesEver] =
      await Promise.all([
        this.cooldownDays(),
        this.settings
          .get('codes.free_reissues_per_year', FREE_PER_YEAR_DEFAULT)
          .then((v) => Number(v)),
        this.settings.get('prices.print_shipped_cents', PRINT_PRICE_DEFAULT).then((v) => Number(v)),
        this.subscriptionYear(exec, userId, now),
        exec
          .selectFrom('qr_tokens')
          .select('id')
          .where('vehicle_id', '=', vehicleId)
          .where('status', '<>', 'revoked')
          .executeTakeFirst(),
        // The newest code: the ledger, and the codes themselves (assigned_at) as a safety net.
        exec
          .selectFrom('qr_tokens')
          .select(sql<Date | null>`max(coalesce(assigned_at, created_at))`.as('at'))
          .where('vehicle_id', '=', vehicleId)
          .executeTakeFirst()
          .then(async (t) => {
            const l = await exec
              .selectFrom('code_issuances')
              .select(sql<Date | null>`max(issued_at)`.as('at'))
              .where('vehicle_id', '=', vehicleId)
              .executeTakeFirst();
            const times = [t?.at, l?.at]
              .filter((d): d is Date => d != null)
              .map((d) => +new Date(d));
            return times.length ? new Date(Math.max(...times)) : null;
          }),
        // How many codes the vehicle ever had (the ledger, and the codes themselves).
        exec
          .selectFrom('qr_tokens')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('vehicle_id', '=', vehicleId)
          .executeTakeFirstOrThrow()
          .then(async (t) => {
            const l = await exec
              .selectFrom('code_issuances')
              .select((eb) => eb.fn.countAll<string>().as('n'))
              .where('vehicle_id', '=', vehicleId)
              .executeTakeFirstOrThrow();
            return Math.max(Number(t.n), Number(l.n));
          }),
      ]);
    const freeUsed = year
      ? Number(
          (
            await exec
              .selectFrom('code_issuances')
              .select((eb) => eb.fn.countAll<string>().as('n'))
              .where('user_id', '=', userId)
              .where('kind', '=', 'free')
              .where('subscription_id', '=', year.subscriptionId)
              .where('subscription_year_start', '=', year.yearStart)
              .executeTakeFirstOrThrow()
          ).n,
        )
      : 0;
    const until = last ? new Date(+last + cooldownDays * 86_400_000) : null;
    // The first lock: the only code the vehicle ever had is locked → no cooldown for its replacement.
    const firstLock = !active && codesEver <= 1;
    const inCooldown = !firstLock && until !== null && until > now;
    const reason: NewCodeBlock | null = !year
      ? 'subscription_required'
      : inCooldown
        ? 'cooldown'
        : active
          ? 'code_active'
          : freeUsed >= freePerYear
            ? 'free_used'
            : null;
    return {
      freeAvailable: reason === null,
      paidAvailable: Boolean(year) && !inCooldown,
      nextEligibleAt: inCooldown ? until : null,
      lastIssuedAt: last,
      cooldownDays,
      priceCents,
      freePerYear,
      freeUsed,
      hasActiveCode: Boolean(active),
      reason,
      firstLock,
      subscriptionId: year?.subscriptionId ?? null,
      yearStart: year?.yearStart ?? null,
    };
  }
}
