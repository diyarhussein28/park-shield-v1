import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRINT_TOPIC } from '../orders/orders.service';
import { STORE_BILLING, type StoreSubscriber } from '../providers/ports';
import { type FakeStore, parseSubscriber, RevenueCatStore } from '../providers/revenuecat';
import {
  completeProfile,
  createHarness,
  linkSmsDirect,
  mailbox,
  resetState,
  signIn,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { RefundsService } from './refunds.service';
import {
  DEV_WEBHOOK_AUTH,
  STORE_SYNC_TOPIC,
  StoreSyncService,
  storeStatus,
} from './store-sync.service';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
// RevenueCat reports the same original purchase date for every event of one purchase.
let purchasedAt = new Date();
beforeEach(async () => {
  purchasedAt = new Date(Date.now() - 60_000);
  await resetState(h);
});

const DAY = 86_400_000;
const store = () => h.app.get<FakeStore>(STORE_BILLING);
const sync = () => h.app.get(StoreSyncService);

async function appUser(email: string): Promise<{ s: Session; userId: string }> {
  const s = await signIn(h, email);
  await completeProfile(h, s);
  await linkSmsDirect(h, email);
  const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { cookie: s.cookie } });
  return { s, userId: me.json().id };
}

const subscriber = (userId: string, over: Partial<StoreSubscriber> = {}): StoreSubscriber => {
  const start = purchasedAt;
  return {
    appUserId: userId,
    store: 'app_store',
    productId: 'parkshield_yearly',
    transactionId: '2000000123456789',
    originalPurchaseAt: start,
    periodStart: start,
    periodEnd: new Date(start.getTime() + 365 * DAY),
    willRenew: true,
    billingIssueAt: null,
    refundedAt: null,
    managementUrl: 'https://apps.apple.com/account/subscriptions',
    sandbox: true,
    priceCents: 1999,
    ...over,
  };
};

const prepare = (s: Session) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/billing/store/prepare',
    headers: s.headers,
    payload: { platform: 'ios', immediateStartVersion: 1, termsVersion: 1 },
  });

const summary = async (s: Session) =>
  (
    await h.app.inject({
      method: 'GET',
      url: '/v1/billing/subscription',
      headers: { cookie: s.cookie },
    })
  ).json().subscription;

const webhook = (event: Record<string, unknown>, auth = DEV_WEBHOOK_AUTH) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/webhooks/revenuecat',
    headers: { authorization: auth },
    payload: { api_version: '1.0', event },
  });

