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
  setSetting,
  signIn,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { completeProfile, registerAppDevice, verifyPhone } from '../test/harness';
import { DispatchService } from '../notifications/dispatch.service';
import { WithdrawalsService } from '../legal/withdrawals.service';
import { AuditStreamService } from './audit.service';
import { ProviderHealthService } from './provider-health.service';
import { StaffService } from './staff.service';
import { SettingsService } from '../core/settings.service';
import { ChangeOverService } from '../vehicles/change-over.service';

let h: Harness;
let ops: NestFastifyApplication;
let staff: StaffService;
let crypto: FieldCrypto;

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  const env = loadEnv({
    MAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    TWILIO_ACCOUNT_SID: '',
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
  const r = await pub(c.s, 'POST', `/v1/vehicles/${c.v.id}/order-print`, {
    address: ADDRESS,
    personalizationConfirmed: true,
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().free).toBe(true); // the free welcome print
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
      status: 'assigned',
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

/** The sticker of a stock code, found by its scanned QR content, as the ops page does. */
async function stickerOf(s: Staff, code: string) {
  const r = await get(s, `/ops/v1/stickers?q=${encodeURIComponent(`https://x.test/s/${code}`)}`);
  expect(r.statusCode).toBe(200);
  return r.json().stickers[0] as { id: string; serial: string; ready: boolean };
}

/** Write, check and lock the chip of a stock sticker (phase 2). */
async function readySticker(s: Staff, code: string, uid?: string) {
  const { id } = await stickerOf(s, code);
  const { url } = (await get(s, `/ops/v1/stickers/${id}/nfc`)).json();
  expect(
    (await post(s, `/ops/v1/stickers/${id}/nfc/written`, { method: 'web_nfc' })).statusCode,
  ).toBe(200);
  expect(
    (await post(s, `/ops/v1/stickers/${id}/nfc/verify`, { readUrl: url, ...(uid ? { uid } : {}) }))
      .statusCode,
  ).toBe(200);
  const locked = await post(s, `/ops/v1/stickers/${id}/nfc/locked`, { confirmIrreversible: true });
  expect(locked.json().sticker).toMatchObject({ ready: true });
  return id;
}

describe('tag lifecycle and FROM_STOCK fulfilment', () => {
  it('the packer scan links a stock sticker to the vehicle; the old code works until the change-over ends', async () => {
    await setSetting(h, 'fulfillment.mode', 'from_stock');
    const admin = await staffAs(['admin']);
    const partner = await post(admin, '/ops/v1/partners', { name: 'Lager', kind: 'other' });
    const lager = await staffAs(['fulfillment']);
    const partnerBatch = await post(lager, '/ops/v1/batches', {
      partnerId: partner.json().id,
      quantity: 1,
    });
    const partnerCodes = (
      await h.app.inject({
        method: 'GET',
        url: `/v1/dev/batches/${partnerBatch.json().id}/codes`,
      })
    ).json().codes as string[];
    const batch = await post(lager, '/ops/v1/batches/inhouse', { quantity: 2 });
    const codes = (
      await h.app.inject({ method: 'GET', url: `/v1/dev/batches/${batch.json().id}/codes` })
    ).json().codes as string[];
    // Phase 2 (2026-11-27): only a sticker whose chip is written, checked and locked can be packed.
    await readySticker(lager, codes[0]!);

    const c = await customer('lager@example.de');
    // The code works at once after registration: no activation step.
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).statusCode).toBe(200);
    const orderId = await includedOrder(c);
    expect(
      (await post(lager, `/ops/v1/orders/${orderId}/scan`, { scanned: 'nonsense!!' })).json(),
    ).toMatchObject({ error: 'code_unreadable' });
    // A partner decal never goes into a customer's order; an unlocked stock sticker not yet.
    expect(
      (await post(lager, `/ops/v1/orders/${orderId}/scan`, { scanned: partnerCodes[0]! })).json(),
    ).toMatchObject({ error: 'not_in_stock' });
    expect(
      (await post(lager, `/ops/v1/orders/${orderId}/scan`, { scanned: codes[1]! })).json(),
    ).toMatchObject({ error: 'nfc_not_ready' });
    const ok = await post(lager, `/ops/v1/orders/${orderId}/scan`, {
      scanned: `https://s.park-shield.de/s/${codes[0]}`,
    });
    expect(ok.statusCode).toBe(200);

    expect((await get(lager, `/ops/v1/orders/${orderId}`)).json().order).toMatchObject({
      status: 'packed',
    });
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/scan/${codes[0]}` })).json().nickname,
    ).toBe('Der Blaue');
    // Phase 3 (2026-11-27): the old code keeps working while the sticker travels.
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).statusCode).toBe(200);
    // The app shows the new code (newest by assignment) with the vehicle's own design.
    const vehicle = (await pub(c.s, 'GET', `/v1/vehicles/${c.v.id}`)).json();
    expect(vehicle.decal.codeHint).toBe(codes[0]!.slice(-4));
    // Phase 4: the app shows the sticker's serial and that the old code still works (no deadline yet).
    expect(vehicle.decal.serial).toMatch(/^PS-[0-9]{6}$/);
    expect(vehicle.decal.changeOver).toEqual({ oldCodeUntil: null });
    expect(vehicle.decal.template).toBe(c.v.decal.template);
    // A stock code is linked once only.
    expect(
      (await post(lager, `/ops/v1/orders/${orderId}/scan`, { scanned: codes[0]! })).statusCode,
    ).toBe(409);
    const events = await h.db
      .selectFrom('tag_events')
      .select(['from_status', 'to_status', 'reason'])
      .where('reason', 'in', ['stock_scan', 'replaced_by_stock'])
      .orderBy('reason')
      .execute();
    expect(events).toEqual([
      { from_status: 'in_stock', to_status: 'assigned', reason: 'stock_scan' },
    ]);
    expect(
      await h.db
        .selectFrom('code_issuances')
        .select('kind')
        .where('vehicle_id', '=', c.v.id)
        .orderBy('issued_at')
        .execute(),
    ).toEqual([{ kind: 'initial' }, { kind: 'stock_sticker' }]);
    await expect(h.db.updateTable('tag_events').set({ reason: 'x' }).execute()).rejects.toThrow(
      /append-only/,
    );

    // Shipping starts the deadline: 14 days for the old code.
    expect(
      (
        await post(lager, `/ops/v1/orders/${orderId}/shipped`, {
          trackingNumber: '00340434161094042557',
        })
      ).statusCode,
    ).toBe(200);
    const old = await h.db
      .selectFrom('qr_tokens')
      .select(['status', 'retire_after'])
      .where('vehicle_id', '=', c.v.id)
      .where('serial_no', 'is', null)
      .executeTakeFirstOrThrow();
    expect(old.status).toBe('assigned');
    const days = (+new Date(old.retire_after!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.01);
    expect(
      (await pub(c.s, 'GET', `/v1/vehicles/${c.v.id}`)).json().decal.changeOver.oldCodeUntil,
    ).not.toBeNull();
    // The shipping mail says how long the old code keeps working.
    expect((await lastMail(h, 'decal_shipped'))?.text).toContain('höchstens 14 Tage');

    // The owner tests the new sticker: the old code stops at once.
    await pub(c.s, 'POST', `/v1/vehicles/${c.v.id}/test-window`);
    const test = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${codes[0]}/alerts`,
      remoteAddress: '198.51.100.7',
      payload: { type: 'lights_on', captcha: DEV_CAPTCHA_SOLUTION, lang: 'de' },
    });
    expect(test.statusCode).toBe(201);
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).statusCode).toBe(404);
    expect(
      await h.db
        .selectFrom('qr_tokens')
        .select('revoke_reason')
        .where('vehicle_id', '=', c.v.id)
        .where('serial_no', 'is', null)
        .executeTakeFirstOrThrow(),
    ).toEqual({ revoke_reason: 'retired_change_over' });
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${codes[0]}` })).statusCode).toBe(
      200,
    );
    expect((await pub(c.s, 'GET', `/v1/vehicles/${c.v.id}`)).json().decal.changeOver).toBeNull();
    // From stock, the print options say so; the generic sticker prints no name, so none is checked.
    const options = (await pub(c.s, 'GET', `/v1/vehicles/${c.v.id}/print-options`)).json();
    expect(options.shipped.stock).toBe(true);
    expect(options.personalization.labelValid).toBe(true);
  });

  it('change-over: deadline sweep, a returned parcel pauses it, „Sperren“ stops both codes', async () => {
    await setSetting(h, 'fulfillment.mode', 'from_stock');
    const lager = await staffAs(['fulfillment']);
    const batch = await post(lager, '/ops/v1/batches/inhouse', { quantity: 2 });
    const codes = (
      await h.app.inject({ method: 'GET', url: `/v1/dev/batches/${batch.json().id}/codes` })
    ).json().codes as string[];
    await readySticker(lager, codes[0]!);
    await readySticker(lager, codes[1]!);
    const scan = (code: string) =>
      h.app.inject({ method: 'GET', url: `/v1/scan/${code}` }).then((r) => r.statusCode);
    const sweep = () => ops.get(ChangeOverService).sweep();

    // A: shipped, never tested → the worker retires the old code at the deadline.
    const a = await customer('frist@example.de');
    const orderA = await includedOrder(a);
    await post(lager, `/ops/v1/orders/${orderA}/scan`, { scanned: codes[0]! });
    await post(lager, `/ops/v1/orders/${orderA}/shipped`, {
      trackingNumber: '00340434161094042558',
    });
    expect(await sweep()).toBe(0);
    expect(await scan(a.code)).toBe(200);
    await h.db
      .updateTable('qr_tokens')
      .set({ retire_after: sql<Date>`now() - interval '1 minute'` })
      .where('vehicle_id', '=', a.v.id)
      .where('serial_no', 'is', null)
      .execute();
    expect(await sweep()).toBe(1);
    expect(await scan(a.code)).toBe(404);
    expect(await scan(codes[0]!)).toBe(200);

    // B: the parcel comes back → no deadline; „Sperren“ then stops both codes, and the next new
    // code is not held by the 10-day wait (a stock sticker is not a code the owner asked for).
    const b = await customer('zurueck@example.de');
    const orderB = await includedOrder(b);
    await post(lager, `/ops/v1/orders/${orderB}/scan`, { scanned: codes[1]! });
    await post(lager, `/ops/v1/orders/${orderB}/shipped`, {
      trackingNumber: '00340434161094042559',
    });
    expect(
      (await post(lager, `/ops/v1/orders/${orderB}/returned`, { note: 'Empfänger unbekannt' }))
        .statusCode,
    ).toBe(200);
    expect(
      await h.db
        .selectFrom('qr_tokens')
        .select('retire_after')
        .where('vehicle_id', '=', b.v.id)
        .where('serial_no', 'is', null)
        .executeTakeFirstOrThrow(),
    ).toEqual({ retire_after: null });
    expect([await scan(b.code), await scan(codes[1]!)]).toEqual([200, 200]);
    const locked = await pub(b.s, 'POST', `/v1/vehicles/${b.v.id}/tokens/revoke`, {
      reason: 'damaged',
      confirm: true,
    });
    expect(locked.statusCode).toBe(200);
    expect([await scan(b.code), await scan(codes[1]!)]).toEqual([404, 404]);
    expect((await pub(b.s, 'GET', `/v1/vehicles/${b.v.id}/new-code`)).json()).toMatchObject({
      freeAvailable: true,
    });
  });
});

describe('in-house NFC stock (2026-11-27, docs/nfc-sticker-plan.md)', () => {
  it('batch with serial numbers, generic print file, CSV and ZIP export, never claimable', async () => {
    const lager = await staffAs(['fulfillment']);
    const admin = await staffAs(['admin']);
    expect((await post(lager, '/ops/v1/batches/inhouse', { quantity: 5001 })).statusCode).toBe(400);
    const batch = await post(lager, '/ops/v1/batches/inhouse', { quantity: 3, note: 'Testlauf' });
    expect(batch.statusCode).toBe(201);
    const batchId = batch.json().id as string;
    const codes = (
      await h.app.inject({ method: 'GET', url: `/v1/dev/batches/${batchId}/codes` })
    ).json().codes as string[];
    expect(codes).toHaveLength(3);

    const rows = await h.db
      .selectFrom('qr_tokens')
      .select(['serial_no', 'status', 'vehicle_id'])
      .where('batch_id', '=', batchId)
      .orderBy('serial_no')
      .execute();
    const first = rows[0]!.serial_no!;
    expect(rows.map((r) => r.serial_no)).toEqual([first, first + 1, first + 2]);
    expect(rows.every((r) => r.status === 'in_stock' && r.vehicle_id === null)).toBe(true);
    const label = (n: number) => `PS-${String(n).padStart(6, '0')}`;
    const listed = (await get(lager, '/ops/v1/batches')).json().batches as Record<
      string,
      unknown
    >[];
    expect(listed.find((b) => b.id === batchId)).toMatchObject({
      kind: 'inhouse_nfc',
      chip: 'NTAG215',
      quantity: 3,
      partner: null,
      serialFrom: label(first),
      serialTo: label(first + 2),
    });

    const pdf = await get(lager, `/ops/v1/batches/${batchId}/print.pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    // The production export holds every code: admin only (tokens.export), an audited read.
    expect((await get(lager, `/ops/v1/batches/${batchId}/export.csv`)).statusCode).toBe(403);
    const csv = await get(admin, `/ops/v1/batches/${batchId}/export.csv`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['cache-control']).toBe('no-store');
    const lines = csv.body
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe('serial;url;qr_content;ndef_uri;ndef_prefix;ndef_payload_hex;batch');
    expect(lines).toHaveLength(4);
    const [serial, url, qrContent, ndef, prefix, hex, b] = lines[1]!.split(';');
    expect(serial).toBe(label(first));
    expect(url).toMatch(new RegExp(`^https?://.+/s/${codes[0]}$`));
    expect(qrContent).toBe(url);
    expect(ndef).toBe(url);
    // The scheme is one prefix byte: 0x04 "https://" (production), 0x03 "http://" (local test stack).
    const scheme = url!.startsWith('https://') ? ['0x04', 'https://'] : ['0x03', 'http://'];
    expect(prefix).toBe(scheme[0]);
    expect(hex!.slice(0, 2)).toBe(scheme[0]!.slice(2));
    expect(`${scheme[1]}${Buffer.from(hex!.slice(2), 'hex').toString('utf8')}`).toBe(url);
    expect(b).toBe(batchId);
    const zipped = await get(admin, `/ops/v1/batches/${batchId}/qr.zip`);
    expect(zipped.statusCode).toBe(200);
    expect(zipped.rawPayload.subarray(0, 2).toString()).toBe('PK');
    for (const ext of ['svg', 'png'])
      expect(zipped.rawPayload.includes(Buffer.from(`${label(first + 2)}.${ext}`))).toBe(true);
    const reads = await h.db
      .selectFrom('audit_logs')
      .select(['action', 'is_read'])
      .where('actor_id', '=', admin.userId)
      .where('action', 'in', ['batch.export_csv', 'batch.export_zip'])
      .orderBy('action')
      .execute();
    expect(reads).toEqual([
      { action: 'batch.export_csv', is_read: true },
      { action: 'batch.export_zip', is_read: true },
    ]);

    // Partner batches have no production export.
    const partner = await post(admin, '/ops/v1/partners', { name: 'Lager2', kind: 'other' });
    const pb = await post(lager, '/ops/v1/batches', { partnerId: partner.json().id, quantity: 1 });
    expect((await get(admin, `/ops/v1/batches/${pb.json().id}/export.csv`)).json()).toMatchObject({
      error: 'not_inhouse_batch',
    });

    // Not packed yet: the scanner shows no set-up offer, and no customer can claim it.
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${codes[0]}` })).statusCode).toBe(
      404,
    );
    expect((await h.app.inject({ method: 'GET', url: `/v1/claim/${codes[0]}` })).statusCode).toBe(
      404,
    );
    const c = await customer('nfc@example.de');
    expect(
      (await pub(c.s, 'POST', `/v1/vehicles/${c.v.id}/claim`, { code: codes[0] })).statusCode,
    ).toBe(404);
    expect(
      await h.db
        .selectFrom('qr_tokens')
        .select('status')
        .where('batch_id', '=', batchId)
        .where('vehicle_id', 'is not', null)
        .execute(),
    ).toEqual([]);
  });
});

describe('NFC chip of an in-house sticker (phase 2, 2026-11-27)', () => {
  it('write, check against the URL, lock only after the check, take out a damaged sticker', async () => {
    const lager = await staffAs(['fulfillment']);
    const support = await staffAs(['support']);
    const batch = await post(lager, '/ops/v1/batches/inhouse', { quantity: 3 });
    const codes = (
      await h.app.inject({ method: 'GET', url: `/v1/dev/batches/${batch.json().id}/codes` })
    ).json().codes as string[];

    // Found by serial number and by the scanned QR content; never by staff without the permission.
    const a = await stickerOf(lager, codes[0]!);
    expect(a.serial).toMatch(/^PS-\d{6}$/);
    const bySerial = (await get(lager, `/ops/v1/stickers?q=${a.serial.toLowerCase()}`)).json();
    expect(bySerial.stickers.map((x: { id: string }) => x.id)).toEqual([a.id]);
    expect((await get(support, `/ops/v1/stickers?q=${a.serial}`)).statusCode).toBe(403);
    expect((await get(lager, `/ops/v1/stickers/${a.id}`)).json().sticker).toMatchObject({
      status: 'in_stock',
      chip: 'NTAG215',
      writtenAt: null,
      ready: false,
    });

    // The URL to write is the QR URL; showing it is an audited read.
    const target = (await get(lager, `/ops/v1/stickers/${a.id}/nfc`)).json();
    expect(target.url).toMatch(new RegExp(`/s/${codes[0]}$`));
    expect(target.qrSvg).toContain('<svg');
    expect(
      await h.db
        .selectFrom('audit_logs')
        .select('is_read')
        .where('actor_id', '=', lager.userId)
        .where('action', '=', 'sticker.nfc_url')
        .execute(),
    ).toEqual([{ is_read: true }]);

    // Order is enforced: check after writing, lock after checking, and only with the confirmation.
    expect(
      (await post(lager, `/ops/v1/stickers/${a.id}/nfc/verify`, { readUrl: target.url })).json(),
    ).toMatchObject({ error: 'nfc_not_written' });
    await post(lager, `/ops/v1/stickers/${a.id}/nfc/written`, { method: 'nfc_tools' });
    expect(
      (
        await post(lager, `/ops/v1/stickers/${a.id}/nfc/locked`, { confirmIrreversible: true })
      ).json(),
    ).toMatchObject({ error: 'nfc_not_verified' });
    // A chip with another sticker's URL is caught and logged.
    const other = `${target.url.slice(0, -codes[0]!.length)}${codes[1]}`;
    expect(
      (await post(lager, `/ops/v1/stickers/${a.id}/nfc/verify`, { readUrl: other })).json(),
    ).toMatchObject({ error: 'nfc_mismatch' });
    expect(
      await h.db
        .selectFrom('audit_logs')
        .select('entity_id')
        .where('actor_id', '=', lager.userId)
        .where('action', '=', 'sticker.nfc_mismatch')
        .execute(),
    ).toEqual([{ entity_id: a.id }]);
    const checked = await post(lager, `/ops/v1/stickers/${a.id}/nfc/verify`, {
      readUrl: ` ${target.url} `,
      uid: '04:A1:B2:C3:D4:E5:F6',
    });
    expect(checked.json().sticker.verifiedAt).not.toBeNull();
    // The same chip, as Web NFC writes the UID, is fine; a different chip is not.
    expect(
      (
        await post(lager, `/ops/v1/stickers/${a.id}/nfc/verify`, {
          readUrl: target.url,
          uid: '04:a1:b2:c3:d4:e5:f6',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await post(lager, `/ops/v1/stickers/${a.id}/nfc/verify`, {
          readUrl: target.url,
          uid: '04:00:00:00:00:00:01',
        })
      ).json(),
    ).toMatchObject({ error: 'nfc_other_chip' });
    expect(
      (await post(lager, `/ops/v1/stickers/${a.id}/nfc/locked`, { confirmIrreversible: false }))
        .statusCode,
    ).toBe(400);
    const locked = await post(lager, `/ops/v1/stickers/${a.id}/nfc/locked`, {
      confirmIrreversible: true,
    });
    expect(locked.json().sticker).toMatchObject({ ready: true, method: 'nfc_tools' });
    // A locked chip is final.
    expect(
      (await post(lager, `/ops/v1/stickers/${a.id}/nfc/written`, { method: 'web_nfc' })).json(),
    ).toMatchObject({ error: 'nfc_locked' });
    const tag = await h.db
      .selectFrom('nfc_tags')
      .select(['uid_bidx', 'written_by', 'verified_by', 'locked_by'])
      .where('qr_token_id', '=', a.id)
      .executeTakeFirstOrThrow();
    expect(tag.uid_bidx?.toString('hex')).not.toContain('04a1b2');
    expect([tag.written_by, tag.verified_by, tag.locked_by]).toEqual([
      lager.userId,
      lager.userId,
      lager.userId,
    ]);

    // One chip belongs to one sticker.
    const b = await stickerOf(lager, codes[1]!);
    const bUrl = (await get(lager, `/ops/v1/stickers/${b.id}/nfc`)).json().url;
    await post(lager, `/ops/v1/stickers/${b.id}/nfc/written`, { method: 'web_nfc' });
    expect(
      (
        await post(lager, `/ops/v1/stickers/${b.id}/nfc/verify`, {
          readUrl: bUrl,
          uid: '04a1b2c3d4e5f6',
        })
      ).json(),
    ).toMatchObject({ error: 'nfc_uid_in_use' });

    // Damaged: out of stock for good, the code never works, no more NFC steps.
    const cSticker = await stickerOf(lager, codes[2]!);
    expect(
      (await post(lager, `/ops/v1/stickers/${cSticker.id}/damaged`, { note: 'x' })).statusCode,
    ).toBe(400);
    const out = await post(lager, `/ops/v1/stickers/${cSticker.id}/damaged`, { note: 'Fehldruck' });
    expect(out.json().sticker).toMatchObject({
      status: 'revoked',
      revokeReason: 'damaged',
      ready: false,
    });
    expect((await get(lager, `/ops/v1/stickers/${cSticker.id}/nfc`)).json()).toMatchObject({
      error: 'not_in_stock',
    });
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${codes[2]}` })).statusCode).toBe(
      404,
    );

    const listed = (await get(lager, '/ops/v1/batches')).json().batches as Record<
      string,
      unknown
    >[];
    expect(listed.find((x) => x.id === batch.json().id)).toMatchObject({ ready: 1 });
  });
});

