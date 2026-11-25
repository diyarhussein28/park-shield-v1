import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import {
  addVehicle,
  alertIdOf,
  appDevice,
  appOwner,
  expectAccessible,
  expectNoAlertMail,
  API_URL,
  sql,
  uniqueEmail,
  waitForAppPush,
} from './helpers';

/** A paying owner (through the app's API) with „Der Blaue“, blue. */
async function ownerWithVehicle(request: APIRequestContext, email: string) {
  const owner = await appOwner(request, email);
  const vehicleId = await addVehicle(request, owner);
  const color = await request.patch(`${API_URL}/v1/vehicles/${vehicleId}`, {
    headers: owner.headers,
    data: { color: 'Blau' },
  });
  expect(color.status(), await color.text()).toBe(200);
  return { ...owner, vehicleId };
}

/** „Aufkleber testen“: opens the test window and returns the decal's scan URL. */
async function testWindowUrl(
  request: APIRequestContext,
  owner: { headers: Record<string, string>; vehicleId: string },
): Promise<string> {
  const r = await request.post(`${API_URL}/v1/vehicles/${owner.vehicleId}/test-window`, {
    headers: owner.headers,
  });
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { scanUrl: string }).scanUrl;
}

/** A stranger's phone: fresh context, no cookies, German. */
async function scannerPage(browser: Browser, url: string, locale = 'de-DE') {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  const res = await page.goto(url);
  return { ctx, page, res: res! };
}

