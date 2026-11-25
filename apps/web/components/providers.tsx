'use client';

import type { Locale } from '@parkshield/i18n';
import { I18nProvider } from '@parkshield/ui';
import { useRouter } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { LOCALE_COOKIE } from '@/lib/locale-cookie';

/**
 * The language a person picks sticks: a first-party preference cookie (strictly necessary, no tracking,
 * §25(2) TDDDG) for every page, and for a signed-in owner also the profile, so e-mails and SMS follow.
 */
export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  const router = useRouter();
  const remember = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      // The server renders the page's <title> and description again in the new language.
      router.refresh();
      // Not signed in: the API answers 401, which is fine.
      void api('/v1/me', { method: 'PATCH', body: { preferredLang: next } }).catch(() => undefined);
    },
    [router],
  );
  return (
    <I18nProvider initialLocale={locale} onLocaleChange={remember}>
      {children}
    </I18nProvider>
  );
}
