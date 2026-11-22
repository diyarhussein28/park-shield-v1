import * as SecureStore from 'expo-secure-store';
import { api } from './api';
import { DEFAULT_LANG, setLang, type Lang } from './i18n';

/**
 * The app language on this device (2026-11-22): German on a fresh install, before sign-in and without
 * asking; the owner can switch to English under „Konto“. The choice is a non-personal device setting:
 * it is the one thing kept on sign-out (the account keeps its own copy as `preferredLang`).
 */
const KEY = 'ps.lang';
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const isLang = (v: unknown): v is Lang => v === 'de' || v === 'en';

/** At start, before the first screen: the saved choice, else German. */
export async function loadLang(): Promise<Lang> {
  const saved = await SecureStore.getItemAsync(KEY, OPTS).catch(() => null);
  const l = isLang(saved) ? saved : DEFAULT_LANG;
  setLang(l);
  return l;
}

/** Switches the app at once and remembers the choice on this device. */
export async function saveLang(l: Lang): Promise<void> {
  setLang(l);
  await SecureStore.setItemAsync(KEY, l, OPTS).catch(() => undefined);
}

/**
 * „Sprache“ in Konto: saved in the account (e-mails, notifications) and on this device, then the
 * whole app switches. Offline the account keeps its old value until the next switch.
 */
export async function switchLanguage(l: Lang, signedIn = true): Promise<void> {
  if (signedIn) {
    await api('/v1/me', { method: 'PATCH', body: { preferredLang: l } }).catch(() => undefined);
  }
  await saveLang(l);
}

export const LANG_NAMES: Record<Lang, string> = { de: 'Deutsch', en: 'English' };