describe('stock overview and a lost batch (phase 5, 2026-11-27)', () => {
  it('counts the stock, warns below the threshold, revokes a lost batch but not packed stickers', async () => {
    await setSetting(h, 'fulfillment.mode', 'from_stock');
    const lager = await staffAs(['fulfillment']);
    const admin = await staffAs(['admin']);
    const stats = async () => (await get(lager, '/ops/v1/stickers/stats')).json();
    // The ops process has its own settings cache.
    const opsSetting = async (key: string, value: unknown) => {
      await setSetting(h, key, value);
      ops.get(SettingsService).invalidate();
    };
    const before = await stats();
    const batch = await post(lager, '/ops/v1/batches/inhouse', { quantity: 4 });
    const batchId = batch.json().id as string;
    const codes = (
      await h.app.inject({ method: 'GET', url: `/v1/dev/batches/${batchId}/codes` })
    ).json().codes as string[];
    await readySticker(lager, codes[0]!);
    await readySticker(lager, codes[1]!);
    const third = await stickerOf(lager, codes[2]!);
    await post(lager, `/ops/v1/stickers/${third.id}/nfc/written`, { method: 'nfc_tools' });

    const after = await stats();
    expect(after.ready - before.ready).toBe(2);
    expect(after.notLocked - before.notLocked).toBe(1);
    expect(after.notWritten - before.notWritten).toBe(1);
    expect(after.lowThreshold).toBe(50);

    // The warning follows the setting; the dashboard shows it to staff with tokens.manage.
    await opsSetting('stock.low_threshold', after.ready + 1);
    expect((await stats()).low).toBe(true);
    expect((await get(lager, '/ops/v1/overview')).json().stock).toEqual({
      ready: after.ready,
      low: true,
    });
    await opsSetting('stock.low_threshold', 0);
    expect((await stats()).low).toBe(false);

    // One sticker is packed; then the batch is lost: the rest stops working, the packed one not.
    const c = await customer('verloren@example.de');
    const orderId = await includedOrder(c);
    expect(
      (await post(lager, `/ops/v1/orders/${orderId}/scan`, { scanned: codes[0]! })).statusCode,
    ).toBe(200);
    // Admin only, with the explicit confirmation.
    expect(
      (await post(lager, `/ops/v1/batches/${batchId}/revoke-stock`, { confirm: true, note: 'weg' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await post(admin, `/ops/v1/batches/${batchId}/revoke-stock`, { note: 'Paket verloren' }))
        .statusCode,
    ).toBe(400);
    const lost = await post(admin, `/ops/v1/batches/${batchId}/revoke-stock`, {
      confirm: true,
      note: 'Paket verloren',
    });
    expect(lost.json()).toEqual({ revoked: 3 });
    const scan = (code: string) =>
      h.app.inject({ method: 'GET', url: `/v1/scan/${code}` }).then((r) => r.statusCode);
    expect(await scan(codes[0]!)).toBe(200);
    expect([await scan(codes[1]!), await scan(codes[2]!), await scan(codes[3]!)]).toEqual([
      404, 404, 404,
    ]);
    const final = await stats();
    expect(final.lost - after.lost).toBe(3);
    expect(final.assigned - after.assigned).toBe(1);
    expect(
      await h.db
        .selectFrom('audit_logs')
        .select('action')
        .where('actor_id', '=', admin.userId)
        .where('entity_id', '=', batchId)
        .execute(),
    ).toEqual([{ action: 'batch.revoke_stock' }]);
  });
});

describe('legal review queue (§ 356a, § 312k BGB)', () => {
  it('lists unmatched requests masked, assigns a withdrawal, needs billing.refund', async () => {
    const c = await customer('queue@example.de');
    await h.app.inject({
      method: 'POST',
      url: '/v1/legal/withdrawals',
      payload: { name: 'Q Ueue', contractRef: 'falsch@example.de', email: 'queue@example.de' },
    });
    const { id } = await h.db
      .selectFrom('withdrawal_requests')
      .select('id')
      .executeTakeFirstOrThrow();
    await h.app.get(WithdrawalsService).process(id);

    const support = await staffAs(['support']);
    expect((await get(support, '/ops/v1/legal-requests')).statusCode).toBe(403);
    const finance = await staffAs(['finance']);
    const list = (await get(finance, '/ops/v1/legal-requests')).json();
    expect(list[0]).toMatchObject({
      kind: 'withdrawal',
      status: 'needs_review',
      email: 'q•••@example.de',
    });

    const contractNo = (
      await h.db
        .selectFrom('subscriptions')
        .select('contract_no')
        .where('id', '=', c.sub.id)
        .executeTakeFirstOrThrow()
    ).contract_no!;
    expect(
      (await post(finance, `/ops/v1/legal-requests/withdrawals/${id}/assign`, { contractNo }))
        .statusCode,
    ).toBe(200);
    const sub = await h.db
      .selectFrom('subscriptions')
      .select('status')
      .where('id', '=', c.sub.id)
      .executeTakeFirstOrThrow();
    expect(sub.status).toBe('withdrawn');
    expect(
      await h.db
        .selectFrom('audit_logs')
        .select('action')
        .where('action', '=', 'withdrawal.assign')
        .where('entity_id', '=', id)
        .execute(),
    ).toHaveLength(1);
  });
});

describe('US-40 withdrawal, refunds, credit notes and promo codes (AD-12, AD-13)', () => {
  it('withdrawal within 14 days: Wertersatz for the days used, Stripe refund, credit note, contract ends', async () => {
    const c = await customer();
    // Ten whole days after the start (B4 counts whole days).
    await h.db
      .updateTable('subscriptions')
      .set({
        created_at: sql`now() - interval '10 days 1 hour'`,
        current_period_start: sql`now() - interval '10 days 1 hour'`,
      })
      .where('id', '=', c.sub.id)
      .execute();
    const finance = await staffAs(['finance']);
    const quote = await post(finance, '/ops/v1/refunds/quote', {
      kind: 'withdrawal',
      subscriptionId: c.sub.id,
    });
    expect(quote.statusCode).toBe(200);
    // 19.99 € paid, 10 days of 365 → round(1999 × 10 / 365) = 0.55 €; no sticker personalised yet.
    expect(quote.json()).toMatchObject({
      paidCents: 1999,
      daysUsed: 10,
      wertersatzCents: 55,
      decalCostCents: 0,
      refundCents: 1944,
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
    expect(sub.status).toBe('withdrawn');
    expect((await h.app.inject({ method: 'GET', url: `/v1/scan/${c.code}` })).statusCode).toBe(404);
    const mail = await lastMail(h, 'refund_issued');
    expect(mail?.text).toMatch(/19,44\s€/);
    expect(mail?.text).toMatch(
      /Gezahlt 19,99\s€ − genutzte Leistung \(10 Tage\) 0,55\s€ = Erstattung 19,44\s€/,
    );
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
        amountCents: 1944,
        kind: 'withdrawal',
      }),
    ]);
    const file = await pub(c.s, 'GET', `/v1/billing/credit-notes/${notes[0].id}/pdf`);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.rawPayload.toString('latin1')).toMatch(
      /Erstattungsbetrag \\\(brutto\\\): 19,44\s\x80/,
    ); // PDF escapes "(" and ")"
    const other = await signIn(h, 'fremd@example.de');
    expect(
      (await pub(other, 'GET', `/v1/billing/credit-notes/${notes[0].id}/pdf`)).statusCode,
    ).toBe(404);
  });

  it('keeps the personalised sticker value (§ 312g Abs. 2 Nr. 1 BGB) and refuses after the withdrawal period', async () => {
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
    // B4: personalised before the withdrawal → 3 € kept; day 0 → no service value.
    expect(q).toMatchObject({ decalCostCents: 300, wertersatzCents: 0, refundCents: 1699 });

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
      amountCents: 1800,
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json()).toMatchObject({ error: 'amount_too_high', max: 1699 });
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
    await completeProfile(h, s);
    await verifyPhone(h, s);
    const res = await pub(s, 'POST', '/v1/billing/checkout', {
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 1,
      termsVersion: 1,
      promoCode: 'PLUS3',
    });
    expect(res.json().error).toBe('promo_invalid');
  });
});

