/** Short date and time for tables (client and server). */
export const fmt = (v: string | Date | null | undefined, locale: string) =>
  v
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Europe/Berlin',
      }).format(new Date(v))
    : '–';

export const euro = (cents: number, locale: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);

/** Error code from an api-ops response body, for messages like "promo_exists". */
export const errorCode = (err: unknown): string | undefined =>
  (err as { body?: { error?: string } } | null)?.body?.error;