describe('in-app subscription through RevenueCat (Part A)', () => {
  it('buy in the app → one record, web shows it active, no second checkout anywhere', async () => {
    const { s, userId } = await appUser('app@example.de');
    expect((await prepare(s)).json()).toEqual({ appUserId: userId });
    await store().set(userId, subscriber(userId));
    const r = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/store/sync',
      headers: s.headers,
    });
    expect(r.json()).toEqual({ status: 'active' });

    const sub = await summary(s);
    expect(sub).toMatchObject({
      provider: 'app_store',
      unifiedStatus: 'ACTIVE',
      willRenew: true,
      managementUrl: 'https://apps.apple.com/account/subscriptions',
      stickerValueCents: 300,
      refundRoute: 'apple',
      contractNo: expect.stringMatching(/^PS-/),
    });
    const row = await h.db
      .selectFrom('subscriptions')
      .select(['immediate_start_consent_id', 'withdrawal_notice_version', 'sticker_value_cents'])
      .executeTakeFirstOrThrow();
    expect(row.immediate_start_consent_id).not.toBeNull();
    expect(row.withdrawal_notice_version).toBeTruthy();

    // Web checkout and a second store purchase are refused (A4: no double subscription).
    const web = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: s.headers,
      payload: {
        plan: 'standard',
        immediateStart: true,
        immediateStartVersion: 1,
        termsVersion: 1,
      },
    });
    expect(web.json()).toMatchObject({ error: 'already_subscribed' });
    expect((await prepare(s)).json()).toMatchObject({ error: 'already_subscribed' });

    // Contract confirmation (store wording) and payment@ exactly once, also after more syncs.
    await sync().sync(userId);
    await sync().sync(userId, { eventId: 'evt-initial', type: 'INITIAL_PURCHASE' });
    const contract = (await mailbox(h)).filter((m) => m.tag === 'contract_confirmation');
    expect(contract).toHaveLength(1);
    expect(contract[0]!.text).toContain('Gekauft über App Store');
    expect(contract[0]!.text).toContain('keine Rechnung');
    expect(contract[0]!.text).toContain('Im Preis enthalten: personalisierter Aufkleber');
    // The price the store charged (19,99 €), not the web price (20,00 €).
    expect(contract[0]!.text).toContain('19,99');
    expect(contract[0]!.text).not.toContain('20,00');
    const notes = await h.db
      .selectFrom('payment_notifications')
      .select(['kind', 'payment_ref', 'amount_cents'])
      .execute();
    expect(notes).toEqual([
      { kind: 'subscription', payment_ref: '2000000123456789', amount_cents: 1999 },
    ]);

    // Store subscribers: no Stripe refund logic.
    const id = (await h.db.selectFrom('subscriptions').select('id').executeTakeFirstOrThrow()).id;
    await expect(
      h.app.get(RefundsService).quote({ kind: 'withdrawal', subscriptionId: id }),
    ).rejects.toMatchObject({ response: { error: 'store_subscription' } });
  });

  it('buy on the web → the app sees it and offers no purchase', async () => {
    const s = await subscribe(h, 'web@example.de');
    expect(await summary(s)).toMatchObject({
      provider: 'stripe',
      unifiedStatus: 'ACTIVE',
      refundRoute: null,
    });
    expect((await prepare(s)).json()).toMatchObject({ error: 'already_subscribed' });
    expect((await mailbox(h)).filter((m) => m.tag === 'contract_confirmation')).toHaveLength(1);
  });

  it('restore purchases on a new phone: sync finds the existing purchase', async () => {
    const { s, userId } = await appUser('restore@example.de');
    await store().set(userId, subscriber(userId));
    await sync().sync(userId);
    // New phone: same account, the app calls sync after restorePurchases.
    const r = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/store/sync',
      headers: s.headers,
    });
    expect(r.json()).toEqual({ status: 'active' });
    expect(await h.db.selectFrom('subscriptions').select('id').execute()).toHaveLength(1);
  });

  it('webhook: checks the secret, stores each event once, replays are ignored', async () => {
    const { userId } = await appUser('hook@example.de');
    expect(
      (await webhook({ id: 'e1', type: 'INITIAL_PURCHASE', app_user_id: userId }, 'wrong'))
        .statusCode,
    ).toBe(401);
    expect(
      (await webhook({ id: 'e1', type: 'INITIAL_PURCHASE', app_user_id: userId })).statusCode,
    ).toBe(200);
    expect(
      (await webhook({ id: 'e1', type: 'INITIAL_PURCHASE', app_user_id: userId })).statusCode,
    ).toBe(200);
    // Anonymous or unknown ids are never linked to an account.
    await webhook({ id: 'e2', type: 'INITIAL_PURCHASE', app_user_id: '$RCAnonymousID:abc' });
    const events = await h.db
      .selectFrom('outbox_events')
      .select('payload')
      .where('topic', '=', STORE_SYNC_TOPIC)
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      userId,
      hint: { eventId: 'e1', type: 'INITIAL_PURCHASE' },
    });
    expect(
      await h.db
        .selectFrom('billing_webhook_events')
        .select('event_id')
        .orderBy('event_id')
        .execute(),
    ).toEqual([{ event_id: 'e1' }, { event_id: 'e2' }]);
  });

  it('events: billing issue, cancellation, uncancellation, renewal, expiration', async () => {
    const { s, userId } = await appUser('life@example.de');
    await store().set(userId, subscriber(userId));
    await sync().sync(userId, {
      eventId: 'i1',
      type: 'INITIAL_PURCHASE',
      originalTransactionId: 'otx-1',
    });

    await store().set(userId, subscriber(userId, { billingIssueAt: new Date() }));
    await sync().sync(userId, { eventId: 'b1', type: 'BILLING_ISSUE' });
    expect((await summary(s)).unifiedStatus).toBe('BILLING_ISSUE');

    await store().set(userId, subscriber(userId, { willRenew: false }));
    await sync().sync(userId, { eventId: 'c1', type: 'CANCELLATION', cancelReason: 'UNSUBSCRIBE' });
    expect((await summary(s)).unifiedStatus).toBe('CANCEL_SCHEDULED');

    await store().set(userId, subscriber(userId));
    await sync().sync(userId, { eventId: 'u1', type: 'UNCANCELLATION' });
    expect((await summary(s)).unifiedStatus).toBe('ACTIVE');

    const sub0 = subscriber(userId);
    const renewed = subscriber(userId, {
      periodStart: sub0.periodEnd,
      periodEnd: new Date(sub0.periodEnd.getTime() + 365 * DAY),
      transactionId: 'tx-renew',
    });
    await store().set(userId, renewed);
    await sync().sync(userId, { eventId: 'r1', type: 'RENEWAL', originalTransactionId: 'otx-1' });
    await sync().sync(userId, { eventId: 'r1', type: 'RENEWAL', originalTransactionId: 'otx-1' });
    const notes = await h.db
      .selectFrom('payment_notifications')
      .select('kind')
      .orderBy('kind')
      .execute();
    expect(notes.map((n) => n.kind)).toEqual(['renewal', 'subscription']);
    expect((await mailbox(h)).filter((m) => m.tag === 'contract_confirmation')).toHaveLength(1);

    await store().set(
      userId,
      subscriber(userId, { periodEnd: new Date(Date.now() - 1000), willRenew: false }),
    );
    await sync().sync(userId, { eventId: 'x1', type: 'EXPIRATION' });
    const row = await h.db.selectFrom('subscriptions').select(['status']).executeTakeFirstOrThrow();
    expect(row.status).toBe('expired');
    expect(await summary(s)).toBeNull();
  });

  it('a store refund before personalisation cancels the fulfillment order', async () => {
    const { s, userId } = await appUser('refund@example.de');
    await store().set(userId, subscriber(userId));
    await sync().sync(userId);
    const v = (
      await h.app.inject({
        method: 'POST',
        url: '/v1/vehicles',
        headers: s.headers,
        payload: { nickname: 'Dodo', plate: 'K-AB 12' },
      })
    ).json();
    // An old-style order (queued before this change, no personalized_at) waits for printing.
    await sql`INSERT INTO decal_orders (user_id, status, shipping_address_enc, total_gross_cents)
              VALUES (${userId}, 'paid', '\\x00', 0)`.execute(h.db);
    await store().set(userId, subscriber(userId, { refundedAt: new Date() }));
    await sync().sync(userId, {
      eventId: 'rf',
      type: 'CANCELLATION',
      cancelReason: 'CUSTOMER_SUPPORT',
    });
    const sub = await h.db
      .selectFrom('subscriptions')
      .select(['status', 'refunded_at'])
      .executeTakeFirstOrThrow();
    expect(sub.status).toBe('expired');
    expect(sub.refunded_at).not.toBeNull();
    const orders = await h.db
      .selectFrom('decal_orders')
      .select(['status', 'canceled_at'])
      .execute();
    expect(orders).toEqual([{ status: 'canceled', canceled_at: expect.any(Date) }]);
    expect(v.id).toBeTruthy();
  });
});

