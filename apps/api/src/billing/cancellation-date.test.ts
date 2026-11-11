import { describe, expect, it } from 'vitest';
import { cancellationDate } from './billing.service';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('cancellationDate (§309 Nr. 9 BGB)', () => {
  it('ends with the paid year during the initial term', () => {
    const sub = {
      created_at: d('2027-08-03'),
      current_period_start: d('2027-08-03'),
      current_period_end: d('2028-08-03'),
    };
    expect(cancellationDate(sub, d('2027-09-01'))).toEqual(d('2028-08-03'));
  });

  it('allows one month notice after the subscription has renewed', () => {
    const sub = {
      created_at: d('2027-08-03'),
      current_period_start: d('2028-08-03'),
      current_period_end: d('2029-08-03'),
    };
    expect(cancellationDate(sub, d('2028-10-15'))).toEqual(d('2028-11-15'));
  });

  it('never extends beyond the paid period', () => {
    const sub = {
      created_at: d('2027-08-03'),
      current_period_start: d('2028-08-03'),
      current_period_end: d('2029-08-03'),
    };
    expect(cancellationDate(sub, d('2029-07-20'))).toEqual(d('2029-08-03'));
  });
});
