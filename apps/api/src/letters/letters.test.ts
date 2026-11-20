import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpsApp } from '../apps';
import { loadEnv, type Env } from '../config/env';
import type { FieldCrypto } from '../core/crypto';
import { createLogger } from '../core/logger';
import { CRYPTO, ENV } from '../core/tokens';
import { StaffService } from '../ops/staff.service';
import {
  createHarness,
  resetState,
  setSetting,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { DEFAULT_COMPANY, fill } from './company';
import { GEOMETRY, letterContent, type LetterSnapshot } from './letter';
import { renderLetterPdf, winAnsi } from './letter-pdf';
import { qrPng, qrSvg } from './qr';
import { WELCOME_LETTER_TOPIC, queueWelcomeLetterCheck } from './trigger';
import { planBenefits, WelcomeLettersService } from './welcome-letters.service';
import { createTranslator } from '@parkshield/i18n';

let h: Harness;
let ops: NestFastifyApplication;
let staff: StaffService;
let letters: WelcomeLettersService;
let crypto: FieldCrypto;
let env: Env;

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  env = h.app.get<Env>(ENV);
  letters = h.app.get(WelcomeLettersService);
  const opsEnv = loadEnv({
    MAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    TWILIO_ACCOUNT_SID: '',
    PRINT_PARTNER: '',
  });
  ops = await buildOpsApp(opsEnv, createLogger(opsEnv));
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
async function staffAs(email: string, roles: string[]): Promise<Staff> {
  const { userId } = await staff.invite(null, { email, name: email.split('@')[0]!, roles });
  const s = await staff.createSession(userId, 'Chrome · Windows');
  return {
    userId,
    headers: { cookie: `ps_ops_session=${s.token}; ps_ops_csrf=${s.csrf}`, 'x-csrf-token': s.csrf },
  };
}
const get = (s: Staff, url: string) => ops.inject({ method: 'GET', url, headers: s.headers });
const post = (s: Staff, url: string, payload: unknown = {}) =>
  ops.inject({ method: 'POST', url, headers: s.headers, payload: payload as object });

/** Runs the queued welcome-letter checks like the worker does. */
async function drain(): Promise<string[]> {
  const events = await h.db
    .selectFrom('outbox_events')
    .select(['id', 'payload'])
    .where('topic', '=', WELCOME_LETTER_TOPIC)
    .where('processed_at', 'is', null)
    .execute();
  const results: string[] = [];
  for (const e of events) {
    results.push(await letters.check(String((e.payload as { userId: string }).userId)));
    await h.db
      .updateTable('outbox_events')
      .set({ processed_at: new Date() })
      .where('id', '=', e.id)
      .execute();
  }
  return results;
}

const userId = async (email: string) =>
  (await h.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow())
    .id;

async function addVehicle(s: Session, nickname = 'Der Blaue', plate = 'K-AB 1234') {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/vehicles',
    headers: s.headers,
    payload: { nickname, plate, makeModel: 'VW Golf', color: 'Blau' },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; decal: { tokenId: string } };
}

const lettersOf = (id: string) =>
  h.db.selectFrom('welcome_letters').selectAll().where('user_id', '=', id).execute();

describe('trigger', () => {
  it('pay first, then the first vehicle: exactly one letter', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    expect(await drain()).toEqual(['waiting']); // paid, no vehicle yet
    await addVehicle(s);
    expect(await drain()).toEqual(['created']);
    await queueWelcomeLetterCheck(h.db, id); // a retried or duplicate event
    expect(await drain()).toEqual(['exists']);
    const rows = await lettersOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, status: 'new', plan: 'plus', created_by: null });
  });

  it('vehicle first, then the payment: the payment creates the letter', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    await addVehicle(s);
    // Subscription lapsed before the worker ran (e.g. re-subscription later).
    await h.db
      .updateTable('subscriptions')
      .set({ status: 'canceled' })
      .where('user_id', '=', id)
      .execute();
    expect(await drain()).toEqual(['waiting', 'waiting']);
    await h.db
      .updateTable('subscriptions')
      .set({ status: 'active' })
      .where('user_id', '=', id)
      .execute();
    await queueWelcomeLetterCheck(h.db, id); // what checkout_completed queues
    expect(await drain()).toEqual(['created']);
    expect(await lettersOf(id)).toHaveLength(1);
  });

  it('a second vehicle queues nothing; „Neu erstellen“ adds version 2', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    await addVehicle(s);
    await drain();
    await addVehicle(s, 'Der Rote', 'K-CD 5678');
    expect(await drain()).toEqual([]);
    const admin = await staffAs('admin@parkshield.de', ['admin']);
    const res = await post(admin, `/ops/v1/customers/${id}/welcome-letters`);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ version: 2, status: 'new', createdBy: admin.userId });
    expect((await lettersOf(id)).map((l) => l.version).sort()).toEqual([1, 2]);
  });
});

