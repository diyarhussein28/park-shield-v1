import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  alertIdOf,
  API_URL,
  appDevice,
  escalationDue,
  expectAccessible,
  expectNoAlertMail,
  ownerWithActiveDecal,
  sql,
  uniqueEmail,
  waitForAppPush,
  waitForEscalationSms,
} from './helpers';

/**
 * Phase 2 alert photos, end to end: a scanner attaches 2 photos (one from the live camera, one through
 * the file-picker fallback), the app push carries neither photo nor link (no e-mail), the escalation
 * SMS carries only the view link, the owner sees the photos in the app (bearer session) and on the view
 * page, „Missbrauch melden“ deletes them everywhere.
 *
 * Needs the stack started with ALERT_PHOTOS_ENABLED=true (CI sets it). Locally the test is skipped with
 * a hint when the scanner page offers no photos; in CI that is a failure.
 */

const VIEW = /\/v\/([A-Za-z0-9_-]{43})/;

/**
 * A scanner phone whose camera is a canvas stream: `getUserMedia` works while `window.__psCamera` is
 * true and is refused (like a denied permission) when it is false, so the page falls back to the file
 * picker. No browser flags needed, and the scanner page itself stays unchanged.
 */
async function scannerWithCamera(browser: Browser, url: string) {
  const ctx = await browser.newContext({ locale: 'de-DE' });
  await ctx.addInitScript(() => {
    const w = window as unknown as { __psCamera: boolean };
    w.__psCamera = true;
    const getUserMedia = async () => {
      if (!w.__psCamera) throw new DOMException('denied', 'NotAllowedError');
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const g = canvas.getContext('2d')!;
      let frame = 0;
      const draw = () => {
        g.fillStyle = `hsl(${(frame++ * 9) % 360} 60% 45%)`;
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = '#fff';
        g.font = '96px sans-serif';
        g.fillText('ParkShield E2E', 80, 200);
      };
      draw();
      setInterval(draw, 100);
      return canvas.captureStream(10);
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
  });
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

/** A real JPEG from the browser's own encoder, as a phone's gallery would hand it over. */
async function galleryJpeg(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const g = c.getContext('2d')!;
    g.fillStyle = '#c33';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.fillRect(200, 300, 800, 300);
    return c.toDataURL('image/jpeg', 0.8);
  });
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

test('alert photos: 2 photos → generic push, view link in the SMS → app → „Missbrauch melden“ → gone', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('photos');
  const { url } = await ownerWithActiveDecal(page, request, email);

  // The owner's app (alerts go by app push only); the SMS after 30 minutes carries the view link.
  const app = await appDevice(request, email);

  // --- The scanner: notice first, then the live camera, then the file-picker fallback. ------------
  const { ctx, page: scan } = await scannerWithCamera(browser, url);
  const add = scan.getByRole('button', { name: 'Foto 1 hinzufügen' });
  const offered = await add
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!offered) {
    expect(process.env.CI, 'CI must start the API with ALERT_PHOTOS_ENABLED=true').toBeFalsy();
    test.skip(true, 'Start the stack with ALERT_PHOTOS_ENABLED=true to run the photo flow.');
  }

  await add.click();
  // The camera only opens after the notice is confirmed.
  await expect(
    scan.getByText(
      'Bitte fotografieren Sie nur das betroffene Fahrzeug – keine Personen oder fremden Kennzeichen.',
    ),
  ).toBeVisible();
  await expect(scan.getByRole('button', { name: 'Foto aufnehmen' })).toBeHidden();
  await scan.getByRole('button', { name: 'Verstanden' }).click();
  await scan.getByRole('button', { name: 'Foto aufnehmen' }).click();
  await expect(scan.getByText('1 von 2 Fotos ausgewählt')).toBeVisible();

  // No camera (refused): the normal file picker opens instead.
  await scan.evaluate(() => {
    (window as unknown as { __psCamera: boolean }).__psCamera = false;
  });
  const chooser = scan.waitForEvent('filechooser');
  await scan.getByRole('button', { name: 'Foto 2 hinzufügen' }).click();
  await (
    await chooser
  ).setFiles({ name: 'garage.jpg', mimeType: 'image/jpeg', buffer: await galleryJpeg(scan) });
  await expect(scan.getByText('2 von 2 Fotos ausgewählt')).toBeVisible();
  await expect(scan.getByRole('button', { name: /^Foto \d hinzufügen$/ })).toHaveCount(0);
  await expectAccessible(scan);

  await scan.getByRole('button', { name: 'Beschädigung / Parkschaden entdeckt' }).click();

  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(scan.getByText(/konnte(n)? nicht angehängt werden/)).toHaveCount(0);
  const alertId = await alertIdOf(scan);
  const [{ n: stored }] = await sql(
    `SELECT count(*)::int AS n FROM alert_media WHERE alert_id = $1 AND deleted_at IS NULL`,
    [alertId],
  );
  expect(stored).toBe(2);

  // --- The push carries no photo and no link; no e-mail at all. ---------------------------------
  const push = await waitForAppPush(request, app.fcmToken, 'alert', alertId);
  expect(push.body.message.data).toEqual({ alertId, kind: 'alert' });
  expect(JSON.stringify(push.body)).not.toMatch(/\/v\/|jpe?g|Beschädigung/i);
  await expectNoAlertMail(request, email);

  // --- 30 minutes without a reaction: one SMS with the view link, and only the link. ------------
  await escalationDue(alertId, 'sms');
  const sms = await waitForEscalationSms(request, alertId);
  const token = VIEW.exec(sms.body)?.[1];
  expect(token).toBeTruthy();
  expect(sms.body.length).toBeLessThanOrEqual(160);
  expect(sms.body).not.toMatch(/K-AB/);

  // --- The app: the photos with the app session, streamed and never cached. ----------------------
  const detail = await request.get(`${API_URL}/v1/app/alerts/${alertId}`, { headers: app.headers });
  expect(detail.status()).toBe(200);
  const shown = (await detail.json()) as {
    photos: { id: string; position: number }[];
    photoCount: number;
    photosGone: string | null;
    reported: boolean;
  };
  expect(shown).toMatchObject({ photoCount: 2, photosGone: null, reported: false });
  expect(shown.photos.map((p) => p.position)).toEqual([1, 2]);
  for (const p of shown.photos) {
    const img = await request.get(`${API_URL}/v1/app/alerts/${alertId}/media/${p.id}`, {
      headers: app.headers,
    });
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toBe('image/jpeg');
    expect(img.headers()['cache-control']).toBe('no-store');
    expect((await img.body()).subarray(0, 3).toString('hex')).toBe('ffd8ff');
  }
  // Without the session: nothing.
  const anon = await request.get(
    `${API_URL}/v1/app/alerts/${alertId}/media/${shown.photos[0]!.id}`,
  );
  expect(anon.status()).toBe(401);

  // --- The owner opens the link and reports abuse. ----------------------------------------------
  await page.goto(`/v/${token}`);
  await page.waitForLoadState('networkidle');
  const photos = page.getByRole('list', { name: 'Fotos' }).getByRole('img');
  await expect(photos).toHaveCount(2);
  await expect(photos.first()).toHaveJSProperty('complete', true);
  expect(await photos.first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Missbrauch melden' }).click();
  await expect(
    page.getByText(
      'Die Fotos und die Nachricht werden sofort gelöscht, und der Absender kann Ihr Fahrzeug nicht mehr benachrichtigen. Fortfahren?',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fotos löschen und Absender sperren' }).click();
  await expect(
    page.getByText(
      'Danke. Die Fotos wurden gelöscht und der Absender wurde für dieses Fahrzeug gesperrt.',
    ),
  ).toBeVisible();

  // --- Gone everywhere: database, app, view page; the sender is blocked for this vehicle. --------
  const rows = await sql<{
    storage_key: string | null;
    wrapped_key: Buffer | null;
    reason: string;
  }>(
    `SELECT storage_key, wrapped_key, deleted_reason AS reason FROM alert_media WHERE alert_id = $1`,
    [alertId],
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => !r.storage_key && !r.wrapped_key && r.reason === 'abuse_report')).toBe(
    true,
  );
  const after = await request.get(`${API_URL}/v1/app/alerts/${alertId}`, { headers: app.headers });
  expect(await after.json()).toMatchObject({
    photos: [],
    photoCount: 0,
    photosGone: 'abuse_report',
    reported: true,
  });
  const gone = await request.get(
    `${API_URL}/v1/app/alerts/${alertId}/media/${shown.photos[0]!.id}`,
    {
      headers: app.headers,
    },
  );
  expect(gone.status()).toBe(404);
  await page.reload();
  await expect(
    page.getByText('Sie haben diese Warnung bereits als Missbrauch gemeldet.'),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Fotos' })).toHaveCount(0);
  const [{ n: reports }] = await sql(
    `SELECT count(*)::int AS n FROM abuse_reports WHERE alert_id = $1 AND reason = 'photo_abuse'`,
    [alertId],
  );
  expect(reports).toBe(1);

  await ctx.close();
});
