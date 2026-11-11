import { describe, expect, it } from 'vitest';
import { inQuietWindow, localClock, mutedByQuietHours, type QuietRule } from './quiet-hours';

const BERLIN = 'Europe/Berlin';
const ALL = 0b1111111;
const rule = (over: Partial<QuietRule>): QuietRule => ({
  quietStart: '22:00',
  quietEnd: '07:00',
  daysMask: ALL,
  urgentOverride: true,
  ...over,
});

describe('quiet hours (OW-06)', () => {
  it('reads the clock in the owner’s time zone', () => {
    // 2027-01-04 is a Monday; 21:30 UTC = 22:30 in Berlin (CET).
    expect(localClock(new Date('2027-01-04T21:30:00Z'), BERLIN)).toEqual({
      day: 0,
      minute: 22 * 60 + 30,
    });
    // Summer time: 20:30 UTC = 22:30 CEST.
    expect(localClock(new Date('2027-07-05T20:30:00Z'), BERLIN).minute).toBe(22 * 60 + 30);
  });

  it('handles windows over midnight, attached to the day they start', () => {
    const fridayNight = rule({ daysMask: 1 << 4 }); // Fri 22:00 – Sat 07:00
    expect(inQuietWindow(fridayNight, new Date('2027-01-08T22:30:00Z'), BERLIN)).toBe(true); // Fri 23:30
    expect(inQuietWindow(fridayNight, new Date('2027-01-09T05:00:00Z'), BERLIN)).toBe(true); // Sat 06:00
    expect(inQuietWindow(fridayNight, new Date('2027-01-09T07:00:00Z'), BERLIN)).toBe(false); // Sat 08:00
    expect(inQuietWindow(fridayNight, new Date('2027-01-07T22:30:00Z'), BERLIN)).toBe(false); // Thu 23:30
    expect(inQuietWindow(fridayNight, new Date('2027-01-08T05:00:00Z'), BERLIN)).toBe(false); // Fri 06:00
  });

  it('daytime windows, all-day windows and weekday masks', () => {
    const office = rule({ quietStart: '09:00', quietEnd: '17:00', daysMask: 0b0011111 });
    expect(inQuietWindow(office, new Date('2027-01-05T10:00:00Z'), BERLIN)).toBe(true); // Tue 11:00
    expect(inQuietWindow(office, new Date('2027-01-05T16:00:00Z'), BERLIN)).toBe(false); // Tue 17:00
    expect(inQuietWindow(office, new Date('2027-01-09T10:00:00Z'), BERLIN)).toBe(false); // Sat
    const sunday = rule({ quietStart: '00:00', quietEnd: '00:00', daysMask: 1 << 6 });
    expect(inQuietWindow(sunday, new Date('2027-01-10T12:00:00Z'), BERLIN)).toBe(true);
    expect(inQuietWindow(sunday, new Date('2027-01-11T12:00:00Z'), BERLIN)).toBe(false);
  });

  it('lets urgent alerts through by default, unless the owner turned that off', () => {
    const at = new Date('2027-01-04T23:00:00Z'); // Tue 00:00 Berlin
    expect(mutedByQuietHours([rule({})], 'normal', at, BERLIN)).toBe(true);
    expect(mutedByQuietHours([rule({})], 'urgent', at, BERLIN)).toBe(false);
    expect(mutedByQuietHours([rule({ urgentOverride: false })], 'urgent', at, BERLIN)).toBe(true);
    expect(mutedByQuietHours([], 'normal', at, BERLIN)).toBe(false);
  });
});
