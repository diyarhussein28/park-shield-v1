import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpsApp } from '../apps';
import { loadEnv } from '../config/env';
import type { FieldCrypto } from '../core/crypto';
import { createLogger } from '../core/logger';
import { CRYPTO } from '../core/tokens';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  AUDIT_DIR,
  createHarness,
  lastMail,
  mailbox,
  resetState,
  signIn,
  subscribe,
  TEST_WA_WEBHOOK_SECRET,
  type Harness,
  type Session,
} from '../test/harness';
import { DispatchService } from '../notifications/dispatch.service';
import { AuditStreamService } from './audit.service';
import { ProviderHealthService } from './provider-health.service';
import { StaffService } from './staff.service';

let h: Harness;
let ops: NestFastifyApplication;
let staff: StaffService;
let crypto: FieldCrypto;

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  const env = loadEnv({
    BREVO_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    D360_API_KEY: '',
    PRINT_PARTNER: '',
    AUDIT_BUCKET: '',
    AUDIT_BUCKET_DIR: AUDIT_DIR,
    ZAMMAD_TOKEN: '',
  });
  ops = await buildOpsApp(env, createLogger(env));
  await ops.init();
  await ops.getHttpAdapter().getInstance().ready();
  staff = ops.get(StaffService);
});
afterAll(async () => {
  await ops.close();
  await h.close();
});
beforeEach(() => resetState(h));

type Staff = { userId: string; headers: Record<string, string> };
let staffNo = 0;
async function staffAs(roles: string[]): Promise<Staff> {
  const email = `${roles[0]}-${++staffNo}@parkshield.de`;
  const { userId } = await staff.invite(null, { email, name: `${roles[0]} ${staffNo}`, roles });
  const s = await staff.createSession(userId, 'Chrome · Windows');
  return {
    userId,
    headers: { cookie: `ps_ops_session=${s.token}; ps_ops_csrf=${s.csrf}`, 'x-csrf-token': s.csrf },
  };
}
const get = (s: Staff, url: string) => ops.inject({ method: 'GET', url, headers: s.headers });
const send = (s: Staff, method: 'POST' | 'PUT' | 'PATCH', url: string, payload: unknown = {}) =>
  ops.inject({ method, url, headers: s.headers, payload: payload as object });
const post = (s: Staff, url: string, payload: unknown = {}) => send(s, 'POST', url, payload);

const ADDRESS = {
  name: 'Jonas Beispiel',
  line1: 'Musterweg 1',
  postalCode: '50667',
  city: 'Köln',
  country: 'DE',
};

async function customer(email = 'kunde@example.de', promoCode?: string) {
  const s = await subscribe(h, email, promoCode);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
    })
  ).json();
  const user = await h.db
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  const sub = await h.db
    .selectFrom('subscriptions')
    .select(['id', 'current_period_end'])
    .where('user_id', '=', user.id)
    .executeTakeFirstOrThrow();
  const t = await h.db
    .selectFrom('qr_tokens')
    .select('code_enc')
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  return { s, v, userId: user.id, sub, code: crypto.decrypt(t.code_enc) };
}