describe('US-41 settings, kill switches and provider health (AD-14–16)', () => {
  it('a kill switch needs a reason, is versioned and audited, and applies to the next alert', async () => {
    const admin = await staffAs(['admin']);
    const list = (await get(admin, '/ops/v1/settings')).json();
    const email = list.settings.find(
      (s: { key: string }) => s.key === 'channels.native_push.enabled',
    );
    expect(email).toMatchObject({ killSwitch: true, value: true, group: 'channels' });
    const url = '/ops/v1/settings/channels.native_push.enabled';
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
      reason: 'FCM-Störung',
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
    await registerAppDevice(h, 'kunde@example.de');
    await h.db
      .updateTable('qr_tokens')
      .set({ last_test_at: new Date() })
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
    expect(deliveries.find((d) => d.channel === 'native_push')).toMatchObject({
      status: 'suppressed',
      suppressed_reason: 'kill_switch',
    });

    const history = (await get(admin, `${url}/history`)).json().history;
    expect(history[0]).toMatchObject({
      old: true,
      new: false,
      reason: 'FCM-Störung',
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

  it('provider health turns critical on failing SMS and a webhook failure; the team is told once', async () => {
    const admin = await staffAs(['admin']);
    await h.db.deleteFrom('provider_status_events').execute();
    await h.db.deleteFrom('provider_health_alerts').execute();
    const c = await customer('health@example.de');
    const scan = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${c.code}/alerts`,
      remoteAddress: '198.51.100.77',
      payload: { type: 'lights_on', captcha: DEV_CAPTCHA_SOLUTION, lang: 'de' },
    });
    const alertId = scan.json().alertId as string;
    // Two of two SMS failed in the last 24 h (Twilio status callbacks "undelivered").
    await h.db
      .insertInto('alert_deliveries')
      .values(
        [1, 2].map((attempt) => ({
          alert_id: alertId,
          recipient: 'owner' as const,
          channel: 'sms' as const,
          provider: 'twilio',
          status: 'failed' as const,
          attempt,
        })),
      )
      .execute();
    expect(
      (await h.app.inject({ method: 'POST', url: '/v1/webhooks/stripe', payload: {} })).statusCode,
    ).toBe(400);

    const checks = (await get(admin, '/ops/v1/providers/health')).json().checks as {
      key: string;
      level: string;
      value: string;
    }[];
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    expect(Object.keys(by).filter((k) => k.startsWith('whatsapp'))).toEqual([]);
    expect(by['sms.failures']).toMatchObject({ level: 'critical', value: '2 / 2 (100.0 %)' });
    expect(by['app_push.failures']?.level).toBe('ok');
    expect(by['stripe.webhooks']).toMatchObject({ level: 'critical', value: '1' });
    expect(by['email.failures']?.level).toBe('ok');

    const health = ops.get(ProviderHealthService);
    expect(await health.evaluate()).toBe(2);
    const mails = (await mailbox(h)).filter((m) => m.tag === 'provider_health_alert');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('sms.failures: CRITICAL');
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

    // Two streamers at once (a slow run overlapping the next tick, or two workers): one holds the
    // cursor, the other stops, so no overlapping file is written and the chain stays intact.
    for (let i = 0; i < 3; i++) await get(admin, '/ops/v1/audit');
    const both = await Promise.all([stream.flush(5000, 0), stream.flush(5000, 0)]);
    expect(both[0]! + both[1]!).toBeGreaterThanOrEqual(3);
    expect(both.filter((n) => n > 0)).toHaveLength(1);
    expect(await stream.verify()).toMatchObject({ ok: true, problems: [] });

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
      .set({ last_test_at: new Date() })
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
    expect(revenue).toEqual([
      expect.objectContaining({ plan: 'standard', mrr_gross_cents: '167' }),
    ]);
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
    // E-mail, a device and the verified mobile number (the step that replaced trusted contacts).
    expect(score).toEqual([{ score: 75, customers: 1 }]);
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

  it('opens a ticket for visitors and recognises signed-in customers', async () => {
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
    expect(t.tags).toEqual(['topic_decal', 'lang_de', 'signed_in', 'standard', 'reply_48h']);
    // Customer and contract number, never the internal id (2026-11-22).
    const customerNo = (
      await h.db
        .selectFrom('users')
        .select('customer_no')
        .where('id', '=', c.userId)
        .executeTakeFirstOrThrow()
    ).customer_no;
    const contractNo = (
      await h.db
        .selectFrom('subscriptions')
        .select('contract_no')
        .where('user_id', '=', c.userId)
        .executeTakeFirstOrThrow()
    ).contract_no;
    expect(t.body).toContain(`Kundennummer: ${customerNo}`);
    expect(t.body).toContain(`Vertragsnummer: ${contractNo}`);
    expect(t.body).not.toContain(c.userId);
    expect((t as unknown as { fields: Record<string, unknown> }).fields).toMatchObject({
      topic: 'Aufkleber und Versand',
      customerNo,
      contractNo,
      client: 'web',
    });
    // The customer gets a short confirmation in the shared layout.
    const confirm = (await mailbox(h)).find(
      (m) => m.tag === 'support_received' && m.to === 'kunde@example.de',
    );
    expect(confirm?.subject).toMatch(/^Wir haben Ihre Nachricht erhalten \(DEV-/);
    // At most 5,000 characters.
    expect(
      (await contact({ email: 'lang@example.de', message: 'x'.repeat(5001) })).statusCode,
    ).toBe(400);
    expect(
      (await contact({ email: 'lang@example.de', message: 'x'.repeat(5000) })).statusCode,
    ).toBe(201);

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
      subscription: { plan: 'standard', status: 'active', provider: 'stripe' },
      vehicles: 1,
      protection: 50, // e-mail and the verified number (no app, decal not tested)
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
