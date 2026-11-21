import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import {
  createHarness,
  lastMail,
  PRINT_DIR,
  resetState,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { OrdersService, PRINT_TOPIC } from './orders.service';
import { WELCOME_LETTER_TOPIC } from '../letters/trigger';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const address = {
  name: 'Jonas Beispiel',
  line1: 'Domstraße 1',
  postalCode: '50667',
  city: 'Köln',
  country: 'DE',
};

async function setup(email = 'jonas@example.de') {
  const s = await subscribe(h, email);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
    })
  ).json();
  return { s, v };
}
const order = (s: Session, vehicleId: string, payload: Record<string, unknown> = { address }) =>
  h.app.inject({
    method: 'POST',
    url: `/v1/vehicles/${vehicleId}/order-included`,
    headers: s.headers,
    payload,
  });

describe('printed decal orders (US-11, single plan since 2026-11-21)', () => {
  it('the first shipped print is free, every further one costs 3 € by Stripe', async () => {
    const { s, v } = await setup();
    const orders = () =>
      h.app
        .inject({ method: 'GET', url: '/v1/orders', headers: { cookie: s.cookie } })
        .then((r) => r.json());
    const options = () =>
      h.app
        .inject({
          method: 'GET',
          url: `/v1/vehicles/${v.id}/print-options`,
          headers: { cookie: s.cookie },
        })
        .then((r) => r.json());
    expect(await orders()).toEqual({
      orders: [],
      includedAvailable: true,
      freeReplacements: 0,
      printPriceCents: 300,
    });
    expect(await options()).toEqual({
      selfPrint: { priceCents: 0 },
      shipped: { priceCents: 0, free: true, welcomePrint: true },
    });

    const res = await order(s, v.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ id: expect.any(String), free: true });

    const row = await h.db.selectFrom('decal_orders').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'paid', total_gross_cents: 0, included_in_plan: true });
    expect(row.shipping_address_enc.toString('latin1')).not.toContain('Domstraße');
    expect(JSON.parse(h.app.get<FieldCrypto>(CRYPTO).decrypt(row.shipping_address_enc))).toEqual(
      address,
    );
    const events = await h.db
      .selectFrom('outbox_events')
      .select(['topic', 'payload'])
      .where('topic', '<>', WELCOME_LETTER_TOPIC)
      .execute();
    expect(events).toEqual([{ topic: PRINT_TOPIC, payload: { orderId: row.id } }]);
    expect((await lastMail(h, 'order_received'))?.to).toBe('jonas@example.de');
    expect((await orders()).includedAvailable).toBe(false);
    expect(await options()).toEqual({
      selfPrint: { priceCents: 0 },
      shipped: { priceCents: 300, free: false, welcomePrint: false },
    });

    // The second print: a Stripe one-time checkout over 3 €, printed only after payment.
    const second = await h.app.inject({
      method: 'POST',
      url: `/v1/vehicles/${v.id}/order-print`,
      headers: s.headers,
      payload: { address },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toMatchObject({ free: false, url: expect.stringContaining('session=') });
    const paid = await h.db
      .selectFrom('decal_orders')
      .select(['status', 'total_gross_cents', 'paid_print'])
      .where('id', '=', second.json().id)
      .executeTakeFirstOrThrow();
    expect(paid).toEqual({ status: 'pending_payment', total_gross_cents: 300, paid_print: true });
    const sessionId = new URL(second.json().url).searchParams.get('session')!;
    const session = (
      await h.app.inject({ method: 'GET', url: `/v1/dev/payments/sessions/${sessionId}` })
    ).json();
    expect(session.amountCents).toBe(300);
    const printJobs = () =>
      h.db.selectFrom('outbox_events').select('id').where('topic', '=', PRINT_TOPIC).execute();
    expect(await printJobs()).toHaveLength(1);
    await h.app.inject({
      method: 'POST',
      url: '/v1/dev/payments/complete',
      payload: { sessionId },
    });
    expect(
      (
        await h.db
          .selectFrom('decal_orders')
          .select('status')
          .where('id', '=', second.json().id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('paid');
    expect(await printJobs()).toHaveLength(2);
  });

  it('a replacement granted by ops is free before the 3 € price applies', async () => {
    const { s, v } = await setup();
    await order(s, v.id);
    await h.db.updateTable('users').set({ free_replacements: 1 }).execute();
    const granted = await order(s, v.id);
    expect(granted.json()).toMatchObject({ free: true });
    expect((await order(s, v.id)).json()).toMatchObject({ free: false });
    const rows = await h.db
      .selectFrom('decal_orders')
      .select(['total_gross_cents', 'is_replacement'])
      .orderBy('created_at')
      .execute();
    expect(rows.map((r) => r.total_gross_cents)).toEqual([0, 0, 300]);
  });

  it('printing at home (the PDF) is always free and orders nothing', async () => {
    const { s, v } = await setup();
    await order(s, v.id); // the free print is used up
    const pdf = await h.app.inject({
      method: 'GET',
      url: `/v1/vehicles/${v.id}/decal.pdf`,
      headers: { cookie: s.cookie },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await h.db.selectFrom('decal_orders').select('id').execute()).toHaveLength(1);
  });

  it('validates the shipping address', async () => {
    const { s, v } = await setup();
    expect((await order(s, v.id, { address: { ...address, postalCode: '5066' } })).statusCode).toBe(
      400,
    );
    expect((await order(s, v.id, { address: { ...address, country: 'FR' } })).statusCode).toBe(400);
  });

  it('prints, ships with tracking e-mail, delivers, and drops the address after 90 days', async () => {
    const { s, v } = await setup();
    const { id } = (await order(s, v.id)).json();

    await h.app.get(OrdersService).submitToPrinter(id);
    const printed = await h.db
      .selectFrom('decal_orders')
      .select(['status', 'print_partner_ref'])
      .executeTakeFirstOrThrow();
    expect(printed.status).toBe('in_production');
    const files = await readdir(PRINT_DIR);
    expect(files).toContain(`${printed.print_partner_ref}.pdf`);
    const ticket = JSON.parse(
      await readFile(join(PRINT_DIR, `${printed.print_partner_ref}.json`), 'utf8'),
    );
    expect(ticket).toMatchObject({ orderId: id, product: 'uv_vinyl_sticker', address });
    expect(
      (await readFile(join(PRINT_DIR, `${printed.print_partner_ref}.pdf`)))
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    expect(
      (await h.db.selectFrom('qr_tokens').select('status').executeTakeFirstOrThrow()).status,
    ).toBe('assigned'); // shipping state lives on the order, the tag stays assigned

    await h.app.get(OrdersService).submitToPrinter(id); // replayed job: no second submission
    expect(files.length).toBe((await readdir(PRINT_DIR)).length);

    const ship = await h.app.inject({
      method: 'POST',
      url: `/v1/dev/print/${id}/ship`,
      payload: { trackingNumber: '00340434161234567890' },
    });
    expect(ship.statusCode).toBe(200);
    const mail = await lastMail(h, 'decal_shipped');
    expect(mail?.text).toContain('00340434161234567890');
    expect(
      (await h.db.selectFrom('qr_tokens').select('status').executeTakeFirstOrThrow()).status,
    ).toBe('assigned');

    await h.app.inject({ method: 'POST', url: `/v1/dev/print/${id}/deliver` });
    const list = (
      await h.app.inject({ method: 'GET', url: '/v1/orders', headers: { cookie: s.cookie } })
    ).json();
    expect(list.orders[0]).toMatchObject({
      status: 'delivered',
      trackingNumber: '00340434161234567890',
    });

    await sql`UPDATE decal_orders SET delivered_at = now() - interval '91 days'`.execute(h.db);
    await sql`SELECT run_retention()`.execute(h.db);
    const after = await h.db
      .selectFrom('decal_orders')
      .select('shipping_address_enc')
      .executeTakeFirstOrThrow();
    expect(after.shipping_address_enc.length).toBe(0);
  });

  it('does not include a second free print after re-subscribing', async () => {
    const { s, v } = await setup();
    await order(s, v.id);
    await sql`UPDATE subscriptions SET status = 'expired'`.execute(h.db);
    const again = await h.app.inject({
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
    const sessionId = new URL(again.json().url).searchParams.get('session')!;
    await h.app.inject({
      method: 'POST',
      url: '/v1/dev/payments/complete',
      payload: { sessionId },
    });
    const list = (
      await h.app.inject({ method: 'GET', url: '/v1/orders', headers: { cookie: s.cookie } })
    ).json();
    expect(list.includedAvailable).toBe(false);
  });
});