describe('snapshot and content', () => {
  it('is frozen: a corrected address only changes the next version', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    const v = await addVehicle(s);
    await drain();
    const [v1] = await lettersOf(id);
    const before = await letters.snapshot(v1!.id);
    // Fake Stripe billing address while no decal order exists.
    expect(before.customer.address).toMatchObject({ name: 'Erika Mustermann', city: 'Köln' });
    const pdfBefore = (await letters.pdf(v1!.id, { download: false })).file;

    const order = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/order-included`,
      headers: s.headers,
      payload: {
        address: {
          name: 'Erika Neu',
          line1: 'Neue Straße 5',
          postalCode: '10115',
          city: 'Berlin',
          country: 'DE',
        },
      },
    });
    expect(order.statusCode).toBeLessThan(300);
    await h.db.updateTable('vehicles').set({ color: 'Rot' }).where('id', '=', v.id).execute();
    const v2 = await letters.recreate(id, (await staffAs('a@parkshield.de', ['admin'])).userId);

    expect(await letters.snapshot(v1!.id)).toEqual(before);
    expect((await letters.pdf(v1!.id, { download: false })).file.equals(pdfBefore)).toBe(true);
    const after = await letters.snapshot(v2.id);
    expect(after.customer.address).toMatchObject({ name: 'Erika Neu', city: 'Berlin' });
    expect(after.vehicle).toEqual({ plate: 'K-AB 1234', description: 'VW Golf, Rot' });
  });

  it('stores the snapshot encrypted (plate and address are not readable in the row)', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    await addVehicle(s);
    await drain();
    const row = await h.db.selectFrom('welcome_letters').selectAll().executeTakeFirstOrThrow();
    const raw = row.snapshot_enc.toString('latin1');
    expect(raw).not.toContain('K-AB');
    expect(raw).not.toContain('Mustermann');
    expect(JSON.parse(crypto.decrypt(row.snapshot_enc)).vehicle.plate).toBe('K-AB 1234');
  });

  it('shows Kundennummer, Vertragsnummer, the account e-mail and the plan catalog lines', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    await addVehicle(s);
    await drain();
    const [l] = await lettersOf(id);
    const snap = await letters.snapshot(l!.id);
    const c = letterContent(snap);
    const info = Object.fromEntries(c.info);
    const sub = await h.db
      .selectFrom('subscriptions')
      .select('contract_no')
      .where('user_id', '=', id)
      .executeTakeFirstOrThrow();
    const user = await h.db
      .selectFrom('users')
      .select('customer_no')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(user.customer_no).toMatch(/^PS-\d{4}-\d{6}$/);
    expect(info.Kundennummer).toBe(user.customer_no);
    expect(info.Vertragsnummer).toBe(sub.contract_no);
    expect(info['E-Mail']).toBe('kunde@example.de');
    expect(info.Tarif).toBe('ParkShield Plus');
    expect(snap.benefits).toEqual(planBenefits('plus'));
    expect(c.blocks).toContainEqual({ kind: 'bullets', items: planBenefits('plus') });
    expect(c.greeting).toBe('Guten Tag Erika Mustermann,');
  });

  it('plan benefits come from the pricing-page catalog for every plan', () => {
    const de = createTranslator('de');
    expect(planBenefits('plus')).toEqual(
      [1, 2, 3, 4, 5, 6].map((i) => de(`landing.plusF${i}` as never)),
    );
    expect(planBenefits('premium')).toEqual(
      [1, 2, 3, 4, 5].map((i) => de(`landing.premiumF${i}` as never)),
    );
    for (const line of [...planBenefits('plus'), ...planBenefits('premium')]) {
      expect(line).not.toMatch(/^landing\./);
    }
  });
});

const SNAPSHOT: LetterSnapshot = {
  v: 1,
  date: '2026-11-18T10:00:00.000Z',
  customer: {
    customerNo: 'PS-2026-000123',
    email: 'erika@example.de',
    name: 'Erika Mustermann',
    address: {
      name: 'Erika Mustermann',
      line1: 'Musterstraße 12',
      line2: 'Hinterhaus',
      postalCode: '50667',
      city: 'Köln',
      country: 'AT',
    },
  },
  contract: {
    contractNo: 'PS-7K3M9QX2',
    plan: 'plus',
    planName: 'ParkShield Plus',
    startedAt: '2026-11-17T09:00:00.000Z',
    priceCents: 1000,
    renewalMode: 'monthly_after_first_term',
  },
  vehicle: { plate: 'K-AB 1234', description: 'VW Golf, Blau' },
  benefits: ['Bis zu 2 Fahrzeuge'],
  company: DEFAULT_COMPANY,
  companyVersion: 0,
  portalUrl: 'park-shield.de/konto',
};

describe('letter layout and PDF', () => {
  it('puts the recipient address inside the DIN 5008 window field', () => {
    const f = GEOMETRY.addressField;
    const z = GEOMETRY.addressZone;
    // DL window envelope: 90 × 45 mm window, 20 mm from the left, 45 mm from the top.
    expect(f).toEqual({ x: 20, y: 45, w: 85, h: 45 });
    expect(z.x).toBeGreaterThanOrEqual(f.x);
    expect(z.x + z.w).toBeLessThanOrEqual(f.x + f.w);
    expect(z.y).toBeGreaterThanOrEqual(f.y);
    const lines = letterContent(SNAPSHOT).addressLines;
    expect(lines).toEqual([
      'Erika Mustermann',
      'Musterstraße 12',
      'Hinterhaus',
      '50667 Köln',
      'ÖSTERREICH',
    ]);
    // Every line (incl. its descender) ends above the bottom of the window field.
    const bottom =
      z.y + 1 + (lines.length - 1) * GEOMETRY.addressLine + GEOMETRY.addressSize * 0.3528;
    expect(bottom).toBeLessThanOrEqual(f.y + f.h);
    expect(z.y + 1 + 5 * GEOMETRY.addressLine + 4).toBeLessThanOrEqual(f.y + f.h); // 6 lines fit
    // The information block starts right of the window field.
    expect(GEOMETRY.infoBlock.x).toBeGreaterThanOrEqual(f.x + f.w);
  });

  it('renders the same file for the same snapshot (PDF snapshot)', async () => {
    const images = { logoPng: null, signaturePng: null };
    const a = await renderLetterPdf({ snapshot: SNAPSHOT, images });
    const b = await renderLetterPdf({ snapshot: SNAPSHOT, images });
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a.equals(b)).toBe(true);
    const pages = a.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages.length).toBeLessThanOrEqual(2);
  });

  it('footer shows only configured fields, the USt-IdNr. always when set', () => {
    const plain = letterContent(SNAPSHOT).footer.flat();
    expect(plain).toContain('USt-IdNr.: DE454570643');
    expect(plain.some((l) => l.startsWith('IBAN'))).toBe(false);
    expect(plain.some((l) => l.startsWith('Steuernummer'))).toBe(false);
    expect(plain.some((l) => l.includes('Amtsgericht'))).toBe(false);
    const withBank = letterContent({
      ...SNAPSHOT,
      company: {
        ...DEFAULT_COMPANY,
        iban: 'DE02120300000000202051',
        bankName: 'Testbank',
        taxNumber: '230/5000/1234',
        registerCourt: 'Amtsgericht Köln',
        registerNumber: 'HRA 1',
        footer: { vatId: true, taxNumber: true, owner: false, register: true, bank: true },
      },
    }).footer.flat();
    expect(withBank).toEqual(
      expect.arrayContaining([
        'IBAN: DE02120300000000202051',
        'Steuernummer: 230/5000/1234',
        'Amtsgericht Köln, HRA 1',
      ]),
    );
    expect(withBank.some((l) => l.startsWith('Inhaber'))).toBe(false);
  });

  it('greets neutrally without a name and keeps WinAnsi-safe text', () => {
    expect(fill('Guten Tag {name},', { name: '' })).toBe('Guten Tag,');
    expect(winAnsi('Şükrü Łukasz „Golf“ 10 €')).toBe('Sükrü Lukasz „Golf“ 10 €');
  });
});

describe('QR export', () => {
  it('encodes the scanner URL (decoded with a QR reader) and keeps data off the image', async () => {
    const url = `${env.SCANNER_BASE_URL}/s/ABCDE12345`;
    const png = await qrPng({ url, caption: null }, 600);
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data).toBe(url);
    const full = await sharp(await qrPng({ url, caption: null })).metadata();
    expect([full.width, full.height]).toEqual([2000, 2000]);
    const svg = qrSvg({ url, caption: url.replace(/^https?:\/\//, '') });
    expect(svg).toContain('/s/ABCDE12345</text>');
  });

  it('one vehicle → one file, two → ZIP; revoked codes cannot be downloaded', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    const v1 = await addVehicle(s);
    const print = await staffAs('lager@parkshield.de', ['fulfillment']);
    const customerNo = (
      await h.db
        .selectFrom('users')
        .select('customer_no')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).customer_no!;

    const one = await get(print, `/ops/v1/customers/${id}/qr?format=png`);
    expect(one.statusCode).toBe(200);
    expect(one.headers['content-type']).toBe('image/png');
    expect(one.headers['content-disposition']).toBe(
      `attachment; filename="${customerNo}_01_QR.png"`,
    );
    const { data, info } = await sharp(one.rawPayload)
      .resize(500)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const token = await h.db
      .selectFrom('qr_tokens')
      .select('code_enc')
      .where('id', '=', v1.decal.tokenId)
      .executeTakeFirstOrThrow();
    const code = crypto.decrypt(token.code_enc);
    expect(jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data).toBe(
      `${env.SCANNER_BASE_URL}/s/${code}`,
    );

    const svg = await get(print, `/ops/v1/vehicles/${v1.id}/qr`);
    expect(svg.headers['content-type']).toBe('image/svg+xml');
    expect(svg.body).not.toContain('K-AB');
    expect(svg.headers['content-disposition']).not.toContain('K-AB');

    await addVehicle(s, 'Der Rote', 'K-CD 5678');
    const both = await get(print, `/ops/v1/customers/${id}/qr?format=pdf`);
    expect(both.headers['content-type']).toBe('application/zip');
    expect(both.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const names = both.rawPayload.toString('latin1');
    expect(names).toContain(`${customerNo}_01_QR.pdf`);
    expect(names).toContain(`${customerNo}_02_QR.pdf`);

    await h.db
      .updateTable('qr_tokens')
      .set({ status: 'revoked', revoked_at: new Date(), revoke_reason: 'test' })
      .where('id', '=', v1.decal.tokenId)
      .execute();
    expect((await get(print, `/ops/v1/vehicles/${v1.id}/qr`)).statusCode).toBe(404);
    const after = await get(print, `/ops/v1/customers/${id}/qr`);
    expect(after.headers['content-disposition']).toContain('_02_QR.svg');
    expect((await get(print, `/ops/v1/customers/${id}/qr?format=gif`)).statusCode).toBe(400);
  });
});

describe('back office access', () => {
  it('header data: no letter and no code until they exist', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    const admin = await staffAs('admin@parkshield.de', ['admin']);
    let view = (await get(admin, `/ops/v1/customers/${id}/welcome-letters`)).json();
    expect(view).toEqual({ letters: [], vehicles: [] });
    expect((await get(admin, `/ops/v1/customers/${id}/welcome-letter/latest.pdf`)).statusCode).toBe(
      404,
    );
    expect((await get(admin, `/ops/v1/customers/${id}/qr`)).statusCode).toBe(404);
    await addVehicle(s);
    await drain();
    view = (await get(admin, `/ops/v1/customers/${id}/welcome-letters`)).json();
    expect(view.letters).toHaveLength(1);
    expect(view.vehicles).toEqual([expect.objectContaining({ number: 1, active: true })]);
  });

  it('RBAC, status changes and an audit entry for every preview and download', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    await addVehicle(s);
    await drain();
    const [l] = await lettersOf(id);
    const support = await staffAs('support@parkshield.de', ['support']);
    const print = await staffAs('lager@parkshield.de', ['fulfillment']);

    expect((await get(support, `/ops/v1/welcome-letters/${l!.id}/pdf`)).statusCode).toBe(403);
    expect((await get(support, `/ops/v1/customers/${id}/qr`)).statusCode).toBe(403);
    expect((await post(print, `/ops/v1/customers/${id}/welcome-letters`)).statusCode).toBe(403);
    expect((await get(print, '/ops/v1/settings/company')).statusCode).toBe(403);

    const preview = await get(print, `/ops/v1/welcome-letters/${l!.id}/pdf?inline=1`);
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-disposition']).toMatch(
      /^inline; filename="PS-\d{4}-\d{6}_Willkommensbrief_v1.pdf"$/,
    );
    expect(preview.headers['cache-control']).toBe('no-store');
    expect((await letters.row(l!.id)).status).toBe('new');

    const dl = await get(print, `/ops/v1/customers/${id}/welcome-letter/latest.pdf`);
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await letters.row(l!.id)).status).toBe('downloaded');

    const sent = await ops.inject({
      method: 'PATCH',
      url: `/ops/v1/welcome-letters/${l!.id}`,
      headers: print.headers,
      payload: { status: 'sent' },
    });
    expect(sent.json()).toMatchObject({ status: 'sent' });
    await get(print, `/ops/v1/customers/${id}/qr`);

    const audit = await h.db
      .selectFrom('audit_logs')
      .select('action')
      .where('actor_id', '=', print.userId)
      .execute();
    expect(
      audit
        .map((a) => a.action)
        .filter((a) => /^(welcome_letter|qr)\./.test(a))
        .sort(),
    ).toEqual(
      [
        'qr.download',
        'welcome_letter.download',
        'welcome_letter.preview',
        'welcome_letter.sent',
      ].sort(),
    );
  });

  it('overview with status filter, batch PDF and batch „versendet“', async () => {
    const a = await subscribe(h, 'a@example.de');
    await addVehicle(a);
    const b = await subscribe(h, 'b@example.de');
    await addVehicle(b, 'Zweiter', 'B-XY 99');
    await drain();
    const admin = await staffAs('admin@parkshield.de', ['admin']);
    const list = (await get(admin, '/ops/v1/welcome-letters?status=new')).json().letters;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: 'Erika Mustermann', plan: 'plus', status: 'new' });
    expect(list[0].customerNo).toMatch(/^PS-/);
    const ids = list.map((l: { id: string }) => l.id);
    const pdf = await post(admin, '/ops/v1/welcome-letters/batch.pdf', { ids });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await get(admin, '/ops/v1/welcome-letters?status=new')).json().letters).toHaveLength(0);
    expect((await post(admin, '/ops/v1/welcome-letters/sent', { ids })).json()).toEqual({
      updated: 2,
    });
    expect((await get(admin, '/ops/v1/welcome-letters?status=sent')).json().letters).toHaveLength(
      2,
    );
  });

  it('company data is versioned; a letter keeps the version it was made with', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    const id = await userId('kunde@example.de');
    await addVehicle(s);
    await drain();
    const admin = await staffAs('admin@parkshield.de', ['admin']);
    const cur = (await get(admin, '/ops/v1/settings/company')).json();
    expect(cur.version).toBe(0);
    const put = await ops.inject({
      method: 'PUT',
      url: '/ops/v1/settings/company',
      headers: admin.headers,
      payload: { version: 0, data: { ...cur.data, phone: '+49 221 000000' } },
    });
    expect(put.json()).toMatchObject({ version: 1, data: { phone: '+49 221 000000' } });
    const stale = await ops.inject({
      method: 'PUT',
      url: '/ops/v1/settings/company',
      headers: admin.headers,
      payload: { version: 0, data: cur.data },
    });
    expect(stale.statusCode).toBe(409);
    const [v1] = await lettersOf(id);
    expect(v1!.company_version).toBe(0);
    expect((await letters.snapshot(v1!.id)).company.phone).toBe(DEFAULT_COMPANY.phone);
    const v2 = await letters.recreate(id, admin.userId);
    expect((await letters.snapshot(v2.id)).company.phone).toBe('+49 221 000000');
  });
});

describe('customer portal', () => {
  it('returns 404 while welcome_letter.in_portal is off', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    await addVehicle(s);
    await drain();
    const url = '/v1/portal/documents/welcome-letter';
    expect((await h.app.inject({ method: 'GET', url, headers: s.headers })).statusCode).toBe(404);
    await setSetting(h, 'welcome_letter.in_portal', true);
    const res = await h.app.inject({ method: 'GET', url, headers: s.headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(
      (
        await h.app.inject({ method: 'GET', url: '/v1/portal/documents', headers: s.headers })
      ).json(),
    ).toEqual({ welcomeLetter: true });
  });
});
