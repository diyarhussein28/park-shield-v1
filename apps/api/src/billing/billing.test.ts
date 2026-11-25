import { createHash } from 'node:crypto';
import { LEGAL_DOC_VERSION } from '@parkshield/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FakePayments } from '../providers/fake-payments';
import { PAYMENTS } from '../providers/ports';
import { WithdrawalsService } from '../legal/withdrawals.service';
import { isAllowedAppReturn } from './app-return';
import { BillingService } from './billing.service';
import {
  completeProfile,
  createHarness,
  lastMail,
  mailbox,
  resetState,
  signIn,
  subscribe as subscribeWith,
  verifyPhone,
  type Harness,
  type Session,
} from '../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

async function checkout(s: Session, payload: Record<string, unknown>, phone = true) {
  await completeProfile(h, s);
  if (phone) await verifyPhone(h, s);
  return h.app.inject({ method: 'POST', url: '/v1/billing/checkout', headers: s.headers, payload });
}

const subscribe = (email: string, promoCode?: string) => subscribeWith(h, email, promoCode);

describe('plans (US-04, single plan since 2026-11-21)', () => {
  it('lists the one plan at 19,99 € a year; no Plus, Premium or Business', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/v1/plans' });
    expect(res.json()).toEqual([
      {
        code: 'standard',
        name: 'ParkShield',
        availability: 'available',
        priceYearGrossCents: 1999,
        purchasable: true,
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

  it('maps an old client’s plan „plus“ or „premium“ to the single plan at 19,99 €', async () => {
    for (const [email, plan] of [
      ['aylin@example.de', 'premium'],
      ['old-client@example.de', 'plus'],
    ] as const) {
      const s = await signIn(h, email);
      const res = await checkout(s, {
        plan,
        immediateStart: true,
        immediateStartVersion: 1,
        termsVersion: 1,
      });
      expect(res.statusCode, res.body).toBe(200);
      const sessionId = new URL(res.json().url).searchParams.get('session')!;
      const session = await h.app.inject({
        method: 'GET',
        url: `/v1/dev/payments/sessions/${sessionId}`,
      });
      expect(session.json().amountCents).toBe(1999);
    }
  });

  it('needs a verified mobile number (409 phone_required)', async () => {
    const s = await signIn(h, 'nophone@example.de');
    const payload = { immediateStart: true, immediateStartVersion: 1, termsVersion: 1 };
    const refused = await checkout(s, payload, false);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'phone_required' });
    expect((await checkout(s, payload)).statusCode).toBe(200);
  });

  it('gives no access before payment, then activates with a contract number and welcome mail', async () => {
    const s = await signIn(h, 'jonas@example.de');
    await checkout(s, {
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
    });
    const before = await h.app.inject({
      method: 'GET',
      url: '/v1/billing/subscription',
      headers: { cookie: s.cookie },
    });
    expect(before.json()).toEqual({ subscription: null, hadSubscription: false, paused: null });

    const res = await checkout(s, {
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
    });
    const sessionId = new URL(res.json().url).searchParams.get('session')!;
    const amount = await h.app.inject({
      method: 'GET',
      url: `/v1/dev/payments/sessions/${sessionId}`,
    });
    expect(amount.json().amountCents).toBe(1999);
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
    expect(sub).toMatchObject({ plan: 'standard', status: 'active', cancelAtPeriodEnd: false });
    expect(sub.contractNo).toMatch(/^PS-[0-9A-HJKMNP-TV-Z]{8}$/);
    const days = (new Date(sub.currentPeriodEnd).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(365); // annual only

    const row = await h.db
      .selectFrom('subscriptions')
      .select('withdrawal_waiver_at')
      .executeTakeFirstOrThrow();
    expect(row.withdrawal_waiver_at).toBeInstanceOf(Date);
    const welcome = (await lastMail(h, 'contract_confirmation')) as
      | (Awaited<ReturnType<typeof lastMail>> & {
          attachments?: { filename: string; contentType: string; base64: string }[];
        })
      | undefined;
    expect(welcome?.text).toContain(sub.contractNo);
    expect(welcome?.text).toMatch(/Preis: 19,99\s€ \/ Jahr \(inkl\. 19 % MwSt\.\)/);
    expect(welcome?.text).toMatch(
      /Im Preis enthalten: personalisierter Aufkleber inkl\. Versand im Wert von 3,00\s€/,
    );
    expect(welcome?.text).toContain('Bezahlt über: Stripe (direkt bei ParkShield)');
    expect(welcome?.text).not.toMatch(/App Store|Google Play/);
    expect(welcome?.text).toContain('/app');
    expect(welcome?.text).toContain('Nächste Verlängerung');
    expect(welcome?.text).toContain('Ich verlange ausdrücklich');
    // § 312f BGB: the PDF „Vertragsbestätigung“ is attached; which versions went out is stored.
    expect(welcome?.attachments).toHaveLength(1);
    const pdf = welcome!.attachments![0]!;
    expect(pdf.filename).toBe(`Vertragsbestaetigung_${sub.contractNo}.pdf`);
    expect(pdf.contentType).toBe('application/pdf');
    const file = Buffer.from(pdf.base64, 'base64');
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    const sent = await h.db
      .selectFrom('contract_confirmations')
      .select(['legal_doc_version', 'renewal_mode', 'pdf_sha256', 'immediate_start_consent_id'])
      .executeTakeFirstOrThrow();
    expect(sent.legal_doc_version).toBe(LEGAL_DOC_VERSION);
    expect(sent.renewal_mode).toBe('annual');
    expect(sent.immediate_start_consent_id).not.toBeNull();
    expect(sent.pdf_sha256.equals(createHash('sha256').update(file).digest())).toBe(true);
    const consents = await h.db
      .selectFrom('consent_records')
      .select(['type', 'text_version', 'source'])
      .orderBy('type')
      .execute();
    expect([...new Set(consents.map((c) => c.type))]).toEqual([
      'agb',
      'immediate_start',
      'privacy_notice',
    ]);
    const link = await h.db
      .selectFrom('subscriptions')
      .select(['immediate_start_consent_id', 'renewal_mode'])
      .executeTakeFirstOrThrow();
    expect(link.immediate_start_consent_id).not.toBeNull();
    expect(link.renewal_mode).toBe('annual');

    expect(
      (
        await checkout(s, {
          plan: 'standard',
          immediateStart: true,
          immediateStartVersion: 1,
          termsVersion: 1,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('applies billing events exactly once', async () => {
    const s = await signIn(h, 'twice@example.de');
    const res = await checkout(s, {
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
    });
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
    expect((await mailbox(h)).filter((m) => m.tag === 'contract_confirmation')).toHaveLength(1);
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
      (
        await checkout(s, {
          plan: 'standard',
          immediateStart: true,
          immediateStartVersion: 1,
          termsVersion: 1,
          promoCode: 'NOPE',
        })
      ).json(),
    ).toMatchObject({
      error: 'promo_invalid',
    });
    const res = await checkout(s, {
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
      promoCode: 'gruender50',
    });
    const sessionId = new URL(res.json().url).searchParams.get('session')!;
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/dev/payments/sessions/${sessionId}` })).json()
        .amountCents,
    ).toBe(1000);
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
      (
        await checkout(late, {
          plan: 'standard',
          immediateStart: true,
          immediateStartVersion: 1,
          termsVersion: 1,
          promoCode: 'VOLL',
        })
      ).statusCode,
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
    expect(invoice).toMatchObject({ totalCents: 1999, pdfUrl: expect.stringMatching(/\.pdf$/) });
    const pdf = await h.app.inject({ method: 'GET', url: invoice.pdfUrl });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('cancellation (US-07, §312k BGB)', () => {
  const portalCancel = (s: Session, payload: Record<string, unknown> = {}) =>
    h.app.inject({ method: 'POST', url: '/v1/portal/cancellations', headers: s.headers, payload });
  const publicCancel = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/v1/legal/cancellations', payload });

  it('cancels to the end of the period from the account and confirms by e-mail', async () => {
    const s = await subscribe('cancel@example.de');
    const res = await portalCancel(s);
    expect(res.statusCode).toBe(200);
    const sub = (
      await h.app.inject({
        method: 'GET',
        url: '/v1/billing/subscription',
        headers: { cookie: s.cookie },
      })
    ).json().subscription;
    // The service stays fully active until the end date.
    expect(sub).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    expect(new Date(res.json().endsAt).getTime()).toBe(new Date(sub.currentPeriodEnd).getTime());
    const mail = await lastMail(h, 'cancel_received');
    expect(mail?.to).toBe('cancel@example.de');
    expect(mail?.text).toContain(sub.contractNo);
    expect(mail?.text).toContain('Kündigung zurücknehmen');
    const req = await h.db
      .selectFrom('cancellation_requests')
      .select(['status', 'channel', 'computed_end_date'])
      .executeTakeFirstOrThrow();
    expect(req).toMatchObject({ status: 'scheduled', channel: 'portal' });
  });

  it('works without login by e-mail + contract number or plate, same answer, no captcha', async () => {
    const s = await subscribe('nologin@example.de');
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
    });
    const { contract_no } = await h.db
      .selectFrom('subscriptions')
      .select('contract_no')
      .executeTakeFirstOrThrow();

    const wrong = await publicCancel({
      name: 'Nora Login',
      email: 'nologin@example.de',
      contractNo: 'PS-WRONG000',
    });
    expect(wrong.statusCode).toBe(200);
    expect((await lastMail(h, 'cancel_needs_review'))?.to).toBe('nologin@example.de');
    expect(
      await h.db
        .selectFrom('cancellation_requests')
        .select('status')
        .where('status', '=', 'needs_review')
        .execute(),
    ).toHaveLength(1);

    const byPlate = await publicCancel({
      name: 'Nora Login',
      email: 'NoLogin@Example.de',
      plate: 'kab1234',
      confirmationEmail: 'other@example.de',
    });
    expect(byPlate.statusCode).toBe(200);
    expect(Object.keys(wrong.json())).toEqual(Object.keys(byPlate.json()));
    // Confirmation to the given address and to the account address.
    const sent = (await mailbox(h)).filter((m) => m.tag === 'cancel_received').map((m) => m.to);
    expect(sent.sort()).toEqual(['nologin@example.de', 'other@example.de']);
    expect((await lastMail(h, 'cancel_received'))?.text).toContain(contract_no!);
    const sub = await h.db
      .selectFrom('subscriptions')
      .select('cancel_at_period_end')
      .executeTakeFirstOrThrow();
    expect(sub.cancel_at_period_end).toBe(true);
  });

  it('a later requested date and the one-click revoke link', async () => {
    const s = await subscribe('later@example.de');
    const end = (
      await h.db.selectFrom('subscriptions').select('current_period_end').executeTakeFirstOrThrow()
    ).current_period_end!;
    const wanted = new Date(end.getTime() + 40 * 86_400_000).toISOString().slice(0, 10);
    const res = await portalCancel(s, { effective: 'date', date: wanted });
    // Monthly after the first term: the first monthly boundary on or after the requested date.
    expect(new Date(res.json().endsAt).getTime()).toBeGreaterThanOrEqual(
      new Date(`${wanted}T00:00:00Z`).getTime(),
    );
    const token = /token=([A-Za-z0-9_-]+)/.exec((await lastMail(h, 'cancel_received'))!.text)![1]!;
    const revoke = (t: string) =>
      h.app.inject({
        method: 'POST',
        url: '/v1/legal/cancellations/revoke',
        payload: { token: t },
      });
    expect((await revoke(token)).statusCode).toBe(200);
    expect((await revoke(token)).statusCode).toBe(404);
    const sub = await h.db
      .selectFrom('subscriptions')
      .select('cancel_at_period_end')
      .executeTakeFirstOrThrow();
    expect(sub.cancel_at_period_end).toBe(false);
    expect((await lastMail(h, 'cancel_revoked'))?.to).toBe('later@example.de');
  });

  it('queues extraordinary cancellations with their reason for review', async () => {
    const s = await subscribe('extra@example.de');
    const res = await portalCancel(s, {
      type: 'extraordinary',
      reason: 'Auto verkauft, Umzug ins Ausland',
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

  it('needs a contract number or a plate', async () => {
    const res = await publicCancel({ name: 'X Y', email: 'x@example.de' });
    expect(res.statusCode).toBe(400);
  });
});

describe('online withdrawal (§ 356a BGB)', () => {
  it('confirms receipt at once, then refunds minus Wertersatz and revokes the codes', async () => {
    const s = await subscribe('widerruf@example.de');
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'Der Rote', plate: 'LEV-X 1' },
    });
    const { contract_no } = await h.db
      .selectFrom('subscriptions')
      .select('contract_no')
      .executeTakeFirstOrThrow();
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/legal/withdrawals',
      payload: { name: 'Wanda Ruf', contractRef: contract_no!, email: 'widerruf@example.de' },
    });
    expect(res.statusCode).toBe(200);
    const receipt = await lastMail(h, 'withdrawal_received');
    expect(receipt?.text).toContain('Wir haben Ihren Widerruf am');
    expect(receipt?.text).toContain(contract_no!);

    const { id } = await h.db
      .selectFrom('withdrawal_requests')
      .select('id')
      .executeTakeFirstOrThrow();
    await h.app.get(WithdrawalsService).process(id);
    await h.app.get(WithdrawalsService).process(id); // idempotent

    const sub = await h.db
      .selectFrom('subscriptions')
      .select(['status', 'withdrawn_at'])
      .executeTakeFirstOrThrow();
    expect(sub.status).toBe('withdrawn');
    const req = await h.db
      .selectFrom('withdrawal_requests')
      .select(['status', 'refund_amount_cents'])
      .executeTakeFirstOrThrow();
    expect(req.status).toBe('processed');
    expect(req.refund_amount_cents).toBeGreaterThan(950); // 10 € minus one day of Wertersatz
    expect(await h.db.selectFrom('refunds').select('kind').execute()).toEqual([
      { kind: 'withdrawal' },
    ]);
    const tags = await h.db.selectFrom('qr_tokens').select(['status', 'revoke_reason']).execute();
    expect(tags).toEqual([{ status: 'revoked', revoke_reason: 'withdrawn' }]);
  });

  it('keeps an unmatched withdrawal for review instead of dropping it', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/legal/withdrawals',
      payload: { name: 'Unbekannt', contractRef: 'PS-00000000', email: 'who@example.de' },
    });
    expect(res.statusCode).toBe(200);
    const { id } = await h.db
      .selectFrom('withdrawal_requests')
      .select('id')
      .executeTakeFirstOrThrow();
    await h.app.get(WithdrawalsService).process(id);
    const req = await h.db
      .selectFrom('withdrawal_requests')
      .select(['status', 'review_note'])
      .executeTakeFirstOrThrow();
    expect(req).toEqual({ status: 'needs_review', review_note: 'no_contract_found' });
    expect((await lastMail(h, 'withdrawal_received'))?.to).toBe('who@example.de');
  });

  it('never asks for a reason', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/legal/withdrawals',
      payload: { name: 'A B', contractRef: 'x@example.de', email: 'x@example.de', reason: 'x' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('back from Checkout without the webhook (US-06)', () => {
  it('confirms the paid session for its owner only, once', async () => {
    const payments = h.app.get<FakePayments>(PAYMENTS);
    const s = await signIn(h, 'return@example.de');
    const res = await checkout(s, {
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
    });
    const sessionId = new URL(res.json().url).searchParams.get('session')!;
    const session = (await payments.getSession(sessionId))!;
    // The success URL carries the session id instead of Stripe's placeholder.
    expect(session.successUrl).toContain(`session_id=${sessionId}`);

    const event = {
      kind: 'checkout_completed' as const,
      eventId: `confirm:${sessionId}`,
      customerId: session.customerId,
      subscriptionId: 'sub_confirm_1',
      metadata: session.metadata,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 365 * 86_400_000),
    };
    const confirm = (who: Session) =>
      h.app.inject({
        method: 'POST',
        url: '/v1/billing/checkout/confirm',
        headers: who.headers,
        payload: { sessionId },
      });

    const original = payments.checkoutCompletion.bind(payments);
    payments.checkoutCompletion = async () => null;
    expect((await confirm(s)).json()).toEqual({ status: 'pending' });

    payments.checkoutCompletion = async () => event;
    const other = await signIn(h, 'stranger@example.de');
    expect((await confirm(other)).statusCode).toBe(404);
    expect((await confirm(s)).json()).toEqual({ status: 'active' });
    expect((await confirm(s)).json()).toEqual({ status: 'active' });
    // The webhook arriving later changes nothing.
    await h.app.get(BillingService).handle({ ...event, eventId: 'evt_late_webhook' });
    const subs = await h.db.selectFrom('subscriptions').select('id').execute();
    expect(subs).toHaveLength(1);
    expect((await mailbox(h)).filter((m) => m.tag === 'contract_confirmation')).toHaveLength(1);
    payments.checkoutCompletion = original;
  });
});

describe('paying inside the native app (Stripe returns through /app/zurueck)', () => {
  const app = 'exp://192.168.178.25:8082/--/zurueck';
  const consent = {
    plan: 'standard',
    immediateStart: true,
    immediateStartVersion: 1,
    termsVersion: 1,
  };

  it('sends Stripe back to the bounce page with the app address, the result and the session id', async () => {
    const payments = h.app.get<FakePayments>(PAYMENTS);
    const s = await signIn(h, 'app-pay@example.de');
    const res = await checkout(s, { ...consent, appReturn: app });
    expect(res.statusCode).toBe(200);
    const sessionId = new URL(res.json().url).searchParams.get('session')!;
    const session = (await payments.getSession(sessionId))!;
    const back = new URL(session.successUrl);
    expect(back.pathname).toBe('/app/zurueck');
    expect(Object.fromEntries(back.searchParams)).toEqual({
      to: 'checkout',
      u: app,
      result: 'success',
      session_id: sessionId,
    });
    expect(new URL(session.cancelUrl).searchParams.get('result')).toBe('canceled');
  });

  it('refuses any other return address (no open redirect)', async () => {
    const s = await signIn(h, 'app-pay-evil@example.de');
    for (const appReturn of [
      'https://evil.example/x',
      'javascript:alert(1)',
      'parkshield://x"><',
    ]) {
      const res = await checkout(s, { ...consent, appReturn });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('app_return_invalid');
    }
  });

  it('the payment-method page returns to the app too', async () => {
    const s = await subscribe('app-portal@example.de');
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/portal',
      headers: s.headers,
      payload: { appReturn: 'parkshield://zurueck' },
    });
    const url = new URL(res.json().url);
    expect(url.pathname).toBe('/app/zurueck');
    expect(url.searchParams.get('to')).toBe('portal');
    expect(url.searchParams.get('u')).toBe('parkshield://zurueck');
  });

  it('Expo Go addresses only outside real production', () => {
    const prod = { NODE_ENV: 'production', APP_ENV: 'production' } as const;
    const ci = { NODE_ENV: 'production', APP_ENV: 'ci' } as const;
    expect(isAllowedAppReturn('parkshield://zurueck', prod)).toBe(true);
    expect(isAllowedAppReturn(app, prod)).toBe(false);
    expect(isAllowedAppReturn(app, ci)).toBe(true);
  });
});
