import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { storeBillingAvailable } from './billing';

/**
 * App Store / Google Play subscription through RevenueCat (docs/billing-unified.md, A1/A2).
 *
 * - app_user_id is our own user UUID: the SDK is configured with it (never an anonymous id), and
 *   `logIn` switches it after a sign-in; sign-out calls `logOut`.
 * - Nothing else goes to RevenueCat: no e-mail, no name, no attributes, no advertising identifiers
 *   (no `setAttributes`, no `collectDeviceIdentifiers`, no AdSupport).
 * - Only the public SDK keys are in the app (EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY).
 */
const API_KEY: string | undefined =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

/** The entitlement and offering set up in RevenueCat. */
export const ENTITLEMENT_ID = 'parkshield_pro';

export const isStoreBillingAvailable = () =>
  storeBillingAvailable({
    apiKey: API_KEY,
    executionEnvironment: Constants.executionEnvironment ?? null,
  });

let configuredFor: string | null = null;
let pending: Promise<void> = Promise.resolve();

/** Signs the store SDK in as this user (configures it the first time). Safe to call repeatedly. */
export function loginPurchases(userId: string): Promise<void> {
  if (!isStoreBillingAvailable() || !userId) return Promise.resolve();
  pending = pending
    .catch(() => undefined)
    .then(async () => {
      if (configuredFor === userId) return;
      if (configuredFor === null) {
        Purchases.configure({ apiKey: API_KEY!, appUserID: userId });
      } else {
        await Purchases.logIn(userId);
      }
      configuredFor = userId;
    });
  return pending;
}

/** Sign-out: the store SDK forgets the user (errors are ignored). */
export async function logoutPurchases(): Promise<void> {
  if (configuredFor === null) return;
  try {
    await Purchases.logOut();
  } catch {
    // e.g. already anonymous: nothing to do
  }
  configuredFor = null;
}

/** The yearly package of the current offering, or null when the store has none (yet). */
export async function yearlyPackage(): Promise<PurchasesPackage | null> {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  return current?.annual ?? current?.availablePackages[0] ?? null;
}

export type StorePurchaseResult = 'purchased' | 'canceled';

/** Opens the store purchase sheet; only for the signed-in user (never anonymous). */
export async function purchaseYearly(
  pkg: PurchasesPackage,
  userId: string,
): Promise<StorePurchaseResult> {
  await loginPurchases(userId);
  if (configuredFor !== userId) throw new Error('store_not_signed_in');
  try {
    await Purchases.purchasePackage(pkg);
    return 'purchased';
  } catch (err) {
    const e = err as { userCancelled?: boolean | null; code?: string };
    if (e.userCancelled || e.code === Purchases.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR)
      return 'canceled';
    throw err;
  }
}

/** „Käufe wiederherstellen“: the store re-sends the purchases of this Apple ID / Google account. */
export async function restoreStorePurchases(userId: string): Promise<void> {
  await loginPurchases(userId);
  await Purchases.restorePurchases();
}
