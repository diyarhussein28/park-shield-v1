import type { Locale } from '@parkshield/i18n';

/**
 * The back office is a German company tool: it always opens in German, whatever the browser asks
 * for (staff work with German customers, legal terms and ticket texts).
 */
export async function requestLocale(): Promise<Locale> {
  return 'de';
}
