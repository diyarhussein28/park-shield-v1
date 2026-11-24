import { expect, test } from '@playwright/test';
import {
  addVehicle,
  API_URL,
  appOwner,
  expectAccessible,
  sql,
  staffBrowser,
  uniqueEmail,
} from './helpers';

/**
 * New code (owner decision 2026-11-24): „Neuer Code + gedruckter Aufkleber (3 €)“ is paid on Stripe's
 * page (here the fake checkout) and the payment issues the code; staff see the history in Customer 360
 * and may issue a code despite the 10-day wait.
 */
test('3 € new code through Stripe, then the history and the staff exception in Customer 360', async ({
  page,
  request,
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one run is enough (Stripe fake, ops)');
  test.setTimeout(120_000);
  const email = uniqueEmail('neuercode');
  const owner = await appOwner(request, email);
  const vehicleId = await addVehicle(request, owner);
  const order = () =>
    request.post(`${API_URL}/v1/vehicles/${vehicleId}/new-code/order`, {
      headers: owner.headers,
      data: {
        address: {
          name: 'Jonas Beispiel',
          line1: 'Domstraße 1',
          postalCode: '50667',
          city: 'Köln',
          country: 'DE',
        },
        personalizationConfirmed: true,
      },
    });

  // Inside the 10-day wait no payment page opens at all.
  const early = await order();
  expect(early.status()).toBe(409);
  expect(await early.json()).toMatchObject({ error: 'code_cooldown' });

  await sql(
    `UPDATE qr_tokens SET created_at = created_at - interval '11 days',
            assigned_at = assigned_at - interval '11 days' WHERE vehicle_id = $1`,
    [vehicleId],
  );
  await sql(
    `UPDATE code_issuances SET issued_at = issued_at - interval '11 days' WHERE vehicle_id = $1`,
    [vehicleId],
  );
  const ordered = await order();
  expect(ordered.status(), await ordered.text()).toBe(200);
  const { url } = (await ordered.json()) as { url: string };

  // Stripe's page (fake): 3,00 €, „Testzahlung ausführen“.
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/Betrag: 3,00/)).toBeVisible();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page).toHaveURL(/\/app\?order=paid$/);

  const codes = () =>
    sql<{ status: string; code_hint: string }>(
      'SELECT status, code_hint FROM qr_tokens WHERE vehicle_id = $1 ORDER BY created_at',
      [vehicleId],
    );
  await expect
    .poll(async () => (await codes()).map((c) => c.status))
    .toEqual(['revoked', 'assigned']);
  const paidHint = (await codes())[1]!.code_hint;
  const options = await request.get(`${API_URL}/v1/vehicles/${vehicleId}/new-code`, {
    headers: owner.headers,
  });
  expect(await options.json()).toMatchObject({ reason: 'cooldown', paidAvailable: false });

  // Customer 360: the history, and the exception for a stolen decal.
  const [u] = await sql('SELECT id FROM users WHERE email = $1', [email]);
  const admin = await staffBrowser(browser, 'codes', ['admin']);
  await admin.goto(`/kunden/${u.id}`);
  await admin.waitForLoadState('networkidle');
  const history = admin.getByRole('list', { name: 'Ausgestellte Codes „Der Blaue“' });
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('Bezahlt (3 € mit Aufkleber)');
  await expect(history.getByRole('listitem').first()).toContainText(paidHint);
  await expect(admin.getByText(/Neuer Code/).first()).toBeVisible();
  await expectAccessible(admin);

  await admin.getByText('Neuen Code trotz Wartezeit ausstellen').click();
  await admin
    .getByLabel('Begründung für den neuen Code')
    .fill('Aufkleber gestohlen, Anzeige liegt vor');
  await admin.getByRole('button', { name: 'Neuen Code ausstellen' }).click();
  await expect(history.getByRole('listitem')).toHaveCount(3, { timeout: 15_000 });
  await expect(history.getByRole('listitem').first()).toContainText('Ausnahme durch Mitarbeitende');
  expect((await codes()).map((c) => c.status)).toEqual(['revoked', 'revoked', 'assigned']);
  const [audit] = await sql(
    `SELECT meta FROM audit_logs WHERE action = 'qr_code.replaced' AND entity_id = $1
      AND meta->>'kind' = 'ops_override'`,
    [vehicleId],
  );
  expect(audit.meta.reason).toBe('Aufkleber gestohlen, Anzeige liegt vor');

  // Support has no such button.
  const support = await staffBrowser(browser, 'support', ['support']);
  await support.goto(`/kunden/${u.id}`);
  await support.waitForLoadState('networkidle');
  await expect(support.getByText('Neuen Code trotz Wartezeit ausstellen')).toHaveCount(0);
});