describe('RevenueCat adapter', () => {
  const body = {
    subscriber: {
      management_url: 'https://apps.apple.com/account/subscriptions',
      entitlements: {
        parkshield: {
          product_identifier: 'parkshield_yearly',
          expires_date: '2028-01-01T00:00:00Z',
        },
      },
      subscriptions: {
        parkshield_yearly: {
          expires_date: '2028-01-01T00:00:00Z',
          purchase_date: '2027-01-01T00:00:00Z',
          original_purchase_date: '2027-01-01T00:00:00Z',
          store: 'PLAY_STORE',
          is_sandbox: false,
          unsubscribe_detected_at: null,
          billing_issues_detected_at: null,
          refunded_at: null,
          store_transaction_id: 'GPA.1234',
          price: { amount: 19.99, currency: 'EUR' },
        },
      },
    },
  };

  it('maps the subscriber to our record', () => {
    expect(parseSubscriber('u1', body, 'parkshield')).toMatchObject({
      store: 'play_store',
      transactionId: 'GPA.1234',
      priceCents: 1999,
      willRenew: true,
      periodEnd: new Date('2028-01-01T00:00:00Z'),
    });
    expect(parseSubscriber('u1', body, 'other')).toBeNull();
    // The REST API reports the store in lower case (webhooks in upper case).
    const lower = {
      subscriber: {
        ...body.subscriber,
        subscriptions: {
          parkshield_yearly: {
            ...body.subscriber.subscriptions.parkshield_yearly,
            store: 'app_store',
          },
        },
      },
    };
    expect(parseSubscriber('u1', lower, 'parkshield')?.store).toBe('app_store');
    // RevenueCat's Test Store counts only on test environments.
    const test = {
      subscriber: {
        ...body.subscriber,
        subscriptions: {
          parkshield_yearly: {
            ...body.subscriber.subscriptions.parkshield_yearly,
            store: 'TEST_STORE',
          },
        },
      },
    };
    expect(parseSubscriber('u1', test, 'parkshield')).toBeNull();
    expect(parseSubscriber('u1', test, 'parkshield', true)?.store).toBe('app_store');
  });

  it('sends RevenueCat only the user UUID: no e-mail, no attributes, no advertising id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await new RevenueCatStore('sk_test', 'parkshield').getSubscriber(
        '7b6f0d5e-0000-4000-8000-000000000001',
      );
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        'https://api.revenuecat.com/v1/subscribers/7b6f0d5e-0000-4000-8000-000000000001',
      );
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.body).toBeUndefined();
      expect(JSON.stringify(init.headers)).not.toMatch(/@|idfa|email/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refund reason and expiry decide the status', () => {
    const s = parseSubscriber('u1', body, 'parkshield')!;
    const now = new Date('2027-06-01T00:00:00Z');
    expect(storeStatus(s, undefined, now)).toEqual({ status: 'active', refunded: false });
    expect(storeStatus(s, { type: 'CANCELLATION', cancelReason: 'CUSTOMER_SUPPORT' }, now)).toEqual(
      { status: 'expired', refunded: true },
    );
    expect(storeStatus(s, undefined, new Date('2028-02-01T00:00:00Z')).status).toBe('expired');
  });
});

