import { negotiateLocale, type Locale } from '@parkshield/i18n';
import { headers } from 'next/headers';

/** Request locale from Accept-Language (SC-02). The portal later prefers the stored profile language. */
export async function requestLocale(): Promise<Locale> {
  return negotiateLocale((await headers()).get('accept-language'));
}
