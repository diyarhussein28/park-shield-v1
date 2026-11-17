import { describe, expect, it } from 'vitest';
import {
  assertTagTransition,
  computeCancellationEnd,
  computeWithdrawalRefund,
  contractState,
  InvalidTagTransition,
  monthlyPriceCents,
  scannerDecision,
  TAG_STATUSES,
  TAG_TRANSITIONS,
  withdrawalOpenUntil,
  type ContractPeriod,
} from './rules';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

const firstYear: ContractPeriod = {
  startedAt: d('2027-08-03'),
  currentPeriodStart: d('2027-08-03'),
  currentPeriodEnd: d('2028-08-03'),
  interval: 'year',
};

describe('computeCancellationEnd', () => {
  describe('annual', () => {
    it('ends with the current paid year', () => {
      expect(computeCancellationEnd(firstYear, d('2027-09-01'), 'annual')).toEqual(d('2028-08-03'));
    });

    it('ends with the renewed year after a renewal, without a refund', () => {
      const renewed = {
        ...firstYear,
        currentPeriodStart: d('2028-08-03'),
        currentPeriodEnd: d('2029-08-03'),
      };
      expect(computeCancellationEnd(renewed, d('2028-10-15'), 'annual')).toEqual(d('2029-08-03'));
    });

    it('a cancellation on the last day still ends with that period', () => {
      expect(computeCancellationEnd(firstYear, d('2028-08-02'), 'annual')).toEqual(d('2028-08-03'));
    });

    it('a later requested date moves the end to the next yearly boundary', () => {
      expect(computeCancellationEnd(firstYear, d('2027-09-01'), 'annual', d('2028-12-01'))).toEqual(
        d('2029-08-03'),
      );
    });

    it('an earlier requested date never shortens the paid period', () => {
      expect(computeCancellationEnd(firstYear, d('2027-09-01'), 'annual', d('2027-10-01'))).toEqual(
        d('2028-08-03'),
      );
    });
  });

  describe('monthly_after_first_term', () => {
    it('ends with the first year while in the first term', () => {
      expect(
        computeCancellationEnd(firstYear, d('2027-09-01'), 'monthly_after_first_term'),
      ).toEqual(d('2028-08-03'));
    });

    it('ends with the paid month after the first term', () => {
      const monthly: ContractPeriod = {
        startedAt: d('2027-08-03'),
        currentPeriodStart: d('2028-10-03'),
        currentPeriodEnd: d('2028-11-03'),
        interval: 'month',
      };
      expect(computeCancellationEnd(monthly, d('2028-10-20'), 'monthly_after_first_term')).toEqual(
        d('2028-11-03'),
      );
    });

    it('a requested date after the first year moves to the next monthly boundary', () => {
      expect(
        computeCancellationEnd(
          firstYear,
          d('2027-09-01'),
          'monthly_after_first_term',
          d('2028-09-15'),
        ),
      ).toEqual(d('2028-10-03'));
    });

    it('rolls a period that already ended forward (late webhook)', () => {
      const monthly: ContractPeriod = {
        startedAt: d('2027-08-03'),
        currentPeriodStart: d('2028-09-03'),
        currentPeriodEnd: d('2028-10-03'),
        interval: 'month',
      };
      expect(computeCancellationEnd(monthly, d('2028-10-05'), 'monthly_after_first_term')).toEqual(
        d('2028-11-03'),
      );
    });

    it('keeps the day of month at month ends', () => {
      const monthly: ContractPeriod = {
        startedAt: d('2027-01-31'),
        currentPeriodStart: d('2028-01-31'),
        currentPeriodEnd: d('2028-02-29'),
        interval: 'month',
      };
      expect(
        computeCancellationEnd(
          monthly,
          d('2028-02-10'),
          'monthly_after_first_term',
          d('2028-03-05'),
        ),
      ).toEqual(d('2028-03-29'));
    });
  });

  it('monthly price keeps the annual level', () => {
    expect(monthlyPriceCents(1000)).toBe(83);
    expect(monthlyPriceCents(1500)).toBe(125);
  });
});

