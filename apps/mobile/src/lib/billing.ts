/**
 * Unified billing helpers (docs/billing-unified.md, 2026-11-22): pure functions only, so they are
 * tested without native modules. The subscription can come from the App Store or Google Play (through
 * RevenueCat) or from the website (Stripe); the API's summary says which (`provider`).
 */

export type BillingProvider = 'stripe' | 'app_store' | 'play_store';
export type RefundRoute = 'apple' | 'google';

/** The sticker value included in the yearly price (display default; the server setting is the truth). */
export const STICKER_VALUE_CENTS = 300;

/** Apple and Google are the seller of a store subscription: cancel and refund happen there. */
export const isStoreProvider = (
  p: BillingProvider | null | undefined,
): p is 'app_store' | 'play_store' => p === 'app_store' || p === 'play_store';

/** Store subscription management when RevenueCat gave us no `management_url`. */
export const STORE_MANAGE_FALLBACK: Record<'app_store' | 'play_store', string> = {
  app_store: 'https://apps.apple.com/account/subscriptions',
  play_store: 'https://play.google.com/store/account/subscriptions',
};

/** The official refund routes (A6): Apple „Problem melden“, Google Play order history. */
export const REFUND_ROUTE_URL: Record<RefundRoute, string> = {
  apple: 'https://reportaproblem.apple.com',
  google: 'https://play.google.com/store/account/orderhistory',
};

/** Where „Vertrag hier kündigen“ leads a store subscriber. */
export function storeManageUrl(sub: {
  provider?: BillingProvider | null;
  managementUrl?: string | null;
}): string | null {
  if (!isStoreProvider(sub.provider)) return null;
  return sub.managementUrl || STORE_MANAGE_FALLBACK[sub.provider];
}

/** Where „Vertrag widerrufen“ leads a store subscriber (refundRoute, else derived from the provider). */
export function refundRouteUrl(sub: {
  provider?: BillingProvider | null;
  refundRoute?: RefundRoute | null;
}): string | null {
  const route: RefundRoute | null =
    sub.refundRoute ??
    (sub.provider === 'app_store' ? 'apple' : sub.provider === 'play_store' ? 'google' : null);
  return route ? REFUND_ROUTE_URL[route] : null;
}

/**
 * Whether the store purchase (Apple/Google through RevenueCat) is used: a public SDK key for this
 * platform and a real build. Expo Go (`storeClient`) has no store billing; there the Stripe checkout
 * stays as a test-only fallback.
 */
export function storeBillingAvailable(input: {
  apiKey: string | null | undefined;
  executionEnvironment: string | null | undefined;
}): boolean {
  return Boolean(input.apiKey?.trim()) && input.executionEnvironment !== 'storeClient';
}

/**
 * The vehicle label printed on the decal (B1): required, 2–20 characters, letters, numbers, spaces and
 * basic punctuation. The bad-word filter runs on the server (`label_invalid`).
 */
export type LabelProblem = 'required' | 'length' | 'chars';
const LABEL_CHARS = /^[\p{L}\p{N} .,'’&!?()+\-/]+$/u;
export function labelProblem(label: string): LabelProblem | null {
  const v = label.trim();
  if (!v) return 'required';
  if ([...v].length < 2 || [...v].length > 20) return 'length';
  if (!LABEL_CHARS.test(v)) return 'chars';
  return null;
}

/** The welcome print call to action on Start and Fahrzeuge: still free, and a code to print exists. */
export function showWelcomePrintCta(input: {
  includedAvailable: boolean | null | undefined;
  hasDecal: boolean;
}): boolean {
  return Boolean(input.includedAvailable) && input.hasDecal;
}
