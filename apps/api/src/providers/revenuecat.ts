import type { Redis } from 'ioredis';
import type { StoreBilling, StoreProvider, StoreSubscriber } from './ports';

interface RcSubscription {
  expires_date: string | null;
  purchase_date: string;
  original_purchase_date: string;
  store: string;
  is_sandbox: boolean;
  unsubscribe_detected_at: string | null;
  billing_issues_detected_at: string | null;
  refunded_at?: string | null;
  store_transaction_id?: string | null;
}

interface RcSubscriberResponse {
  subscriber: {
    entitlements: Record<string, { product_identifier: string; expires_date: string | null }>;
    subscriptions: Record<string, RcSubscription>;
    management_url: string | null;
  };
}

const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

/** RevenueCat `store` → our provider; Stripe/Amazon/promotional purchases are not store purchases. */
export function storeProvider(
  store: string | null | undefined,
  allowTestStore = false,
): StoreProvider | null {
  // Webhooks say `APP_STORE`, the REST API v1 says `app_store`: compare case-insensitively.
  const s = (store ?? '').toUpperCase();
  if (s === 'APP_STORE' || s === 'MAC_APP_STORE') return 'app_store';
  if (s === 'PLAY_STORE') return 'play_store';
  // RevenueCat's Test Store (sandbox without App Store Connect): only on test environments.
  if (allowTestStore && s === 'TEST_STORE') return 'app_store';
  return null;
}

/** Maps the v1 subscriber object to the ParkShield entitlement (pure, unit-tested). */
export function parseSubscriber(
  appUserId: string,
  body: RcSubscriberResponse,
  entitlementId: string,
  allowTestStore = false,
): StoreSubscriber | null {
  const ent = body.subscriber.entitlements[entitlementId];
  if (!ent) return null;
  const sub = body.subscriber.subscriptions[ent.product_identifier];
  if (!sub) return null;
  const store = storeProvider(sub.store, allowTestStore);
  if (!store) return null;
  return {
    appUserId,
    store,
    productId: ent.product_identifier,
    transactionId: sub.store_transaction_id ?? null,
    originalPurchaseAt: new Date(sub.original_purchase_date),
    periodStart: new Date(sub.purchase_date),
    periodEnd: toDate(sub.expires_date ?? ent.expires_date) ?? new Date(sub.purchase_date),
    willRenew: !sub.unsubscribe_detected_at,
    billingIssueAt: toDate(sub.billing_issues_detected_at),
    refundedAt: toDate(sub.refunded_at),
    managementUrl: body.subscriber.management_url,
    sandbox: sub.is_sandbox,
  };
}

/**
 * RevenueCat REST API v1. Only the app user id (our user UUID) goes out; RevenueCat gets no e-mail,
 * name or other attributes from us (docs/billing-unified.md, LEGAL_REVIEW.md §12).
 */
export class RevenueCatStore implements StoreBilling {
  constructor(
    private readonly secretKey: string,
    private readonly entitlementId: string,
    private readonly allowTestStore = false,
  ) {}

  async getSubscriber(appUserId: string): Promise<StoreSubscriber | null> {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: { Authorization: `Bearer ${this.secretKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RevenueCat ${res.status}`);
    return parseSubscriber(
      appUserId,
      (await res.json()) as RcSubscriberResponse,
      this.entitlementId,
      this.allowTestStore,
    );
  }
}

const fakeKey = (appUserId: string) => `dev:store:${appUserId}`;

/**
 * Local stand-in while REVENUECAT_SECRET_KEY is empty: subscribers live in Valkey (shared by API and
 * worker), set by tests through `set()`.
 */
export class FakeStore implements StoreBilling {
  constructor(private readonly valkey: Redis) {}

  async set(appUserId: string, subscriber: StoreSubscriber | null): Promise<void> {
    if (!subscriber) await this.valkey.del(fakeKey(appUserId));
    else await this.valkey.set(fakeKey(appUserId), JSON.stringify(subscriber), 'EX', 86_400);
  }

  async getSubscriber(appUserId: string): Promise<StoreSubscriber | null> {
    const raw = await this.valkey.get(fakeKey(appUserId));
    if (!raw) return null;
    const s = JSON.parse(raw) as Record<string, unknown>;
    const d = (k: string) => (s[k] ? new Date(String(s[k])) : null);
    return {
      ...(s as unknown as StoreSubscriber),
      originalPurchaseAt: d('originalPurchaseAt')!,
      periodStart: d('periodStart')!,
      periodEnd: d('periodEnd')!,
      billingIssueAt: d('billingIssueAt'),
      refundedAt: d('refundedAt'),
    };
  }
}