test('owner test scan activates the decal, then a stranger scans (US-12, US-14, US-16)', async ({
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('scan');
  const owner = await ownerWithVehicle(request, email);
  const app = await appDevice(request, email);
  const url = await testWindowUrl(request, owner);
  expect(url).toMatch(/\/s\/[0-9A-HJKMNP-TV-Z]{10}$/);

  // Owner's own test scan.
  const test1 = await scannerPage(browser, url);
  await expect(test1.page.getByText(/Testmodus/)).toBeVisible();
  await test1.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await test1.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(test1.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  // The test reaches the owner's app like a real alert (push only, no e-mail).
  await waitForAppPush(request, app.fcmToken, 'test', await alertIdOf(test1.page));
  // „Zuletzt erfolgreich getestet am …“ on the vehicle screen.
  const [tested] = await sql(
    `SELECT last_test_at FROM qr_tokens WHERE vehicle_id = $1 AND status <> 'revoked'`,
    [owner.vehicleId],
  );
  expect(tested.last_test_at).not.toBeNull();
  await test1.ctx.close();

  // A stranger: no cookies, strict CSP, small page, accessible in light and dark.
  const { ctx, page: scan, res } = await scannerPage(browser, url);
  expect(res.status()).toBe(200);
  const csp = res.headers()['content-security-policy']!;
  expect(csp).toContain("default-src 'none'");
  expect(csp).toMatch(/script-src 'sha256-[^']+'/);
  expect(res.headers()['set-cookie']).toBeUndefined();
  // Whole page incl. inline JS, CSS, SVG icons and both languages' texts (~21 KB compressed). Raised
  // from 55 KB for the redesign (2026-11-21); the hard budget is 90 KB (AGENTS.md §7).
  expect((await res.body()).length).toBeLessThan(80_000);
  await expect(scan.getByRole('heading', { level: 1 })).toHaveText('Was ist los?');
  await expect(scan.getByText('„Der Blaue“')).toBeVisible();
  await expect(scan.getByText('Blau', { exact: true })).toBeVisible();
  await expect(scan.getByText('Nur echt auf park-shield.de')).toBeVisible();
  await expect(scan.getByText('ParkShield verlangt nie eine Zahlung.')).toBeVisible();
  await expect(scan.getByText(/K-AB|1234/)).toHaveCount(0);
  await expectAccessible(scan);
  await scan.emulateMedia({ colorScheme: 'dark' });
  await expectAccessible(scan);
  for (const b of await scan.locator('.type').all())
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(48);

  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();

  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  // App push only, generic: the alert id and the kind, never the problem, plate or nickname.
  const push = await waitForAppPush(request, app.fcmToken, 'alert', await alertIdOf(scan));
  expect(push.body.message.data).toEqual({ alertId: await alertIdOf(scan), kind: 'alert' });
  expect(JSON.stringify(push.body)).not.toMatch(/versperrt|Der Blaue|K-AB|1234/);
  await expectNoAlertMail(request, email);

  // Survives a reload in the same session; language switches in place; no cookies were ever set.
  await scan.reload();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible();
  await scan.getByRole('button', { name: /EN/ }).click();
  await expect(scan.getByText('The vehicle owner has been notified.')).toBeVisible();
  await expect(scan.locator('html')).toHaveAttribute('lang', 'en');
  expect(await ctx.cookies()).toEqual([]);
  await ctx.close();
});

test('custom messages are filtered before they are sent (US-15)', async ({ request, browser }) => {
  const email = uniqueEmail('text');
  const owner = await ownerWithVehicle(request, email);
  const app = await appDevice(request, email);
  const url = await testWindowUrl(request, owner);
  const own = await scannerPage(browser, url); // use up the test window first
  await own.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await own.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(own.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  await own.ctx.close();

  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Eigene Nachricht' }).click();
  await scan.getByLabel('Ihre Nachricht').fill('Ruf mich an: 0171 2345678');
  await expect(scan.getByText(/von 280 Zeichen/)).toBeVisible();
  await scan.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(scan.getByRole('alert')).toContainText('Diese Nachricht können wir nicht senden');
  await scan.getByLabel('Ihre Nachricht').fill('Ihr Kofferraum steht offen');
  await scan.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  // The text reaches the owner only inside the app (never in the push payload, never by e-mail).
  const alertId = await alertIdOf(scan);
  const push = await waitForAppPush(request, app.fcmToken, 'alert', alertId);
  expect(JSON.stringify(push.body)).not.toContain('Kofferraum');
  const detail = (await (
    await request.get(`${API_URL}/v1/app/alerts/${alertId}`, { headers: app.headers })
  ).json()) as { message: string | null };
  expect(detail.message).toBe('Ihr Kofferraum steht offen');
  await expectNoAlertMail(request, email);
  await ctx.close();
});

test('„Sperren“ makes the old decal inactive and creates no new code; the first lock gets a free new code at once, later ones wait 10 days (US-13, SC-07)', async ({
  request,
  browser,
}) => {
  const email = uniqueEmail('revoke');
  const owner = await ownerWithVehicle(request, email);
  const oldUrl = await testWindowUrl(request, owner);
  const tokens = () =>
    sql<{ status: string }>(
      `SELECT t.status FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
        WHERE v.owner_user_id = (SELECT id FROM users WHERE email = $1) ORDER BY t.created_at`,
      [email],
    );
  expect((await tokens()).map((t) => t.status)).toEqual(['assigned']);

  // „Ja, Code jetzt sperren“ in the app's dialog: the code stops at once, no new one is created.
  const revoke = await request.post(`${API_URL}/v1/vehicles/${owner.vehicleId}/tokens/revoke`, {
    headers: owner.headers,
    data: { confirm: true, reason: 'leaked' },
  });
  expect(revoke.status(), await revoke.text()).toBe(200);
  expect((await tokens()).map((t) => t.status)).toEqual(['revoked']);
  const test = await request.post(`${API_URL}/v1/vehicles/${owner.vehicleId}/test-window`, {
    headers: owner.headers,
  });
  expect(test.status()).toBeGreaterThanOrEqual(400);

  const { ctx, page: scan, res } = await scannerPage(browser, oldUrl);
  expect(res.status()).toBe(404);
  await expect(scan.getByRole('heading', { level: 1 })).toHaveText(
    'Dieser Aufkleber ist nicht aktiv',
  );
  await expectAccessible(scan);
  await ctx.close();

  // The first „Sperren“ of the first code is an exception (owner, 2026-11-25): a new code at once,
  // free once per subscription year. Every later new code waits 10 days after the newest one.
  const newCode = () =>
    request.post(`${API_URL}/v1/vehicles/${owner.vehicleId}/tokens`, { headers: owner.headers });
  const options = async () =>
    (await (
      await request.get(`${API_URL}/v1/vehicles/${owner.vehicleId}/new-code`, {
        headers: owner.headers,
      })
    ).json()) as { freeAvailable: boolean; reason: string | null; nextEligibleAt: string | null };
  expect(await options()).toMatchObject({
    freeAvailable: true,
    reason: null,
    nextEligibleAt: null,
  });
  const created = await newCode();
  expect(created.status(), await created.text()).toBe(201);
  expect((await tokens()).map((t) => t.status)).toEqual(['revoked', 'assigned']);
  const newUrl = await testWindowUrl(request, owner);
  expect(newUrl).not.toBe(oldUrl);

  // Locked again right away: now the 10-day wait applies and the app shows the date.
  const again = await request.post(`${API_URL}/v1/vehicles/${owner.vehicleId}/tokens/revoke`, {
    headers: owner.headers,
    data: { confirm: true, reason: 'leaked' },
  });
  expect(again.status(), await again.text()).toBe(200);
  const waiting = await options();
  expect(waiting).toMatchObject({ freeAvailable: false, reason: 'cooldown' });
  expect(waiting.nextEligibleAt).not.toBeNull();
  const early = await newCode();
  expect(early.status()).toBe(409);
  expect(await early.json()).toMatchObject({ error: 'code_cooldown' });
  await sql(
    `UPDATE qr_tokens SET created_at = created_at - interval '11 days',
            assigned_at = assigned_at - interval '11 days' WHERE vehicle_id = $1`,
    [owner.vehicleId],
  );
  await sql(
    `UPDATE code_issuances SET issued_at = issued_at - interval '11 days' WHERE vehicle_id = $1`,
    [owner.vehicleId],
  );
  // The free one of this subscription year is used: the next code comes with the 3 € print.
  expect(await options()).toMatchObject({ freeAvailable: false, reason: 'free_used' });
  const third = await newCode();
  expect(third.status()).toBe(402);
});
