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

/** What the withdrawal refund needs to know about a Stripe subscription (B4). */
export interface WithdrawalSubscription {
  /** Amount paid for the subscription (gross cents). */
  paidCents: number;
  /** Already refunded for this charge (never refund more than is left). */
  alreadyRefundedCents?: number;
  /** Sticker value included in the price, stored at purchase (`sticker_value_cents`). */
  stickerValueCents: number;
  /** When the sticker was personalised (confirmed order); null: not personalised. */
  personalizedAt: Date | null;
  /** Start of the service (contract start / current period start). */
  serviceStart: Date;
  /** Days in the contract year (365 or 366). */
  contractYearDays: number;
  /** The customer expressly asked for the immediate start (§ 356 Abs. 4, § 357a Abs. 2 BGB). */
  immediateStartConsented: boolean;
}

export interface WithdrawalRefund {
  paidCents: number;
  stickerExcludedCents: number;
  serviceBaseCents: number;
  usedDays: number;
  contractYearDays: number;
  serviceValueCents: number;
  refundCents: number;
}

/**
 * B4 (2026-11-22), Stripe subscriptions only. The personalised sticker has no right of withdrawal
 * (§ 312g Abs. 2 Nr. 1 BGB), so its value is kept once it was personalised before the withdrawal; the
 * service days already used are paid pro rata on the rest (Wertersatz, § 357a Abs. 2 BGB):
 *
 *   stickerExcluded = stickerValue if personalised before the withdrawal, else 0
 *   serviceBase     = paid − stickerExcluded
 *   usedDays        = whole days from service start to receipt (0 without immediate-start consent)
 *   serviceValue    = round(serviceBase × usedDays / days in the contract year)
 *   refund          = max(0, paid − stickerExcluded − serviceValue)
 *
 * Example: 2000, sticker 300, 10 days → 2000 − 300 − round(1700 × 10 / 365) = 1653.
 * TODO [LEGAL REVIEW] formula, whole days vs. started days, LEGAL_REVIEW.md §12.
 */
export function computeWithdrawalRefund(
  sub: WithdrawalSubscription,
  withdrawalReceivedAt: Date,
): WithdrawalRefund {
  const paid = Math.max(0, sub.paidCents);
  const stickerExcluded =
    sub.personalizedAt && sub.personalizedAt.getTime() <= withdrawalReceivedAt.getTime()
      ? Math.min(paid, Math.max(0, sub.stickerValueCents))
      : 0;
  const serviceBase = paid - stickerExcluded;
  const yearDays = Math.max(1, sub.contractYearDays);
  const usedDays = sub.immediateStartConsented
    ? Math.min(
        yearDays,
        Math.max(
          0,
          Math.floor((withdrawalReceivedAt.getTime() - sub.serviceStart.getTime()) / DAY),
        ),
      )
    : 0;
  const serviceValue = Math.round((serviceBase * usedDays) / yearDays);
  const left = Math.max(0, paid - (sub.alreadyRefundedCents ?? 0));
  const refund = Math.max(0, Math.min(left, paid - stickerExcluded - serviceValue));
  return {
    paidCents: paid,
    stickerExcludedCents: stickerExcluded,
    serviceBaseCents: serviceBase,
    usedDays,
    contractYearDays: yearDays,
    serviceValueCents: serviceValue,
    refundCents: refund,
  };
}

/** Days in the contract year that starts at `start` (366 when it spans a 29 February). */
export function contractYearDays(start: Date): number {
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return Math.round((end.getTime() - start.getTime()) / DAY);
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
  'damaged', // an in-house stock sticker taken out before packing (2026-11-27)
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
