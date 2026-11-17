/**
 * Pure rules for contracts and decals: no database, no clock, no provider. Everything that decides an
 * end date, an amount or what the scanner sees lives here and is unit-tested (rules.test.ts).
 * TODO [LEGAL REVIEW]: the renewal and Wertersatz rules (LEGAL_REVIEW.md).
 */

const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------------
// Renewal and cancellation (§ 309 Nr. 9 BGB, § 312k BGB)

/**
 * `annual`: renews by 12 months; a cancellation ends the contract at the end of the current period.
 * `monthly_after_first_term`: the first 12 months are paid upfront; afterwards the contract runs
 * month by month at the same price level and ends at the end of the paid month.
 * TODO [LEGAL REVIEW: § 309 Nr. 9 BGB] whether `annual` may be used for consumers.
 */
export const RENEWAL_MODES = ['annual', 'monthly_after_first_term'] as const;
export type RenewalMode = (typeof RENEWAL_MODES)[number];

export interface ContractPeriod {
  /** Start of the contract (first payment). */
  startedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  /** Billing interval of the current period. */
  interval: 'year' | 'month';
}

const addMonths = (d: Date, months: number) => {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
};

/** Period boundaries after `end`, in the steps the contract renews by under `mode`. */
function nextBoundary(end: Date, startedAt: Date, mode: RenewalMode): Date {
  const firstTermEnd = addMonths(startedAt, 12);
  if (mode === 'monthly_after_first_term' && end.getTime() >= firstTermEnd.getTime() - DAY) {
    return addMonths(end, 1);
  }
  return addMonths(end, 12);
}

/**
 * The date a cancellation received at `receivedAt` takes effect. The contract always runs to the end of
 * a paid period, never shorter (no refund of a running period), and never before a later date the
 * customer asked for: then it ends with the first period boundary on or after that date.
 */
export function computeCancellationEnd(
  contract: ContractPeriod,
  receivedAt: Date,
  mode: RenewalMode,
  requestedDate?: Date | null,
): Date {
  let end = contract.currentPeriodEnd;
  // A period that already ended (late webhook) rolls forward to the one that is running now.
  while (end.getTime() <= receivedAt.getTime()) end = nextBoundary(end, contract.startedAt, mode);
  if (requestedDate) {
    while (end.getTime() < requestedDate.getTime()) {
      end = nextBoundary(end, contract.startedAt, mode);
    }
  }
  return end;
}

/** Whether the next renewal of this contract switches it to the monthly price. */
export function switchesToMonthlyAtRenewal(contract: ContractPeriod, mode: RenewalMode): boolean {
  return mode === 'monthly_after_first_term' && contract.interval === 'year';
}

/** Monthly price at the same level as the annual one, rounded to whole cents. */
export const monthlyPriceCents = (annualCents: number) => Math.round(annualCents / 12);

// ---------------------------------------------------------------------------------------------------
// Withdrawal (§ 355, § 356 Abs. 4, § 357a Abs. 2 BGB)

/** The withdrawal period starts with the conclusion of the contract (services). */
export function withdrawalOpenUntil(contractStartedAt: Date, days: number): Date {
  return new Date(contractStartedAt.getTime() + days * DAY);
}

export interface WithdrawalRefundInput {
  paidCents: number;
  alreadyRefundedCents: number;
  periodStart: Date;
  periodEnd: Date;
  withdrawnAt: Date;
  /** The customer expressly asked for the immediate start (§ 356 Abs. 4, § 357a Abs. 2 BGB). */
  immediateStartConsented: boolean;
  /** Fixed deduction (e.g. a custom-made item, § 312g Abs. 2 Nr. 1 BGB); 0 for ParkShield decals. */
  deductionCents?: number;
}

export interface WithdrawalRefund {
  daysUsed: number;
  periodDays: number;
  wertersatzCents: number;
  refundCents: number;
}

/**
 * Refund = paid − pro-rata value of the service until the withdrawal (per started day), only when the
 * customer asked for the immediate start; never more than what is left of the charge, never negative.
 */
export function computeWithdrawalRefund(input: WithdrawalRefundInput): WithdrawalRefund {
  const periodDays = Math.max(
    1,
    Math.round((input.periodEnd.getTime() - input.periodStart.getTime()) / DAY),
  );
  const daysUsed = input.immediateStartConsented
    ? Math.min(
        periodDays,
        Math.max(1, Math.ceil((input.withdrawnAt.getTime() - input.periodStart.getTime()) / DAY)),
      )
    : 0;
  const wertersatzCents = Math.round((input.paidCents * daysUsed) / periodDays);
  const left = Math.max(0, input.paidCents - input.alreadyRefundedCents);
  const refundCents = Math.max(
    0,
    Math.min(left, input.paidCents - wertersatzCents - (input.deductionCents ?? 0)),
  );
  return { daysUsed, periodDays, wertersatzCents, refundCents };
}

// ---------------------------------------------------------------------------------------------------
// Tag lifecycle

export const TAG_STATUSES = ['in_stock', 'assigned', 'revoked'] as const;
export type TagStatus = (typeof TAG_STATUSES)[number];

/** The only allowed transitions. A revoked code never comes back. */
export const TAG_TRANSITIONS: Readonly<Record<TagStatus, readonly TagStatus[]>> = {
  in_stock: ['assigned', 'revoked'],
  assigned: ['revoked'],
  revoked: [],
};

export const TAG_REVOKE_REASONS = [
  'lost',
  'replaced',
  'replaced_by_stock',
  'replaced_by_preprinted',
  'withdrawn',
  'car_sold',
  'leaked',
  'admin',
] as const;

export class InvalidTagTransition extends Error {
  constructor(
    readonly from: TagStatus,
    readonly to: TagStatus,
  ) {
    super(`tag transition ${from} → ${to} is not allowed`);
  }
}

export function assertTagTransition(from: TagStatus, to: TagStatus): void {
  if (!TAG_TRANSITIONS[from].includes(to)) throw new InvalidTagTransition(from, to);
}

// ---------------------------------------------------------------------------------------------------
// Scanner page (SC-07)

/**
 * Subscription states as the business sees them. `cancel_scheduled` is an active subscription with a
 * cancellation pending; `ended` covers both `canceled` and `expired` in the database enum.
 */
export type ContractState = 'active' | 'cancel_scheduled' | 'past_due' | 'ended' | 'withdrawn';

export function contractState(sub: {
  status: string;
  cancel_at_period_end: boolean;
}): ContractState | null {
  if (sub.status === 'active') return sub.cancel_at_period_end ? 'cancel_scheduled' : 'active';
  if (sub.status === 'past_due') return 'past_due';
  if (sub.status === 'withdrawn') return 'withdrawn';
  if (sub.status === 'canceled' || sub.status === 'expired') return 'ended';
  return null; // incomplete: never paid
}

export type ScannerPage = 'alert' | 'inactive';

/** What a scan shows. The neutral page reveals nothing about the owner or the vehicle. */
export function scannerDecision(input: {
  tag: TagStatus | null;
  contract: ContractState | null;
  pastDueSince?: Date | null;
  now: Date;
  pastDueGraceDays: number;
}): ScannerPage {
  if (input.tag !== 'assigned') return 'inactive';
  if (input.contract === 'active' || input.contract === 'cancel_scheduled') return 'alert';
  if (input.contract === 'past_due') {
    const since = input.pastDueSince ?? input.now;
    return input.now.getTime() - since.getTime() <= input.pastDueGraceDays * DAY
      ? 'alert'
      : 'inactive';
  }
  return 'inactive';
}
