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

describe('included decal order (US-11)', () => {
  it('orders once per customer, with the address encrypted and a print job queued', async () => {
    const { s, v } = await setup();
    expect(
      (
        await h.app.inject({ method: 'GET', url: '/v1/orders', headers: { cookie: s.cookie } })
      ).json(),
    ).toEqual({
      orders: [],
      includedAvailable: true,
      freeReplacements: 0,
    });

    const res = await order(s, v.id);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'paid',
      included: true,
      product: 'uv_vinyl_sticker',
      nickname: 'Der Blaue',
    });

    const row = await h.db.selectFrom('decal_orders').selectAll().executeTakeFirstOrThrow();
    expect(row.shipping_address_enc.toString('latin1')).not.toContain('Domstraße');
    expect(JSON.parse(h.app.get<FieldCrypto>(CRYPTO).decrypt(row.shipping_address_enc))).toEqual(
      address,
    );
    expect(row.total_gross_cents).toBe(0);
    const events = await h.db.selectFrom('outbox_events').select(['topic', 'payload']).execute();
    expect(events).toEqual([{ topic: PRINT_TOPIC, payload: { orderId: row.id } }]);
    expect((await lastMail(h, 'order_received'))?.to).toBe('jonas@example.de');

    expect((await order(s, v.id)).json()).toEqual({ error: 'included_decal_used' });
    expect(
      (
        await h.app.inject({ method: 'GET', url: '/v1/orders', headers: { cookie: s.cookie } })
      ).json().includedAvailable,
    ).toBe(false);
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
    ).toBe('printed');

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
    ).toBe('shipped');

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

  it('does not include a second decal after re-subscribing', async () => {
    const { s, v } = await setup();
    await order(s, v.id);
    await sql`UPDATE subscriptions SET status = 'expired'`.execute(h.db);
    const again = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: s.headers,
      payload: { plan: 'plus', immediateStart: true },
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
