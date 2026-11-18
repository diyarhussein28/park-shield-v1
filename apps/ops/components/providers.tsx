'use client';

import type { Locale } from '@parkshield/i18n';
import { I18nProvider } from '@parkshield/ui';
import type { ReactNode } from 'react';
import { OPS_LANG_COOKIE } from '@/lib/locale-cookie';

/** Remembers the staff member's language choice (German unless they switch) for the next visit. */
function remember(locale: Locale) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${OPS_LANG_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Strict${secure}`;
}

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <I18nProvider initialLocale={locale} onLocaleChange={remember}>
      {children}
    </I18nProvider>
  );
}
