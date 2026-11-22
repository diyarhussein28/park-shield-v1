import { describe, expect, it } from 'vitest';
import {
  assertTagTransition,
  computeCancellationEnd,
  computeWithdrawalRefund,
  contractState,
  contractYearDays,
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

describe('computeWithdrawalRefund (B4, Stripe only)', () => {
  const start = new Date('2027-01-10T09:00:00Z');
  const base = {
    paidCents: 2000,
    stickerValueCents: 300,
    personalizedAt: new Date('2027-01-10T10:00:00Z'),
    serviceStart: start,
    contractYearDays: 365,
    immediateStartConsented: true,
  };
  const at = (days: number, hours = 0) =>
    new Date(start.getTime() + days * 86_400_000 + hours * 3_600_000);

  it('the example: 10 days after personalisation → 16,53 €', () => {
    expect(computeWithdrawalRefund(base, at(10))).toEqual({
      paidCents: 2000,
      stickerExcludedCents: 300,
      serviceBaseCents: 1700,
      usedDays: 10,
      contractYearDays: 365,
      serviceValueCents: 47,
      refundCents: 1653,
    });
  });

  it('before personalisation: no sticker deduction', () => {
    const r = computeWithdrawalRefund({ ...base, personalizedAt: null }, at(10));
    expect(r.stickerExcludedCents).toBe(0);
    expect(r.serviceValueCents).toBe(55); // round(2000 × 10 / 365) = 54.79
    expect(r.refundCents).toBe(1945);
  });

  it('personalised only after the withdrawal: no sticker deduction', () => {
    const r = computeWithdrawalRefund({ ...base, personalizedAt: at(12) }, at(10));
    expect(r.stickerExcludedCents).toBe(0);
  });

  it('without the immediate-start consent: no service value', () => {
    const r = computeWithdrawalRefund({ ...base, immediateStartConsented: false }, at(10));
    expect(r).toMatchObject({ usedDays: 0, serviceValueCents: 0, refundCents: 1700 });
  });

  it('day 0 (same day, a few hours later): whole days only', () => {
    const r = computeWithdrawalRefund(base, at(0, 5));
    expect(r).toMatchObject({ usedDays: 0, serviceValueCents: 0, refundCents: 1700 });
  });

  it('day 13: round(1700 × 13 / 365) = 61', () => {
    const r = computeWithdrawalRefund(base, at(13, 23));
    expect(r).toMatchObject({ usedDays: 13, serviceValueCents: 61, refundCents: 1639 });
  });

  it('rounds half up (1700 × 1 / 365 = 4.66 → 5; 1825 × 3 / 365 = 15)', () => {
    expect(computeWithdrawalRefund(base, at(1)).serviceValueCents).toBe(5);
    const even = computeWithdrawalRefund(
      { ...base, paidCents: 2125, stickerValueCents: 300 },
      at(3),
    );
    expect(even.serviceValueCents).toBe(15);
  });

  it('old contracts (sticker value 0) and printed stickers without personalized_at: no deduction', () => {
    expect(computeWithdrawalRefund({ ...base, stickerValueCents: 0 }, at(10)).refundCents).toBe(
      1945,
    );
  });

  it('never refunds more than is left, never negative', () => {
    expect(
      computeWithdrawalRefund({ ...base, alreadyRefundedCents: 1990 }, at(2)).refundCents,
    ).toBe(10);
    expect(computeWithdrawalRefund({ ...base, stickerValueCents: 5000 }, at(2)).refundCents).toBe(
      0,
    );
  });

  it('contract year length', () => {
    expect(contractYearDays(new Date('2027-01-10T00:00:00Z'))).toBe(365);
    expect(contractYearDays(new Date('2027-08-03T00:00:00Z'))).toBe(366);
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
