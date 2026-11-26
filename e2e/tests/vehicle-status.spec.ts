import { expect, test, type Page } from '@playwright/test';
import {
  API_URL,
  appDevice,
  expectAccessible,
  ownerWithActiveDecal,
  scannerPage,
  sql,
  uniqueEmail,
  waitForAppPush,
} from './helpers';

/**
 * „Bin gleich zurück“ (owner spec 2026-11-26) end to end on the real scan page: the owner's status
 * message first (DE and EN), the countdown, „Ich warte“ once, the owner's „Ich komme“ live, a custom
 * text shown literally, nothing stored on the scanner's phone.
 *
 * Needs the stack started with VEHICLE_STATUS_ENABLED=true (CI sets it). Locally the test is skipped
 * with a hint when the API says the feature is off.
 */

/** Optional screenshots for the hand-over (PS_SHOTS_DIR=…). */
async function shot(page: Page, name: string) {
  const dir = process.env.PS_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test('status message, „Ich warte“ and the live reply', async ({ page, request, browser }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'one run is enough (global alert limits)');
  const email = uniqueEmail('brb');
  const owner = await ownerWithActiveDecal(page, request, email);
  const device = await appDevice(request, email);
  const status = await request.get(`${API_URL}/v1/vehicles/${owner.vehicleId}/status`, {
    headers: owner.headers,
  });
  const { enabled } = (await status.json()) as { enabled: boolean };
  test.skip(!enabled && !process.env.CI, 'start the stack with VEHICLE_STATUS_ENABLED=true');
  expect(enabled).toBe(true);

  // Two taps in the app: the button, then „Aktivieren“ with the defaults (first preset, 10 min).
  const put = await request.put(`${API_URL}/v1/vehicles/${owner.vehicleId}/status`, {
    headers: owner.headers,
    data: { presetKey: 'BACK_FEW_MIN', durationMin: 10 },
  });
  expect(put.status(), await put.text()).toBe(200);

  const de = await scannerPage(browser, owner.url);
  const card = de.page.locator('#brb');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Nachricht vom Fahrzeughalter');
  await expect(card).toContainText('Bin in wenigen Minuten zurück.');
  await expect(card).toContainText(/Zurück in ca\. (9|10) Min/);
  // Everything below stays as without a status.
  await expect(de.page.getByRole('button', { name: 'Licht brennt noch' })).toBeVisible();
  await expect(de.page.getByRole('button', { name: 'Warnung senden' })).toBeVisible();
  await expectAccessible(de.page);
  await shot(de.page, 'scan-de');

  await de.page.getByRole('button', { name: 'EN – English' }).click();
  await expect(card).toContainText('Message from the vehicle owner');
  await expect(card).toContainText('Back in a few minutes.');
  await expect(card).toContainText(/Back in about (9|10) min/);
  await shot(de.page, 'scan-en');
  await de.page.getByRole('button', { name: 'DE – Deutsch' }).click();

  await de.page.getByRole('button', { name: 'Ich warte', exact: true }).click();
  await expect(de.page.locator('#brb-done')).toHaveText(
    'Der Fahrzeughalter wurde benachrichtigt. Falls es dringend ist, können Sie unten eine Warnung senden.',
  );
  await shot(de.page, 'scan-waiting-done');
  const push = await waitForAppPush(request, device.fcmToken, 'alert');
  expect(push.body.message.notification.body).toBe('Jemand wartet an Ihrem Fahrzeug.');
  expect(JSON.stringify(push)).not.toContain('K-AB');
  expect(JSON.stringify(push)).not.toContain('Der Blaue');

  // A second tap shows the confirmation again and sends nothing.
  await de.page.getByRole('button', { name: 'Ich warte', exact: true }).click();
  await expect(de.page.locator('#brb-done')).toBeVisible();
  const waits = await sql<{ n: string }>(
    `SELECT count(*)::text AS n FROM alerts WHERE vehicle_id = $1 AND alert_type = 'waiting'`,
    [owner.vehicleId],
  );
  expect(waits[0]!.n).toBe('1');

  // The owner answers „Ich komme“ in the app; the scanner sees it live.
  const alertId = push.body.message.data.alertId!;
  const ack = await request.post(`${API_URL}/v1/app/alerts/${alertId}/ack`, {
    headers: owner.headers,
    data: { reply: 'coming' },
  });
  expect(ack.status(), await ack.text()).toBe(200);
  await expect(de.page.locator('#brb-done')).toHaveText('Der Fahrzeughalter ist unterwegs.', {
    timeout: 15_000,
  });

  // Nothing stored on the scanner's phone (§ 25 TDDDG).
  expect(await de.ctx.cookies()).toEqual([]);
  expect(await de.page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await de.ctx.close();

  // A custom message is plain text, exactly as written.
  const custom = await request.put(`${API_URL}/v1/vehicles/${owner.vehicleId}/status`, {
    headers: owner.headers,
    data: { customText: 'Hole nur <b>kurz</b> die Post.', durationMin: 5 },
  });
  expect(custom.status(), await custom.text()).toBe(200);
  const again = await scannerPage(browser, owner.url);
  await expect(again.page.locator('#brb-msg')).toHaveText('Hole nur <b>kurz</b> die Post.');
  await expect(again.page.locator('#brb-msg b')).toHaveCount(0);

  // „Beenden“: the page is exactly the normal one again.
  const end = await request.delete(`${API_URL}/v1/vehicles/${owner.vehicleId}/status`, {
    headers: owner.headers,
  });
  expect(end.status()).toBe(200);
  await again.page.reload();
  await expect(again.page.locator('#brb')).toHaveCount(0);
  await again.ctx.close();
});
