'use client';

import type { Locale } from '@parkshield/i18n';
import { I18nProvider } from '@parkshield/ui';
import type { ReactNode } from 'react';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nProvider initialLocale={locale}>{children}</I18nProvider>;
}
