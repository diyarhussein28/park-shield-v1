import { isLocale, negotiateLocale, type Locale } from '@parkshield/i18n';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE } from './locale-cookie';

/**
 * Request locale: the language the person picked (cookie), else Accept-Language (SC-02). The scanner
 * page has its own negotiation and stores nothing.
 */
export async function requestLocale(): Promise<Locale> {
  const picked = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(picked)) return picked;
  return negotiateLocale((await headers()).get('accept-language'));
}
