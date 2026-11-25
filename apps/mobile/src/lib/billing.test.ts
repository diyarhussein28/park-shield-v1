import {
  REFUND_ROUTE_URL,
  isStoreProvider,
  labelProblem,
  refundRouteUrl,
  showWelcomePrintCta,
  storeBillingAvailable,
  storeErrorKey,
  storeManageUrl,
} from './billing';

describe('unified billing helpers', () => {
  it('uses the store only with a key and outside Expo Go', () => {
    expect(storeBillingAvailable({ apiKey: 'appl_x', executionEnvironment: 'standalone' })).toBe(
      true,
    );
    expect(storeBillingAvailable({ apiKey: 'appl_x', executionEnvironment: 'bare' })).toBe(true);
    expect(storeBillingAvailable({ apiKey: 'appl_x', executionEnvironment: 'storeClient' })).toBe(
      false,
    );
    expect(storeBillingAvailable({ apiKey: '', executionEnvironment: 'standalone' })).toBe(false);
    expect(storeBillingAvailable({ apiKey: undefined, executionEnvironment: 'bare' })).toBe(false);
  });

  it('knows store providers', () => {
    expect(isStoreProvider('app_store')).toBe(true);
    expect(isStoreProvider('play_store')).toBe(true);
    expect(isStoreProvider('stripe')).toBe(false);
    expect(isStoreProvider(undefined)).toBe(false);
  });

  it('leads store subscribers to the store refund route, Stripe subscribers nowhere', () => {
    expect(refundRouteUrl({ provider: 'app_store', refundRoute: 'apple' })).toBe(
      'https://reportaproblem.apple.com',
    );
    expect(refundRouteUrl({ provider: 'play_store', refundRoute: null })).toBe(
      REFUND_ROUTE_URL.google,
    );
    expect(refundRouteUrl({ provider: 'stripe', refundRoute: null })).toBeNull();
  });

  it('opens RevenueCat management_url, else the store fallback', () => {
    expect(storeManageUrl({ provider: 'app_store', managementUrl: 'https://x.test/manage' })).toBe(
      'https://x.test/manage',
    );
    expect(storeManageUrl({ provider: 'app_store', managementUrl: null })).toBe(
      'https://apps.apple.com/account/subscriptions',
    );
    expect(storeManageUrl({ provider: 'play_store' })).toBe(
      'https://play.google.com/store/account/subscriptions',
    );
    expect(storeManageUrl({ provider: 'stripe', managementUrl: 'https://x' })).toBeNull();
  });

  it('validates the vehicle label printed on the decal', () => {
    expect(labelProblem('Dodo')).toBeNull();
    expect(labelProblem('Mein Auto 2')).toBeNull();
    expect(labelProblem('Ölwechsel-Opa!')).toBeNull();
    expect(labelProblem('   ')).toBe('required');
    expect(labelProblem('A')).toBe('length');
    expect(labelProblem('A'.repeat(21))).toBe('length');
    expect(labelProblem('A'.repeat(20))).toBeNull();
    expect(labelProblem('Dodo <3')).toBe('chars');
    expect(labelProblem('Car 🚗')).toBe('chars');
  });

  it('shows the welcome print call to action only while it is free and a code exists', () => {
    expect(showWelcomePrintCta({ includedAvailable: true, hasDecal: true })).toBe(true);
    expect(showWelcomePrintCta({ includedAvailable: true, hasDecal: false })).toBe(false);
    expect(showWelcomePrintCta({ includedAvailable: false, hasDecal: true })).toBe(false);
    expect(showWelcomePrintCta({ includedAvailable: undefined, hasDecal: true })).toBe(false);
  });
});

describe('store purchase errors (2026-11-25)', () => {
  it('maps RevenueCat codes to a clear text, everything else to the generic one', () => {
    // Google Play „The item you were attempting to purchase could not be found“.
    expect(storeErrorKey({ code: '5' })).toBe('storeErrNotAvailable');
    expect(storeErrorKey({ code: '6' })).toBe('storeErrAlreadyOwned');
    expect(storeErrorKey({ code: '7' })).toBe('storeErrOtherAccount');
    expect(storeErrorKey({ code: '13' })).toBe('storeErrOtherAccount');
    expect(storeErrorKey({ code: '20' })).toBe('storeErrPending');
    expect(storeErrorKey({ code: '3' })).toBe('storeErrNotAllowed');
    expect(storeErrorKey({ code: '10' })).toBe('storeUnavailable');
    expect(storeErrorKey({ code: '0' })).toBeNull();
    expect(storeErrorKey(new Error('x'))).toBeNull();
    expect(storeErrorKey(null)).toBeNull();
  });
});
