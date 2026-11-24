import { expect, test } from '@playwright/test';
import { addVehicle, API_URL, appOwner, sql, uniqueEmail, waitForMail } from './helpers';

/**
 * Vehicle, decal design and print options through the owner API, exactly as the app's vehicle
 * screens call it (the website portal moved into the app on 2026-11-24).
 */
const ADDRESS = {
  name: 'Jonas Beispiel',
  line1: 'Domstraße 1',
  postalCode: '50667',
  city: 'Köln',
  country: 'DE',
};

test('vehicle, decal design, print options: self-print free, first shipped print free, then 3 € (US-09–US-11)', async ({
  request,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail('fahrzeug');
  const owner = await appOwner(request, email);
  const vehicleId = await addVehicle(request, owner);
  const vehicle = `${API_URL}/v1/vehicles/${vehicleId}`;

  // Designer: template + suggestion, filtered custom text.
  const design = (cta: string) =>
    request.put(`${vehicle}/decal`, {
      headers: owner.headers,
      data: { template: 'signal', cta },
    });
  expect((await design('Blockiere ich Sie? Bitte scannen')).status()).toBe(200);
  const refused = await design('Ruf an 0171 2345678');
  expect(refused.status()).toBe(400);
  expect(await refused.json()).toMatchObject({ error: 'cta_not_allowed' });
  expect((await design('Bitte kurz scannen')).status()).toBe(200);

  // „Selbst drucken – kostenlos“: PDF (80 × 80 mm with cut marks), PNG and SVG, always free.
  for (const [path, type] of [
    ['decal.pdf', 'application/pdf'],
    ['decal.png', 'image/png'],
    ['decal-download.svg', 'image/svg+xml'],
  ] as const) {
    const res = await request.get(`${vehicle}/${path}`, { headers: owner.headers });
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type']).toContain(type);
  }

  // „Drucken und zusenden lassen“: the first one is the free welcome print.
  const options = async () =>
    (await (await request.get(`${vehicle}/print-options`, { headers: owner.headers })).json()) as {
      selfPrint: { priceCents: number };
      shipped: { priceCents: number; free: boolean; welcomePrint: boolean };
    };
  expect(await options()).toMatchObject({
    selfPrint: { priceCents: 0 },
    shipped: { priceCents: 0, free: true, welcomePrint: true },
  });
  // Part B: the order needs the personalisation confirmation step.
  const unconfirmed = await request.post(`${vehicle}/order-print`, {
    headers: owner.headers,
    data: { address: ADDRESS },
  });
  expect(unconfirmed.status()).toBe(400);
  const ordered = await request.post(`${vehicle}/order-print`, {
    headers: owner.headers,
    data: { address: ADDRESS, personalizationConfirmed: true },
  });
  expect(ordered.status(), await ordered.text()).toBe(200);
  expect(await ordered.json()).toMatchObject({ free: true });
  await waitForMail(request, email, 'order_received');

  const orders = async () =>
    (
      (await (await request.get(`${API_URL}/v1/orders`, { headers: owner.headers })).json()) as {
        orders: { id: string; status: string; trackingNumber?: string | null }[];
      }
    ).orders;
  await expect
    .poll(async () => (await orders())[0]?.status, {
      timeout: 20_000,
      message: 'worker submits the print job',
    })
    .toBe('in_production');
  const orderId = (await orders())[0]!.id;
  const [welcome] = await sql<{ total_gross_cents: number; included_in_plan: boolean }>(
    'SELECT total_gross_cents, included_in_plan FROM decal_orders WHERE id = $1',
    [orderId],
  );
  expect(welcome).toEqual({ total_gross_cents: 0, included_in_plan: true });

  const shippedRes = await request.post(`${API_URL}/v1/dev/print/${orderId}/ship`, {
    data: { trackingNumber: '00340434161234567890' },
  });
  expect(shippedRes.ok()).toBe(true);
  const mail = await waitForMail(request, email, 'decal_shipped');
  expect(mail.text).toContain('00340434161234567890');

  // The next shipped print costs 3 € (one-time payment); self-printing stays free.
  expect(await options()).toMatchObject({
    selfPrint: { priceCents: 0 },
    shipped: { priceCents: 300, free: false, welcomePrint: false },
  });
  const paid = await request.post(`${vehicle}/order-print`, {
    headers: owner.headers,
    data: { address: ADDRESS, personalizationConfirmed: true },
  });
  expect(paid.status(), await paid.text()).toBe(200);
  const { url, free } = (await paid.json()) as { url: string; free: boolean };
  expect(free).toBe(false);
  const sessionId = new URL(url).searchParams.get('session');
  expect(sessionId).toMatch(/^cs_fake_/);
  const session = await request.get(`${API_URL}/v1/dev/payments/sessions/${sessionId}`);
  expect(((await session.json()) as { amountCents: number }).amountCents).toBe(300);
  const done = await request.post(`${API_URL}/v1/dev/payments/complete`, { data: { sessionId } });
  expect(done.status()).toBe(200);
  await expect
    .poll(
      async () =>
        (
          await sql<{ status: string }>(
            `SELECT status FROM decal_orders
              WHERE user_id = (SELECT id FROM users WHERE email = $1)
                AND paid_print AND total_gross_cents = 300`,
            [email],
          )
        ).map((r) => r.status),
      { timeout: 20_000, message: 'the paid print order is paid and goes to the printer' },
    )
    .toEqual([expect.stringMatching(/^(paid|in_production)$/)]);
});

test('one vehicle per account: the API refuses a second (US-09)', async ({ request }) => {
  const owner = await appOwner(request, uniqueEmail('limit'));
  await addVehicle(request, owner, { nickname: 'Erstes', plate: 'K-A 1' });
  const second = await request.post(`${API_URL}/v1/vehicles`, {
    headers: owner.headers,
    data: { nickname: 'Zweites', plate: 'K-A 2' },
  });
  expect(second.status()).toBe(409);
  expect(await second.json()).toMatchObject({ error: 'vehicle_limit', limit: 1 });
});

test('failed renewal marks the subscription past due (US-08)', async ({ request }) => {
  const email = uniqueEmail('dunning');
  const owner = await appOwner(request, email);
  const res = await request.post(`${API_URL}/v1/dev/payments/fail`, { data: { email } });
  expect(res.ok()).toBe(true);
  await waitForMail(request, email, 'payment_failed');
  const sub = await request.get(`${API_URL}/v1/billing/subscription`, { headers: owner.headers });
  expect(((await sub.json()) as { subscription: { status: string } }).subscription.status).toBe(
    'past_due',
  );
});
