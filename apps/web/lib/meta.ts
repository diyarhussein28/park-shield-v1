import { createTranslator, type MessageKey, type MessageValues } from '@parkshield/i18n';
import type { Metadata } from 'next';
import { requestLocale } from './locale';

/**
 * The page `<title>` in the visitor's language (QA 2026-11-25): the language they picked (cookie),
 * else their phone's or browser's language (Accept-Language), the same rule as the page itself. When
 * they switch the language on the page, `router.refresh()` (components/providers.tsx) renders it again.
 */
export async function pageMetadata(
  key: MessageKey,
  extra: Metadata = {},
  values?: MessageValues,
): Promise<Metadata> {
  const t = createTranslator(await requestLocale());
  return { title: t(key, values), ...extra };
}