const pub = (s: Session, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  h.app.inject({
    method,
    url,
    headers: s.headers,
    ...(payload ? { payload: payload as object } : {}),
  });

async function includedOrder(c: Awaited<ReturnType<typeof customer>>) {
  const r = await pub(c.s, 'POST', `/v1/vehicles/${c.v.id}/order-included`, { address: ADDRESS });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}

describe('US-39 orders, reprints, partners and batches (AD-07)', () => {
  it('runs the order pipeline: shipped, returned with a mail, reprint with the stored address', async () => {
    const c = await customer();
    const orderId = await includedOrder(c);
    const lager = await staffAs(['fulfillment']);

    const list = (await get(lager, '/ops/v1/orders?filter=open')).json();
    expect(list.orders[0]).toMatchObject({
      id: orderId,
      status: 'paid',
      customer: 'k•••@example.de',
      included: true,
    });
    expect(JSON.stringify(list)).not.toContain('Musterweg');
    const detail = (await get(lager, `/ops/v1/orders/${orderId}`)).json();
    expect(detail.order.address).toBe('50••• · DE');

    expect(
      (await post(lager, `/ops/v1/orders/${orderId}/shipped`, { trackingNumber: '00340434161234' }))
        .statusCode,
    ).toBe(200);
    expect((await lastMail(h, 'decal_shipped'))?.text).toContain('00340434161234');
    expect(
      (await post(lager, `/ops/v1/orders/${orderId}/returned`, { note: 'Empfänger unbekannt' }))
        .statusCode,
    ).toBe(200);
    expect((await lastMail(h, 'decal_returned'))?.to).toBe('kunde@example.de');

    const reprint = await post(lager, `/ops/v1/orders/${orderId}/reprint`, {
      reason: 'Rücksendung',
    });
    expect(reprint.statusCode).toBe(201);
    const fresh = await h.db
      .selectFrom('decal_orders')
      .select(['status', 'reprint_of', 'total_gross_cents', 'shipping_address_enc'])
      .where('id', '=', reprint.json().id)
      .executeTakeFirstOrThrow();
    expect(fresh).toMatchObject({ status: 'paid', reprint_of: orderId, total_gross_cents: 0 });
    expect(JSON.parse(crypto.decrypt(fresh.shipping_address_enc))).toMatchObject({
      line1: 'Musterweg 1',
    });
    const outbox = await h.db
      .selectFrom('outbox_events')
      .select('topic')
      .where('topic', '=', 'print.submit')
      .execute();
    expect(outbox).toHaveLength(2);

    const support = await staffAs(['support']);
    expect((await get(support, '/ops/v1/orders')).statusCode).toBe(403);
  });

  it('corrects the address on a reprint only with an approved break-glass grant', async () => {
    const c = await customer();
    const orderId = await includedOrder(c);
    const lager = await staffAs(['fulfillment']);
    const admin = await staffAs(['admin']);
    const address = { ...ADDRESS, line1: 'Neue Straße 5' };
    const denied = await post(lager, `/ops/v1/orders/${orderId}/reprint`, {
      reason: 'Adresse falsch',
      address,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe('break_glass_required');

    const bg = await post(lager, '/ops/v1/break-glass', {
      target: 'decal_orders.shipping_address',
      targetId: orderId,
      reason: 'Paket kam zurück, Adresse prüfen',
      ticketRef: 'ZM-1001',
      notifyCustomer: false,
    });
    expect(bg.statusCode).toBe(201);
    await post(admin, `/ops/v1/break-glass/${bg.json().id}/approve`);
    const ok = await post(lager, `/ops/v1/orders/${orderId}/reprint`, {
      reason: 'Adresse falsch',
      address,
    });
    expect(ok.statusCode).toBe(201);
    const row = await h.db
      .selectFrom('decal_orders')
      .select('shipping_address_enc')
      .where('id', '=', ok.json().id)
      .executeTakeFirstOrThrow();
    expect(JSON.parse(crypto.decrypt(row.shipping_address_enc)).line1).toBe('Neue Straße 5');
    const audit = await h.db
      .selectFrom('audit_logs')
      .select('meta')
      .where('action', '=', 'order.reprint')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    expect(audit.meta).toMatchObject({ addressCorrected: true, reprintOf: orderId });
    expect(JSON.stringify(audit.meta)).not.toContain('Neue Straße');
  });

  it('pre-printed batch: partner and promo, the scanner offers set-up, the owner claims a code', async () => {
    const admin = await staffAs(['admin']);
    const partner = await post(admin, '/ops/v1/partners', {
      name: 'Hausverwaltung Rhein',
      kind: 'hausverwaltung',
      contactEmail: 'info@hv-rhein.de',
      commissionPct: 10,
    });
    expect(partner.statusCode).toBe(201);
    const promo = await post(admin, '/ops/v1/promo-codes', {
      code: 'rhein20',
      kind: 'percent_off',
      value: 20,
      partnerId: partner.json().id,
    });
    expect(promo.statusCode).toBe(201);
    const lager = await staffAs(['fulfillment']);
    expect((await get(lager, '/ops/v1/partners')).statusCode).toBe(200);
    expect((await post(lager, '/ops/v1/partners', { name: 'X', kind: 'other' })).statusCode).toBe(
      403,
    );
    const batch = await post(lager, '/ops/v1/batches', {
      partnerId: partner.json().id,
      promoCodeId: promo.json().id,
      quantity: 3,
      note: 'Wohnanlage Süd',
    });
    expect(batch.statusCode).toBe(201);
    const batchId = batch.json().id as string;
    const codes = (
      await h.app.inject({ method: 'GET', url: `/v1/dev/batches/${batchId}/codes` })
    ).json().codes as string[];
    expect(codes).toHaveLength(3);

    const file = await get(lager, `/ops/v1/batches/${batchId}/print.pdf`);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      await h.db
        .selectFrom('audit_logs')
        .select('is_read')
        .where('action', '=', 'batch.print_file')
        .executeTakeFirst(),
    ).toEqual({ is_read: true });
    expect((await post(lager, `/ops/v1/batches/${batchId}/printed`)).statusCode).toBe(200);
    expect((await post(lager, `/ops/v1/batches/${batchId}/shipped`)).statusCode).toBe(200);
    expect((await post(lager, `/ops/v1/batches/${batchId}/shipped`)).statusCode).toBe(409);

    // A stranger scanning an unclaimed partner decal sees the set-up offer, nothing else.
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${codes[0]}` })).json()).toEqual({
      unclaimed: true,
    });
    expect((await h.app.inject({ method: 'GET', url: `/v1/claim/${codes[0]}` })).json()).toEqual({
      partner: 'Hausverwaltung Rhein',
      promoCode: 'RHEIN20',
    });

    const c = await customer('mieter@example.de', 'RHEIN20');
    const oldToken = c.v.decal.tokenId as string;
    const claimed = await pub(c.s, 'POST', `/v1/vehicles/${c.v.id}/claim`, {
      code: codes[0]!.toLowerCase(),
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json().decal).toMatchObject({
      codeHint: codes[0]!.slice(-4),
      status: 'shipped',
    });
    expect(
      await h.db
        .selectFrom('qr_tokens')
        .select(['status', 'revoke_reason'])
        .where('id', '=', oldToken)
        .executeTakeFirst(),
    ).toEqual({ status: 'revoked', revoke_reason: 'replaced_by_preprinted' });
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/scan/${codes[0]}` })).json().nickname,
    ).toBe('Der Blaue');
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).statusCode).toBe(404);
    expect(
      (await pub(c.s, 'POST', `/v1/vehicles/${c.v.id}/claim`, { code: codes[0] })).statusCode,
    ).toBe(404);

    const batches = (await get(lager, '/ops/v1/batches')).json().batches;
    expect(batches[0]).toMatchObject({
      id: batchId,
      status: 'shipped',
      claimed: 1,
      partner: 'Hausverwaltung Rhein',
      promoCode: 'RHEIN20',
    });
    const partners = (await get(admin, '/ops/v1/partners')).json().partners;
    expect(partners[0]).toMatchObject({ codes: 3, claimed: 1, redemptions: 1 });
  });
});

