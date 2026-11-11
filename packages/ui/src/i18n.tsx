'use client';

import {
  createTranslator,
  LOCALES,
  messages as allMessages,
  type Locale,
  type Messages,
  type Translate,
} from '@parkshield/i18n';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { clsx } from 'clsx';

interface I18nContextValue {
  locale: Locale;
  t: Translate;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Holds the active locale client-side so switching language re-renders in place, without a reload (US-03).
 * `onLocaleChange` lets the portal persist the choice to the user profile; the scanner page keeps it local
 * because it must not store anything on the device.
 */
export function I18nProvider({
  initialLocale,
  bundles = allMessages,
  onLocaleChange,
  children,
}: {
  initialLocale: Locale;
  bundles?: Record<Locale, Messages>;
  onLocaleChange?: (locale: Locale) => void;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState(initialLocale);
  const t = useMemo(() => createTranslator(locale, bundles[locale]), [locale, bundles]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18nContextValue {
  const ctx = use(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

const LANGUAGE_NAMES: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t('common.language')} className={clsx('flex gap-1', className)}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() => setLocale(l)}
          className={clsx(
            'min-h-12 min-w-12 cursor-pointer rounded-xl px-3 font-semibold',
            l === locale ? 'bg-primary text-primary-fg' : 'bg-secondary text-secondary-fg',
          )}
        >
          {/* Visible code stays part of the accessible name (WCAG 2.5.3 Label in Name). */}
          {l.toUpperCase()}
          <span className="sr-only"> – {LANGUAGE_NAMES[l]}</span>
        </button>
      ))}
    </div>
  );
}
