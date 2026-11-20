import * as SecureStore from 'expo-secure-store';

/**
 * Small per-device flags (not secrets, but the Keychain/Keystore is the one storage the app already
 * has; THIS_DEVICE_ONLY like the session, so a new phone starts fresh).
 */
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export type Flag = 'onboarded' | 'lockEnabled' | 'setupDismissed' | 'pushAsked';
const KEY: Record<Flag, string> = {
  onboarded: 'ps.onboarded',
  lockEnabled: 'ps.lock',
  setupDismissed: 'ps.setupDismissed',
  pushAsked: 'ps.pushAsked',
};

const cache = new Map<Flag, boolean>();

export async function getFlag(flag: Flag): Promise<boolean> {
  const hit = cache.get(flag);
  if (hit !== undefined) return hit;
  const v = (await SecureStore.getItemAsync(KEY[flag], OPTS).catch(() => null)) === '1';
  cache.set(flag, v);
  return v;
}

export async function setFlag(flag: Flag, on: boolean): Promise<void> {
  cache.set(flag, on);
  if (on) await SecureStore.setItemAsync(KEY[flag], '1', OPTS).catch(() => undefined);
  else await SecureStore.deleteItemAsync(KEY[flag], OPTS).catch(() => undefined);
}

/** Sign-out: the next account on this phone starts without the previous one's choices. */
export async function clearAccountFlags(): Promise<void> {
  await Promise.all(
    (['lockEnabled', 'setupDismissed', 'pushAsked'] as const).map((f) => setFlag(f, false)),
  );
}
