import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  createHarness,
  lastMail,
  mailbox,
  resetState,
  signIn,
  subscribe as subscribeWith,
  type Harness,
  type Session,
} from '../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

async function checkout(s: Session, payload: Record<string, unknown>) {
  return h.app.inject({ method: 'POST', url: '/v1/billing/checkout', headers: s.headers, payload });
}

const subscribe = (email: string, promoCode?: string) => subscribeWith(h, email, promoCode);

describe('plans (US-04)', () => {
  it('lists Plus €10 purchasable, Premium €15 shown but not yet purchasable, Business coming soon', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/plans' });
    expect(res.json()).toEqual([
      {
        code: 'plus',
        name: 'ParkShield Plus',
        availability: 'available',
        priceYearGrossCents: 1000,
        purchasable: true,
      },
      {
        code: 'premium',
        name: 'ParkShield Premium',
        availability: 'available',
        priceYearGrossCents: 1500,
        purchasable: false,
      },
      {
        code: 'business',
        name: 'ParkShield Business',
        availability: 'coming_soon',
        priceYearGrossCents: null,
        purchasable: false,
      },
    ]);
  });
});

describe('annual checkout (US-06)', () => {
  it('requires the express immediate-start request', async () => {
    const s = await signIn(h, 'jonas@example.de');
    expect((await checkout(s, { plan: 'plus' })).statusCode).toBe(400);
    expect((await checkout(s, { plan: 'plus', immediateStart: false })).statusCode).toBe(400);
  });

  it('does not sell Premium before Phase 2', async () => {
    const s = await signIn(h, 'aylin@example.de');
    const res = await checkout(s, { plan: 'premium', immediateStart: true });
    expect(res.json()).toMatchObject({ error: 'plan_unavailable' });
  });

  it('gives no access before payment, then activates with a contract number and welcome mail', async () => {
    const s = await signIn(h, 'jonas@example.de');
    await checkout(s, { plan: 'plus', immediateStart: true });
    const before = await h.app.inject({
      method: 'GET',
      url: '/v1/billing/subscription',
      headers: { cookie: s.cookie },
    });
    expect(before.json()).toEqual({ subscription: null });

    const res = await checkout(s, { plan: 'plus', immediateStart: true });
    const sessionId = new URL(res.json().url).searchParams.get('session')!;
    const amount = await h.app.inject({
      method: 'GET',
      url: `/v1/dev/payments/sessions/${sessionId}`,
    });
    expect(amount.json().amountCents).toBe(1000);
    await h.app.inject({
      method: 'POST',
      url: '/v1/dev/payments/complete',
      payload: { sessionId },
    });

    const after = await h.app.inject({
      method: 'GET',
      url: '/v1/billing/subscription',
      headers: { cookie: s.cookie },
    });
    const sub = after.json().subscription;
    expect(sub).toMatchObject({ plan: 'plus', status: 'active', cancelAtPeriodEnd: false });
    expect(sub.contractNo).toMatch(/^PS-[0-9A-HJKMNP-TV-Z]{8}$/);
    const days = (new Date(sub.currentPeriodEnd).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(365); // annual only

    const row = await h.db
      .selectFrom('subscriptions')
      .select('withdrawal_waiver_at')
      .executeTakeFirstOrThrow();
    expect(row.withdrawal_waiver_at).toBeInstanceOf(Date);
    const welcome = await lastMail(h, 'subscription_started');
    expect(welcome?.text).toContain(sub.contractNo);
    expect(welcome?.text).toContain('Wertersatz');

    expect((await checkout(s, { plan: 'plus', immediateStart: true })).statusCode).toBe(409);
  });

  it('applies billing events exactly once', async () => {
    const s = await signIn(h, 'twice@example.de');
    const res = await checkout(s, { plan: 'plus', immediateStart: true });
    const sessionId = new URL(res.json().url).searchParams.get('session')!;
    await h.app.inject({
      method: 'POST',
      url: '/v1/dev/payments/complete',
      payload: { sessionId },
    });
    const again = await h.app.inject({
      method: 'POST',
      url: '/v1/dev/payments/complete',
      payload: { sessionId },
    });
    expect(again.statusCode).toBe(404);
    expect(await h.db.selectFrom('subscriptions').selectAll().execute()).toHaveLength(1);
    expect((await mailbox(h)).filter((m) => m.tag === 'subscription_started')).toHaveLength(1);
  });

  it('accepts a valid promo code and rejects unknown or exhausted ones', async () => {
    await h.db
      .insertInto('promo_codes')
      .values([
        { code: 'GRUENDER50', kind: 'percent_off', value: 50, price_lock_months: 36 },
        { code: 'VOLL', kind: 'amount_off', value: 200, max_redemptions: 1 },
      ])
      .execute();
    const s = await signIn(h, 'promo@example.de');
    expect(
      (await checkout(s, { plan: 'plus', immediateStart: true, promoCode: 'NOPE' })).json(),
    ).toMatchObject({
      error: 'promo_invalid',
    });
    const res = await checkout(s, { plan: 'plus', immediateStart: true, promoCode: 'gruender50' });
    const sessionId = new URL(res.json().url).searchParams.get('session')!;
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/dev/payments/sessions/${sessionId}` })).json()
        .amountCents,
    ).toBe(500);
    await h.app.inject({
      method: 'POST',
      url: '/v1/dev/payments/complete',
      payload: { sessionId },
    });
    const sub = await h.db
      .selectFrom('subscriptions')
      .select(['price_locked_until', 'promo_code_id'])
      .executeTakeFirstOrThrow();
    expect(sub.promo_code_id).not.toBeNull();
    expect(sub.price_locked_until!.getFullYear()).toBe(new Date().getFullYear() + 3); // founder price guarantee

    await subscribe('first@example.de', 'VOLL');
    const late = await signIn(h, 'second@example.de');
    expect(
      (await checkout(late, { plan: 'plus', immediateStart: true, promoCode: 'VOLL' })).statusCode,
    ).toBe(400);
  });

  it('lists PDF invoices', async () => {
    const s = await subscribe('invoice@example.de');
    const res = await h.app.inject({
      method: 'GET',
      url: '/v1/billing/invoices',
      headers: { cookie: s.cookie },
    });
    const [invoice] = res.json().invoices;
    expect(invoice).toMatchObject({ totalCents: 1000, pdfUrl: expect.stringMatching(/\.pdf$/) });
    const pdf = await h.app.inject({ method: 'GET', url: invoice.pdfUrl });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('cancellation (US-07, §312k BGB)', () => {
  it('cancels to the end of the period from the account and confirms by e-mail', async () => {
    const s = await subscribe('cancel@example.de');
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/cancel',
      headers: s.headers,
    });
    expect(res.statusCode).toBe(200);
    const sub = (
      await h.app.inject({
        method: 'GET',
        url: '/v1/billing/subscription',
        headers: { cookie: s.cookie },
      })
    ).json().subscription;
    expect(sub).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    const mail = await lastMail(h, 'cancel_received');
    expect(mail?.to).toBe('cancel@example.de');
    expect(mail?.text).toContain(sub.contractNo);
  });

  it('works without login by e-mail + contract number, with the same answer either way', async () => {
    await subscribe('nologin@example.de');
    const { contract_no } = await h.db
      .selectFrom('subscriptions')
      .select('contract_no')
      .executeTakeFirstOrThrow();

    const wrong = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/cancel-request',
      payload: {
        email: 'nologin@example.de',
        contractNo: 'PS-WRONG000',
        captcha: DEV_CAPTCHA_SOLUTION,
      },
    });
    const right = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/cancel-request',
      payload: {
        email: 'NoLogin@Example.de',
        contractNo: contract_no!.toLowerCase(),
        captcha: DEV_CAPTCHA_SOLUTION,
      },
    });
    expect(wrong.statusCode).toBe(200);
    expect(right.statusCode).toBe(200);
    expect(Object.keys(wrong.json())).toEqual(Object.keys(right.json()));

    expect((await lastMail(h, 'cancel_not_found'))?.to).toBe('nologin@example.de');
    expect((await lastMail(h, 'cancel_received'))?.text).toContain(contract_no!);
    const sub = await h.db
      .selectFrom('subscriptions')
      .select('cancel_at_period_end')
      .executeTakeFirstOrThrow();
    expect(sub.cancel_at_period_end).toBe(true);
  });

  it('queues extraordinary cancellations with their reason for support', async () => {
    const s = await subscribe('extra@example.de');
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/cancel',
      headers: s.headers,
      payload: { kind: 'extraordinary', reason: 'Auto verkauft, Umzug ins Ausland' },
    });
    expect(res.statusCode).toBe(200);
    const events = await h.db
      .selectFrom('outbox_events')
      .select(['topic', 'payload'])
      .where('topic', '=', 'support.extraordinary_cancellation')
      .execute();
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ reason: 'Auto verkauft, Umzug ins Ausland' });
  });

  it('needs a captcha for cancellation without login', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/cancel-request',
      payload: { email: 'x@example.de', contractNo: 'PS-12345678' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Business waitlist with double opt-in (US-04)', () => {
  it('stores unconfirmed, confirms once via the e-mailed link', async () => {
    const join = await h.app.inject({
      method: 'POST',
      url: '/v1/business-waitlist',
      payload: {
        companyName: 'Malermeister Schulz GmbH',
        email: 'chef@schulz.de',
        fleetSize: 12,
        industry: 'Handwerk',
        captcha: DEV_CAPTCHA_SOLUTION,
      },
    });
    expect(join.statusCode).toBe(202);
    const entry = await h.db.selectFrom('business_waitlist').selectAll().executeTakeFirstOrThrow();
    expect(entry.confirmed_at).toBeNull();

    const token = /#t=([A-Za-z0-9_-]+)/.exec((await lastMail(h, 'waitlist_confirm'))!.text)![1]!;
    const ok = await h.app.inject({
      method: 'POST',
      url: '/v1/business-waitlist/confirm',
      payload: { token },
    });
    expect(ok.statusCode).toBe(200);
    const again = await h.app.inject({
      method: 'POST',
      url: '/v1/business-waitlist/confirm',
      payload: { token },
    });
    expect(again.statusCode).toBe(400);
    const confirmed = await h.db
      .selectFrom('business_waitlist')
      .select('confirmed_at')
      .executeTakeFirstOrThrow();
    expect(confirmed.confirmed_at).toBeInstanceOf(Date);
  });
});