describe('personalised sticker (Part B)', () => {
  const address = {
    name: 'Jonas Beispiel',
    line1: 'Domstraße 1',
    postalCode: '50667',
    city: 'Köln',
    country: 'DE',
  };

  async function vehicle(s: Session, nickname = 'Dodo') {
    return (
      await h.app.inject({
        method: 'POST',
        url: '/v1/vehicles',
        headers: s.headers,
        payload: { nickname, plate: 'K-DO 1' },
      })
    ).json();
  }

  it('nothing reaches the print queue without the confirmation; the snapshot is frozen', async () => {
    const s = await subscribe(h, 'sticker@example.de');
    const v = await vehicle(s);
    const options = (
      await h.app.inject({
        method: 'GET',
        url: `/v1/vehicles/${v.id}/print-options`,
        headers: { cookie: s.cookie },
      })
    ).json();
    expect(options.personalization).toEqual({
      label: 'Dodo',
      labelValid: true,
      template: 'classic',
      cta: expect.any(String),
    });
    expect(options.addressPrefill).toMatchObject({ country: 'DE' });

    const unconfirmed = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/order-print`,
      headers: s.headers,
      payload: { address },
    });
    expect(unconfirmed.statusCode).toBe(400);
    const prints = () =>
      h.db.selectFrom('outbox_events').select('id').where('topic', '=', PRINT_TOPIC).execute();
    expect(await prints()).toHaveLength(0);

    const ok = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/order-print`,
      headers: s.headers,
      payload: { address, personalizationConfirmed: true },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await prints()).toHaveLength(1);
    const order = await h.db
      .selectFrom('decal_orders')
      .select(['personalized_at', 'design_snapshot'])
      .executeTakeFirstOrThrow();
    expect(order.personalized_at).not.toBeNull();
    expect(order.design_snapshot).toMatchObject({ template: 'classic', label: 'Dodo' });

    // A later design change does not touch the confirmed order.
    await h.app.inject({
      method: 'PUT',
      url: `/v1/vehicles/${v.id}/design`,
      headers: s.headers,
      payload: { template: 'night', cta: 'Bitte anrufen' },
    });
    const again = await h.db
      .selectFrom('decal_orders')
      .select('design_snapshot')
      .executeTakeFirstOrThrow();
    expect(again.design_snapshot).toMatchObject({ template: 'classic' });
  });

  it('an invalid label blocks the order (422)', async () => {
    const s = await subscribe(h, 'label@example.de');
    const v = await vehicle(s);
    await sql`UPDATE vehicles SET nickname = 'Ein sehr sehr langer Fahrzeugname'`.execute(h.db);
    const r = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/order-print`,
      headers: s.headers,
      payload: { address, personalizationConfirmed: true },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: 'label_invalid' });
  });

  it('withdrawal after personalisation keeps 3 € + used days; before: no deduction', async () => {
    const s = await subscribe(h, 'wd@example.de');
    const v = await vehicle(s);
    await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/order-print`,
      headers: s.headers,
      payload: { address, personalizationConfirmed: true },
    });
    const sub = await h.db
      .selectFrom('subscriptions')
      .select(['id', 'sticker_value_cents'])
      .executeTakeFirstOrThrow();
    expect(sub.sticker_value_cents).toBe(300);
    const q = await h.app
      .get(RefundsService)
      .quote(
        { kind: 'withdrawal', subscriptionId: sub.id },
        new Date(Date.now() + 10 * DAY + 3600_000),
      );
    expect(q).toMatchObject({
      paidCents: 2000,
      decalCostCents: 300,
      daysUsed: 10,
      wertersatzCents: 47,
      refundCents: 1653,
    });

    // Old contract style: no personalised order → no sticker deduction.
    await sql`UPDATE decal_orders SET personalized_at = NULL`.execute(h.db);
    const q2 = await h.app
      .get(RefundsService)
      .quote(
        { kind: 'withdrawal', subscriptionId: sub.id },
        new Date(Date.now() + 10 * DAY + 3600_000),
      );
    expect(q2.decalCostCents).toBe(0);
  });
});