describe('computeWithdrawalRefund', () => {
  const base = {
    paidCents: 1000,
    alreadyRefundedCents: 0,
    periodStart: d('2027-08-03'),
    periodEnd: d('2028-08-03'),
    immediateStartConsented: true,
  };

  it('deducts the value of the started days', () => {
    const r = computeWithdrawalRefund({ ...base, withdrawnAt: new Date('2027-08-07T12:00:00Z') });
    expect(r).toEqual({ daysUsed: 5, periodDays: 366, wertersatzCents: 14, refundCents: 986 });
  });

  it('counts at least one day on the first day', () => {
    const r = computeWithdrawalRefund({ ...base, withdrawnAt: new Date('2027-08-03T08:00:00Z') });
    expect(r.daysUsed).toBe(1);
    expect(r.refundCents).toBe(997);
  });

  it('refunds everything without the immediate-start request', () => {
    const r = computeWithdrawalRefund({
      ...base,
      immediateStartConsented: false,
      withdrawnAt: d('2027-08-10'),
    });
    expect(r).toMatchObject({ daysUsed: 0, wertersatzCents: 0, refundCents: 1000 });
  });

  it('never refunds more than is left of the charge', () => {
    const r = computeWithdrawalRefund({
      ...base,
      alreadyRefundedCents: 995,
      withdrawnAt: d('2027-08-05'),
    });
    expect(r.refundCents).toBe(5);
  });

  it('applies a configured deduction and never goes negative', () => {
    const r = computeWithdrawalRefund({
      ...base,
      deductionCents: 2000,
      withdrawnAt: d('2027-08-05'),
    });
    expect(r.refundCents).toBe(0);
  });

  it('withdrawal period is 14 days from the contract', () => {
    expect(withdrawalOpenUntil(d('2027-08-03'), 14)).toEqual(d('2027-08-17'));
  });
});

describe('tag state machine', () => {
  it('allows exactly the listed transitions', () => {
    const allowed: string[] = [];
    for (const from of TAG_STATUSES) {
      for (const to of TAG_STATUSES) {
        try {
          assertTagTransition(from, to);
          allowed.push(`${from}→${to}`);
        } catch (err) {
          expect(err).toBeInstanceOf(InvalidTagTransition);
        }
      }
    }
    expect(allowed.sort()).toEqual(['assigned→revoked', 'in_stock→assigned', 'in_stock→revoked']);
  });

  it('a revoked code is final', () => {
    expect(TAG_TRANSITIONS.revoked).toEqual([]);
  });
});

describe('scannerDecision', () => {
  const now = d('2028-01-10');
  const run = (
    tag: Parameters<typeof scannerDecision>[0]['tag'],
    contract: Parameters<typeof scannerDecision>[0]['contract'],
    pastDueSince?: Date,
  ) => scannerDecision({ tag, contract, pastDueSince, now, pastDueGraceDays: 21 });

  it.each([
    ['assigned', 'active', 'alert'],
    ['assigned', 'cancel_scheduled', 'alert'],
    ['assigned', 'ended', 'inactive'],
    ['assigned', 'withdrawn', 'inactive'],
    ['assigned', null, 'inactive'],
    ['revoked', 'active', 'inactive'],
    ['in_stock', 'active', 'inactive'],
    [null, 'active', 'inactive'],
  ] as const)('%s + %s → %s', (tag, contract, page) => {
    expect(run(tag, contract)).toBe(page);
  });

  it('past due within the grace period still alerts', () => {
    expect(run('assigned', 'past_due', d('2027-12-25'))).toBe('alert');
  });

  it('past due after the grace period is inactive', () => {
    expect(run('assigned', 'past_due', d('2027-12-15'))).toBe('inactive');
  });

  it('maps database states', () => {
    expect(contractState({ status: 'active', cancel_at_period_end: true })).toBe(
      'cancel_scheduled',
    );
    expect(contractState({ status: 'expired', cancel_at_period_end: false })).toBe('ended');
    expect(contractState({ status: 'incomplete', cancel_at_period_end: false })).toBeNull();
  });
});