describe('US-40 withdrawal, refunds, credit notes and promo codes (AD-12, AD-13)', () => {
  it('withdrawal within 14 days: Wertersatz for the days used, Stripe refund, credit note, contract ends', async () => {
    const c = await customer();
    const finance = await staffAs(['finance']);
    const quote = await post(finance, '/ops/v1/refunds/quote', {
      kind: 'withdrawal',
      subscriptionId: c.sub.id,
    });
    expect(quote.statusCode).toBe(200);
    // 10.00 € paid, 1 started day of 365 → 0.03 € Wertersatz; no decal printed yet.
    expect(quote.json()).toMatchObject({
      paidCents: 1000,
      daysUsed: 1,
      periodDays: 365,
      wertersatzCents: 3,
      decalCostCents: 0,
      refundCents: 997,
      endsSubscriptionNow: true,
    });

    const r = await post(finance, '/ops/v1/refunds', {
      refund: { kind: 'withdrawal', subscriptionId: c.sub.id },
      reason: 'Widerruf per E-Mail am selben Tag',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().creditNoteNo).toMatch(/^GS-\d{4}-\d{6}$/);
    const sub = await h.db
      .selectFrom('subscriptions')
      .select('status')
      .where('id', '=', c.sub.id)
      .executeTakeFirstOrThrow();
    expect(sub.status).toBe('canceled');
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).statusCode).toBe(404);
    const mail = await lastMail(h, 'refund_issued');
    expect(mail?.text).toMatch(/9,97\s€/);
    expect(mail?.text).toContain(r.json().creditNoteNo);

    const again = await post(finance, '/ops/v1/refunds', {
      refund: { kind: 'withdrawal', subscriptionId: c.sub.id },
      reason: 'Doppelklick auf Erstatten',
    });
    expect(again.statusCode).toBe(409);
    expect(await h.db.selectFrom('refunds').select('id').execute()).toHaveLength(1);

    const notes = (await pub(c.s, 'GET', '/v1/billing/credit-notes')).json().creditNotes;
    expect(notes).toEqual([
      expect.objectContaining({
        number: r.json().creditNoteNo,
        amountCents: 997,
        kind: 'withdrawal',
      }),
    ]);
    const file = await pub(c.s, 'GET', `/v1/billing/credit-notes/${notes[0].id}/pdf`);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.rawPayload.toString('latin1')).toMatch(
      /Erstattungsbetrag \\\(brutto\\\): 9,97\s\x80/,
    ); // PDF escapes "(" and ")"
    const other = await signIn(h, 'fremd@example.de');
    expect(
      (await pub(other, 'GET', `/v1/billing/credit-notes/${notes[0].id}/pdf`)).statusCode,
    ).toBe(404);
  });

  it('deducts the custom-printed decal and refuses after the withdrawal period', async () => {
    const c = await customer();
    const orderId = await includedOrder(c);
    await h.db
      .updateTable('decal_orders')
      .set({ status: 'in_production' })
      .where('id', '=', orderId)
      .execute();
    const finance = await staffAs(['finance']);
    const q = (
      await post(finance, '/ops/v1/refunds/quote', { kind: 'withdrawal', subscriptionId: c.sub.id })
    ).json();
    expect(q).toMatchObject({ decalCostCents: 250, refundCents: 747 });

    await h.db
      .updateTable('subscriptions')
      .set({
        created_at: sql`now() - interval '15 days'`,
        current_period_start: sql`now() - interval '15 days'`,
      })
      .where('id', '=', c.sub.id)
      .execute();
    const late = await post(finance, '/ops/v1/refunds/quote', {
      kind: 'withdrawal',
      subscriptionId: c.sub.id,
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error).toBe('withdrawal_period_over');
  });

  it('goodwill: never more than what is left, and only with billing.refund', async () => {
    const c = await customer();
    const finance = await staffAs(['finance']);
    const support = await staffAs(['support']);
    const body = {
      refund: { kind: 'goodwill', subscriptionId: c.sub.id, amountCents: 300 },
      reason: 'Kulanz wegen Ausfall am Wochenende',
    };
    expect((await post(support, '/ops/v1/refunds', body)).statusCode).toBe(403);
    expect((await post(finance, '/ops/v1/refunds', body)).statusCode).toBe(201);
    const tooMuch = await post(finance, '/ops/v1/refunds/quote', {
      kind: 'goodwill',
      subscriptionId: c.sub.id,
      amountCents: 800,
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json()).toMatchObject({ error: 'amount_too_high', max: 700 });
    expect(
      (
        await h.db
          .selectFrom('subscriptions')
          .select('status')
          .where('id', '=', c.sub.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('active');
    expect((await lastMail(h, 'refund_issued'))?.text).toContain(
      'An Ihrem Abo ändert sich dadurch nichts.',
    );
  });

  it('promo codes: percent synced as coupon, extra months move the renewal, deactivated codes stop working', async () => {
    const finance = await staffAs(['finance']);
    expect(
      (
        await post(finance, '/ops/v1/promo-codes', {
          code: 'GRUENDER',
          kind: 'percent_off',
          value: 30,
          priceLockMonths: 24,
          maxRedemptions: 100,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await post(finance, '/ops/v1/promo-codes', {
          code: 'gruender',
          kind: 'percent_off',
          value: 10,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post(finance, '/ops/v1/promo-codes', {
          code: 'ZUVIEL',
          kind: 'percent_off',
          value: 120,
        })
      ).statusCode,
    ).toBe(400);
    const extra = await post(finance, '/ops/v1/promo-codes', {
      code: 'PLUS3',
      kind: 'extra_months',
      value: 3,
    });
    expect(extra.statusCode).toBe(201);
    const list = (await get(finance, '/ops/v1/promo-codes')).json().promos;
    expect(list.find((p: { code: string }) => p.code === 'GRUENDER')).toMatchObject({
      stripeCouponId: 'coupon_fake_gruender',
      synced: true,
      priceLockMonths: 24,
    });

    const c = await customer('extra@example.de', 'PLUS3');
    const months = (c.sub.current_period_end!.getTime() - Date.now()) / (30.44 * 86_400_000);
    expect(months).toBeGreaterThan(14.5);
    expect(months).toBeLessThan(15.5);

    expect(
      (await post(finance, `/ops/v1/promo-codes/${extra.json().id}/deactivate`)).statusCode,
    ).toBe(200);
    const s = await signIn(h, 'spaet@example.de');
    const res = await pub(s, 'POST', '/v1/billing/checkout', {
      plan: 'plus',
      immediateStart: true,
      promoCode: 'PLUS3',
    });
    expect(res.json().error).toBe('promo_invalid');
  });
});

describe('US-41 settings, kill switches and provider health (AD-14–16)', () => {
  it('a kill switch needs a reason, is versioned and audited, and applies to the next alert', async () => {
    const admin = await staffAs(['admin']);
    const list = (await get(admin, '/ops/v1/settings')).json();
    const email = list.settings.find((s: { key: string }) => s.key === 'channels.email.enabled');
    expect(email).toMatchObject({ killSwitch: true, value: true, group: 'channels' });
    const url = '/ops/v1/settings/channels.email.enabled';
    expect(
      (await send(admin, 'PUT', url, { value: false, version: email.version })).json().error,
    ).toBe('reason_required');
    expect(
      (await send(admin, 'PUT', url, { value: 'no', version: email.version, reason: 'x' }))
        .statusCode,
    ).toBe(400);
    const off = await send(admin, 'PUT', url, {
      value: false,
      version: email.version,
      reason: 'Brevo-Störung',
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().version).toBe(email.version + 1);
    expect(
      (await send(admin, 'PUT', url, { value: true, version: email.version, reason: 'veraltet' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await send(admin, 'PUT', '/ops/v1/settings/nope.key', { value: 1, version: 0 })).statusCode,
    ).toBe(404);

    // The public API reloads at once through the settings broadcast.
    const c = await customer();
    await h.db
      .updateTable('qr_tokens')
      .set({ status: 'active' })
      .where('id', '=', c.v.decal.tokenId)
      .execute();
    const scan = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${c.code}/alerts`,
      remoteAddress: '198.51.100.40',
      payload: { type: 'lights_on', captcha: DEV_CAPTCHA_SOLUTION, lang: 'de' },
    });
    expect(scan.statusCode).toBe(201);
    const alert = await h.db.selectFrom('alerts').select('id').executeTakeFirstOrThrow();
    await h.app.get(DispatchService).dispatch(alert.id); // the worker's job, run inline
    const deliveries = await h.db
      .selectFrom('alert_deliveries')
      .select(['channel', 'status', 'suppressed_reason'])
      .where('alert_id', '=', alert.id)
      .execute();
    expect(deliveries.find((d) => d.channel === 'email')).toMatchObject({
      status: 'suppressed',
      suppressed_reason: 'kill_switch',
    });

    const history = (await get(admin, `${url}/history`)).json().history;
    expect(history[0]).toMatchObject({
      old: true,
      new: false,
      reason: 'Brevo-Störung',
      version: email.version + 1,
    });
    const support = await staffAs(['support']);
    expect((await get(support, '/ops/v1/settings')).statusCode).toBe(403);
  });

  it('alert types: deactivated types disappear from the scanner page', async () => {
    const admin = await staffAs(['superadmin']);
    const c = await customer();
    try {
      expect(
        (await send(admin, 'PATCH', '/ops/v1/alert-types/alarm', { active: false })).statusCode,
      ).toBe(200);
      expect(
        (await send(admin, 'PATCH', '/ops/v1/alert-types/custom', { active: false })).statusCode,
      ).toBe(400);
      const page = (await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).json();
      expect(page.alertTypes.map((t: { code: string }) => t.code)).not.toContain('alarm');
    } finally {
      await h.db
        .updateTable('alert_types')
        .set({ is_active: true })
        .where('code', '=', 'alarm')
        .execute();
    }
  });

  it('provider health turns critical on a flagged number and a webhook failure; the team is told once', async () => {
    const admin = await staffAs(['admin']);
    await h.db.deleteFrom('provider_status_events').execute();
    await h.db.deleteFrom('provider_health_alerts').execute();
    const hook = await h.app.inject({
      method: 'POST',
      url: `/v1/webhooks/whatsapp/${TEST_WA_WEBHOOK_SECRET}`,
      payload: {
        entry: [
          {
            changes: [
              {
                field: 'phone_number_quality_update',
                value: { event: 'FLAGGED', current_limit: 'TIER_1K' },
              },
              {
                field: 'message_template_status_update',
                value: { event: 'PAUSED', message_template_name: 'ps_alert' },
              },
            ],
          },
        ],
      },
    });
    expect(hook.statusCode).toBe(200);
    expect(
      (await h.app.inject({ method: 'POST', url: '/v1/webhooks/stripe', payload: {} })).statusCode,
    ).toBe(400);

    const checks = (await get(admin, '/ops/v1/providers/health')).json().checks as {
      key: string;
      level: string;
      value: string;
    }[];
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    expect(by['whatsapp.quality']).toMatchObject({ level: 'critical', value: 'RED' });
    expect(by['whatsapp.templates']).toMatchObject({
      level: 'critical',
      value: 'ps_alert: PAUSED',
    });
    expect(by['stripe.webhooks']).toMatchObject({ level: 'critical', value: '1' });
    expect(by['email.failures']?.level).toBe('ok');

    const health = ops.get(ProviderHealthService);
    expect(await health.evaluate()).toBe(3);
    const mails = (await mailbox(h)).filter((m) => m.tag === 'provider_health_alert');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('whatsapp.quality: CRITICAL (RED)');
    expect(await health.evaluate()).toBe(0);
  });
});

describe('US-42 audit log: append-only and streamed to the locked bucket (AD-17)', () => {
  it('rejects UPDATE, DELETE and TRUNCATE', async () => {
    const admin = await staffAs(['admin']);
    await get(admin, '/ops/v1/settings');
    await expect(sql`UPDATE audit_logs SET action = 'x'`.execute(h.db)).rejects.toThrow(
      /append-only/,
    );
    await expect(sql`DELETE FROM audit_logs`.execute(h.db)).rejects.toThrow(/cannot be deleted/);
    await expect(sql`TRUNCATE audit_logs`.execute(h.db)).rejects.toThrow(/append-only/);
  });

  it('streams rows into a hash chain, detects tampering, and retention waits for the stream', async () => {
    const stream = ops.get(AuditStreamService);
    // The test bucket is new for every run: start the chain at the current end of the log.
    await sql`UPDATE audit_stream_state SET last_id = coalesce((SELECT max(id) FROM audit_logs), 0),
      last_hash = repeat('0', 64), last_key = NULL WHERE id = 1`.execute(h.db);
    const admin = await staffAs(['admin']);
    for (let i = 0; i < 3; i++) await get(admin, '/ops/v1/audit'); // each view is a read event
    await sql`INSERT INTO audit_logs (action, entity, created_at) VALUES ('old.event', 'test', now() - interval '13 months')`.execute(
      h.db,
    );

    await sql`SELECT run_retention()`.execute(h.db);
    expect(
      (await h.db.selectFrom('audit_logs').select('id').where('action', '=', 'old.event').execute())
        .length,
    ).toBe(1);

    expect(await stream.flush(5000, 0)).toBeGreaterThanOrEqual(4);
    const report = await stream.verify();
    expect(report).toMatchObject({ ok: true, problems: [] });
    expect(report.objects).toBeGreaterThanOrEqual(1);

    await sql`SELECT run_retention()`.execute(h.db);
    expect(
      (await h.db.selectFrom('audit_logs').select('id').where('action', '=', 'old.event').execute())
        .length,
    ).toBe(0);
    expect((await stream.verify()).ok).toBe(true);

    const status = (await get(admin, '/ops/v1/audit')).json();
    expect(status.stream.pending).toBeGreaterThanOrEqual(0);
    expect(status.entries.length).toBeGreaterThan(0);
    expect(
      await h.db
        .selectFrom('audit_logs')
        .select('is_read')
        .where('action', '=', 'audit.view')
        .executeTakeFirst(),
    ).toEqual({ is_read: true });
    expect((await staffAs(['support']).then((s) => get(s, '/ops/v1/audit'))).statusCode).toBe(403);

    // Someone with file access edits an object: the chain no longer verifies.
    const state = await h.db
      .selectFrom('audit_stream_state')
      .select('last_key')
      .executeTakeFirstOrThrow();
    const file = join(AUDIT_DIR, ...state.last_key!.split('/'));
    await chmod(file, 0o644);
    await writeFile(file, (await readFile(file, 'utf8')).replace('audit.view', 'audit.edit'));
    const broken = await stream.verify();
    expect(broken.ok).toBe(false);
    expect(broken.problems.join('\n')).toMatch(
      /differs from the database|stream state does not match/,
    );
  });
});

describe('US-43 metrics for Metabase (AD-18)', () => {
  it('metabase_ro reads the aggregate views only, never a table or an encrypted column', async () => {
    const tables = await sql<{ table_name: string }>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`.execute(
      h.db,
    );
    for (const t of tables.rows) {
      const r = await sql<{
        ok: boolean;
      }>`SELECT has_table_privilege('metabase_ro', ${`public.${t.table_name}`}, 'SELECT') AS ok`.execute(
        h.db,
      );
      expect(r.rows[0]!.ok, t.table_name).toBe(false);
    }
    const enc = await sql<{ table_name: string; column_name: string }>`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND (column_name LIKE '%\\_enc' OR column_name LIKE '%\\_bidx')`.execute(
      h.db,
    );
    expect(enc.rows.length).toBeGreaterThan(5);
    for (const c of enc.rows) {
      const r = await sql<{
        ok: boolean;
      }>`SELECT has_column_privilege('metabase_ro', ${`public.${c.table_name}`}, ${c.column_name}, 'SELECT') AS ok`.execute(
        h.db,
      );
      expect(r.rows[0]!.ok, `${c.table_name}.${c.column_name}`).toBe(false);
    }
    const cols = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns WHERE table_schema = 'metrics'`.execute(
      h.db,
    );
    expect(
      cols.rows.map((r) => r.column_name).filter((n) => /_enc$|_bidx$|email|plate|address/.test(n)),
    ).toEqual([]);
  });

  it('the views compute MRR, the activation funnel and the protection-score distribution', async () => {
    const c = await customer();
    await h.db
      .updateTable('qr_tokens')
      .set({ status: 'active', last_test_at: new Date() })
      .where('id', '=', c.v.decal.tokenId)
      .execute();
    const run = <T>(q: string) =>
      sql
        .raw<T>(q)
        .execute(h.db)
        .then((r) => r.rows);
    // As the role itself (SET LOCAL ROLE inside a transaction), so its privileges are what is tested.
    const revenue = await h.db.transaction().execute(async (trx) => {
      await sql`SET LOCAL ROLE metabase_ro`.execute(trx);
      return (
        await sql<{
          plan: string;
          mrr_gross_cents: string;
        }>`SELECT * FROM metrics.revenue_by_plan`.execute(trx)
      ).rows;
    });
    expect(revenue).toEqual([expect.objectContaining({ plan: 'plus', mrr_gross_cents: '83' })]);
    await expect(
      h.db.transaction().execute(async (trx) => {
        await sql`SET LOCAL ROLE metabase_ro`.execute(trx);
        await sql`SELECT plate_enc FROM vehicles LIMIT 1`.execute(trx);
      }),
    ).rejects.toThrow(/permission denied/);

    const funnel = await run<{ paid: number; shipped: number; tested: number }>(
      'SELECT * FROM metrics.activation_funnel',
    );
    expect(funnel[0]).toMatchObject({ paid: 1, shipped: 0, tested: 0 });
    const score = await run<{ score: number; customers: number }>(
      'SELECT * FROM metrics.protection_score_distribution',
    );
    expect(score).toEqual([{ score: 50, customers: 1 }]);
    for (const v of [
      'churn_monthly',
      'delivery_daily',
      'message_cost_daily',
      'ios_push',
      'refunds_monthly',
    ])
      await run(`SELECT * FROM metrics.${v}`);
  });
});

describe('US-44 contact form to Zammad and the ticket sidebar summary (SP-01, AD-20)', () => {
  const contact = (
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
    ip = '203.0.113.9',
  ) =>
    h.app.inject({
      method: 'POST',
      url: '/v1/support/contact',
      headers,
      remoteAddress: ip,
      payload: { captcha: DEV_CAPTCHA_SOLUTION, locale: 'de', topic: 'decal', ...payload },
    });
  const tickets = async () =>
    (await h.app.inject({ method: 'GET', url: '/v1/dev/zammad/tickets' })).json().tickets as {
      number: string;
      email: string;
      tags: string[];
      body: string;
      subject: string;
    }[];

  it('opens a ticket for visitors and recognises signed-in Plus customers', async () => {
    const anon = await contact({
      email: 'Besucher@Example.de',
      message: 'Wo klebe ich den Aufkleber am besten hin?',
    });
    expect(anon.statusCode).toBe(201);
    expect(anon.json()).toMatchObject({ ticket: expect.stringMatching(/^DEV-/), replyHours: null });
    expect((await tickets())[0]).toMatchObject({
      email: 'besucher@example.de',
      tags: ['topic_decal', 'lang_de'],
      subject: '[Aufkleber und Versand] Wo klebe ich den Aufkleber am besten hin?',
    });

    const c = await customer();
    const mine = await contact(
      { email: 'anders@example.de', message: 'Mein Aufkleber löst sich an der Ecke.' },
      c.s.headers,
    );
    expect(mine.json().replyHours).toBe(48);
    const t = (await tickets())[0]!;
    expect(t.email).toBe('kunde@example.de');
    expect(t.tags).toEqual(['topic_decal', 'lang_de', 'signed_in', 'plus', 'reply_48h']);
    expect(t.body).toContain(`Kunden-ID: ${c.userId}`);

    expect(
      (await contact({ email: 'a@example.de', message: 'Zu kurz?', captcha: 'falsch' })).statusCode,
    ).toBe(400);
    for (let i = 0; i < 4; i++)
      await contact(
        { email: 'viel@example.de', message: 'Noch eine Frage zum Versand.' },
        {},
        '203.0.113.50',
      );
    expect(
      (
        await contact(
          { email: 'viel@example.de', message: 'Noch eine Frage zum Versand.' },
          {},
          '203.0.113.50',
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await contact(
          { email: 'viel@example.de', message: 'Noch eine Frage zum Versand.' },
          {},
          '203.0.113.50',
        )
      ).statusCode,
    ).toBe(429);
  });

  it('the Zammad summary is masked, audited and needs customer.read_masked', async () => {
    const c = await customer();
    const support = await staffAs(['support']);
    const s = (await get(support, '/ops/v1/customers/summary?email=KUNDE%40example.de')).json();
    expect(s).toMatchObject({
      found: true,
      id: c.userId,
      email: 'k•••@example.de',
      subscription: { plan: 'plus', status: 'active' },
      vehicles: 1,
      protection: 25,
    });
    expect(
      (await get(support, '/ops/v1/customers/summary?email=niemand%40example.de')).json(),
    ).toEqual({ found: false });
    const reads = await h.db
      .selectFrom('audit_logs')
      .select(['is_read', 'entity_id'])
      .where('action', '=', 'customer.summary')
      .orderBy('id', 'desc')
      .execute();
    expect(reads[1]).toEqual({ is_read: true, entity_id: c.userId });
    const lager = await staffAs(['fulfillment']);
    expect(
      (await get(lager, '/ops/v1/customers/summary?email=kunde%40example.de')).statusCode,
    ).toBe(403);
  });
});
