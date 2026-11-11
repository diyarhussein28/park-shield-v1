import { IntlMessageFormat, type PrimitiveType } from 'intl-messageformat';
import de from './messages/de';
import en from './messages/en';

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';

export type Messages = typeof de;
export const messages: Record<Locale, Messages> = { de, en };

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;
export type MessageValues = Record<string, PrimitiveType>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Picks the best supported locale from an Accept-Language header (SC-02). German is the default. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { lang: tag.toLowerCase().split('-')[0] ?? '', q: q ? Number(q.split('=')[1]) : 1 };
    })
    .filter((x) => x.lang && !Number.isNaN(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) if (isLocale(lang)) return lang;
  return DEFAULT_LOCALE;
}

export function lookupMessage(tree: unknown, key: string): string | undefined {
  let node = tree;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export type Translate = (key: MessageKey, values?: MessageValues) => string;

export function createTranslator(locale: Locale, bundle: Messages = messages[locale]): Translate {
  const cache = new Map<string, IntlMessageFormat>();
  return (key, values) => {
    const source = lookupMessage(bundle, key);
    if (source === undefined) return key;
    let fmt = cache.get(key);
    if (!fmt) {
      fmt = new IntlMessageFormat(source, locale);
      cache.set(key, fmt);
    }
    return String(fmt.format(values));
  };
}

/** Flattened key list of a bundle, used by the parity test. */
export function flattenKeys(tree: unknown, prefix = ''): string[] {
  if (typeof tree === 'string') return [prefix];
  if (tree === null || typeof tree !== 'object') return [];
  return Object.entries(tree).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}
