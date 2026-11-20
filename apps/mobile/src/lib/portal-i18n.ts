import './intl-polyfill';
import {
  createTranslator,
  type Locale,
  type MessageKey,
  type MessageValues,
} from '@parkshield/i18n';
import { lang } from './i18n';

/**
 * The customer portal's own texts (packages/i18n, the same bundle the website uses), so every portal
 * screen in the app reads exactly like the website. App-only texts stay in ./i18n.
 */
const translators = new Map<Locale, ReturnType<typeof createTranslator>>();

export function pt(key: MessageKey, values?: MessageValues): string {
  const l = lang() as Locale;
  let tr = translators.get(l);
  if (!tr) {
    tr = createTranslator(l);
    translators.set(l, tr);
  }
  return tr(key, values);
}

export type { MessageKey };
