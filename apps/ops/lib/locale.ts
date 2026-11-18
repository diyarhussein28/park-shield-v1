import type { Locale } from '@parkshield/i18n';
import { cookies } from 'next/headers';
import { OPS_LANG_COOKIE } from './locale-cookie';

/**
 * The back office is a German company tool: it opens in German whatever the browser asks for (staff
 * work with German customers, legal terms and ticket texts). Staff can switch to English in the
 * sidebar; that choice is remembered in a preference cookie.
 */
export async function requestLocale(): Promise<Locale> {
  return (await cookies()).get(OPS_LANG_COOKIE)?.value === 'en' ? 'en' : 'de';
}
