import * as SecureStore from 'expo-secure-store';

const KEY = 'ps.session';
const DEVICE_KEY = 'ps.fcmToken';

/**
 * The session token lives only in the iOS Keychain / Android Keystore (expo-secure-store), never in
 * plain storage. THIS_DEVICE_ONLY: it is not part of a backup and never moves to another phone.
 */
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let cached: string | null | undefined;

export async function getSession(): Promise<string | null> {
  if (cached !== undefined) return cached;
  cached = await SecureStore.getItemAsync(KEY, OPTS);
  return cached;
}

export async function setSession(token: string): Promise<void> {
  cached = token;
  await SecureStore.setItemAsync(KEY, token, OPTS);
}

export async function clearSession(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(KEY, OPTS);
}

/** The FCM token registered for this install (needed to unregister on sign-out). */
export const getDeviceToken = () => SecureStore.getItemAsync(DEVICE_KEY, OPTS);
export const setDeviceToken = (t: string) => SecureStore.setItemAsync(DEVICE_KEY, t, OPTS);
export const clearDeviceToken = () => SecureStore.deleteItemAsync(DEVICE_KEY, OPTS);
