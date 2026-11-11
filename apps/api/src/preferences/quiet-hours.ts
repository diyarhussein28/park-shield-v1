/** Weekday index used by notification_rules.days_mask: bit 0 = Monday … bit 6 = Sunday. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface QuietRule {
  quietStart: string; // 'HH:MM' or 'HH:MM:SS'
  quietEnd: string;
  daysMask: number;
  urgentOverride: boolean;
}

const minutes = (t: string) => {
  const [h = '0', m = '0'] = t.split(':');
  return Number(h) * 60 + Number(m);
};

/** Weekday (0 = Monday) and minute of the day at `now` in the owner's time zone. */
export function localClock(now: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: WEEKDAYS.indexOf(get('weekday')),
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/**
 * Is `now` inside the rule's window? A window that ends before it starts runs overnight and belongs
 * to the day it starts on (Fri 22:00–07:00 also covers Saturday morning). Equal start and end = all day.
 */
export function inQuietWindow(rule: QuietRule, now: Date, timeZone: string): boolean {
  const { day, minute } = localClock(now, timeZone);
  const on = (d: number) => (rule.daysMask & (1 << ((d + 7) % 7))) !== 0;
  const start = minutes(rule.quietStart);
  const end = minutes(rule.quietEnd);
  if (start === end) return on(day);
  if (start < end) return on(day) && minute >= start && minute < end;
  return (on(day) && minute >= start) || (on(day - 1) && minute < end);
}

/** OW-06: urgent alerts bypass quiet hours unless the owner turned that off for the rule. */
export function mutedByQuietHours(
  rules: QuietRule[],
  severity: string,
  now: Date,
  timeZone: string,
): boolean {
  return rules.some(
    (r) => inQuietWindow(r, now, timeZone) && !(severity === 'urgent' && r.urgentOverride),
  );
}
