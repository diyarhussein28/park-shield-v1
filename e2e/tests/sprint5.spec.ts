import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { API_URL, expectAccessible, signUp, sql, uniqueEmail, waitForMail } from './helpers';
const latestAlert = async (email: string) =>
  (
    await sql(
      `SELECT a.id FROM alerts a JOIN vehicles v ON v.id = a.vehicle_id JOIN users u ON u.id = v.owner_user_id
        WHERE u.email = $1 ORDER BY a.created_at DESC LIMIT 1`,
      [email],
    )
  )[0]!.id as string;

async function ownerWithVehicle(page: Page, request: APIRequestContext, email: string) {
  await signUp(page, request, email);
  await page.getByLabel(/Ich verlange ausdrücklich/).check();
  await page.getByRole('button', { name: 'Zahlungspflichtig bestellen' }).click();
  await page.getByRole('button', { name: 'Testzahlung ausführen' }).click();
  await expect(page.getByText(/^Vertragsnummer: PS-/)).toBeVisible({ timeout: 15_000 });
  await page.goto('/konto/fahrzeuge');
  await page.getByLabel('Spitzname').fill('Der Blaue');
  await page.getByLabel('Kennzeichen').fill('K-AB 1234');
  await page.getByRole('button', { name: 'Fahrzeug hinzufügen' }).click();
  await page.getByRole('link', { name: /Aufkleber und Details/ }).click();
  await page.getByRole('button', { name: 'Aufkleber testen' }).click();
  const link = page.getByRole('link', { name: 'Scan-Seite auf diesem Gerät öffnen' });
  const url = (await link.getAttribute('href'))!;
  // Use up the test window, so the next scans are real alerts.
  const own = await scanner(page.context().browser()!, url);
  await own.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(own.page.getByText('Test gesendet.', { exact: false })).toBeVisible();
  await own.ctx.close();
  return url;
}

async function scanner(
  browser: Browser,
  url: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: 'de-DE' });
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

test('friendly limit message, then guidance with the right numbers after expiry (US-17, US-18)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('limits');
  const url = await ownerWithVehicle(page, request, email);

  const { ctx, page: scan } = await scanner(browser, url);
  await scan.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(scan.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();

  // Same person (same network and browser) tries again right away from a new tab.
  const again = await scanner(browser, url);
  await again.page.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await expect(again.page.getByRole('alert')).toHaveText(
    /Sie haben dieses Fahrzeug gerade schon gewarnt\. Bitte warten Sie 1[45] Min\./,
  );
  await again.ctx.close();

  // The first alert expires unanswered; the scanner was in Austria.
  const id = await latestAlert(email);
  await sql(
    `UPDATE alerts SET scanner_country = 'AT', expires_at = now() - interval '1 minute' WHERE id = $1`,
    [id],
  );
  const guide = scan.getByRole('heading', { name: 'Was Sie jetzt tun können' });
  await expect(guide).toBeVisible({ timeout: 10_000 });
  await expect(scan.getByText('Leider keine Antwort vom Fahrer.')).toBeVisible();
  await expect(scan.getByText(/Magistrat \/ Gemeindeamt$/)).toBeVisible();
  await expect(scan.getByRole('link', { name: '133' }).first()).toHaveAttribute('href', 'tel:133');
  await expect(scan.getByRole('link', { name: '112' })).toHaveAttribute('href', 'tel:112');
  const osm = scan.getByRole('link', { name: /in der Nähe suchen/ });
  expect(await osm.getAttribute('href')).toBe(
    'https://www.openstreetmap.org/search?query=Magistrat',
  );
  await expectAccessible(scan);
  await ctx.close();
});

test('"Ich warte noch" reminds the owner once (US-18, SC-14)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('waiting');
  const url = await ownerWithVehicle(page, request, email);
  const { ctx, page: scan } = await scanner(browser, url);
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await expect(scan.getByText('Die Warnung ist beim Fahrer angekommen.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(scan.getByRole('button', { name: 'Ich warte noch' })).toBeHidden();

  // The owner acknowledged 16 minutes ago and has not arrived.
  const id = await latestAlert(email);
  await sql(
    `UPDATE alerts SET status = 'acknowledged', acknowledged_at = now() - interval '16 minutes' WHERE id = $1`,
    [id],
  );
  const wait = scan.getByRole('button', { name: 'Ich warte noch' });
  await expect(wait).toBeVisible({ timeout: 10_000 });
  await expectAccessible(scan);
  await wait.click();
  await expect(scan.getByText(/Wir haben den Fahrer erinnert\./)).toBeVisible({ timeout: 10_000 });
  await expect(wait).toBeHidden();
  const mail = await waitForMail(request, email, 'alert_followup');
  expect(mail.text).toContain('wartet noch auf Sie');
  await ctx.close();
});

test('a suspicious decal can be reported (US-19, SC-15)', async ({ page, request, browser }) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('fake');
  const url = await ownerWithVehicle(page, request, email);
  const { ctx, page: scan } = await scanner(browser, url);
  const open = scan.getByRole('button', { name: 'Aufkleber sieht verdächtig aus?' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(scan.getByText(/führen immer zu pkshd\.de/)).toBeVisible();
  await scan.getByLabel('Was ist Ihnen aufgefallen? (freiwillig)').fill('Aufkleber überklebt');
  await expectAccessible(scan);
  await scan.getByRole('button', { name: 'Meldung senden' }).click();
  await expect(scan.getByText('Danke! Unser Team prüft den Aufkleber.')).toBeVisible();
  const rows = await sql(
    `SELECT r.kind, r.note FROM abuse_reports r JOIN qr_tokens t ON t.id = r.qr_token_id
       JOIN vehicles v ON v.id = t.vehicle_id JOIN users u ON u.id = v.owner_user_id WHERE u.email = $1`,
    [email],
  );
  expect(rows).toEqual([{ kind: 'fake_decal', note: 'Aufkleber überklebt' }]);
  await ctx.close();
});

test('push devices: list, alert delivery and removal; iPhone guide (US-20)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('push');
  const url = await ownerWithVehicle(page, request, email);
  await page.goto('/konto');
  await page.getByRole('link', { name: 'Benachrichtigungen einstellen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Benachrichtigungen' })).toBeVisible();
  await expect(page.getByText('Noch kein Gerät eingerichtet.')).toBeVisible();
  await expect(page.getByText(`Warnungen gehen immer an ${email}.`)).toBeVisible();
  await expectAccessible(page);

  // A real browser push service is not reachable from CI; register the local stand-in instead,
  // exactly as the page does after pushManager.subscribe().
  const name = `ok-${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const csrf = (await page.context().cookies()).find((c) => c.name === 'ps_csrf')!.value;
  const res = await page.request.post('/v1/push-subscriptions', {
    headers: { 'x-csrf-token': csrf },
    data: {
      endpoint: `${API_URL.replace('localhost', '127.0.0.1')}/v1/dev/push/${name}`,
      keys: {
        p256dh:
          'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    },
  });
  expect(res.status()).toBe(201);
  await page.reload();
  const devices = page.getByRole('list', { name: 'Ihre Geräte' });
  await expect(devices.getByRole('listitem')).toHaveCount(1);

  const { ctx, page: scan } = await scanner(browser, url);
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await expect
    .poll(
      async () => {
        const { pushes } = (await (await request.get(`${API_URL}/v1/dev/push`)).json()) as {
          pushes: { name: string; urgency: string; ttl: string }[];
        };
        return pushes.find((p) => p.name === name);
      },
      { timeout: 15_000 },
    )
    .toMatchObject({ urgency: 'high', ttl: '7200' });
  await ctx.close();

  await page.getByRole('button', { name: /^Gerät entfernen:/ }).click();
  await expect(page.getByText('Noch kein Gerät eingerichtet.')).toBeVisible();

  // On an iPhone outside the home screen, the page explains how to add it first.
  const iphone = await browser.newContext({
    locale: 'de-DE',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await iphone.addCookies(await page.context().cookies());
  const ios = await iphone.newPage();
  await ios.goto('/konto/benachrichtigungen');
  await expect(ios.getByText('Push auf dem iPhone (ab iOS 16.4)')).toBeVisible();
  await expect(ios.getByText(/Zum Home-Bildschirm/)).toBeVisible();
  await expect(ios.getByRole('button', { name: 'Push auf diesem Gerät einschalten' })).toHaveCount(
    0,
  );
  await iphone.close();
});

test('WhatsApp: consent, code, test message, unlink (US-21)', async ({ page, request }) => {
  test.setTimeout(60_000);
  const email = uniqueEmail('wa');
  await signUp(page, request, email);
  await page.goto('/konto/benachrichtigungen');
  const phone = `0151${String(Date.now()).slice(-8)}`;
  await page.getByLabel('Handynummer').fill(phone);
  await page.getByRole('button', { name: 'Code per WhatsApp senden' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText(
    /Bitte bestätigen Sie/,
  );
  await page.getByLabel(/per WhatsApp erhalten/).check();
  await page.getByRole('button', { name: 'Code per WhatsApp senden' }).click();
  await expect(page.getByText(/Wir haben einen Code an \+49 ••• \d{4} geschickt/)).toBeVisible();

  const to = `49${phone.slice(1)}`;
  let code = '';
  await expect
    .poll(
      async () => {
        const { messages } = (await (await request.get(`${API_URL}/v1/dev/whatsapp`)).json()) as {
          messages: { to: string; template: string; params: string[] }[];
        };
        code = messages.find((m) => m.to === to && m.template === 'ps_otp')?.params[0] ?? '';
        return code;
      },
      { timeout: 10_000 },
    )
    .toMatch(/^\d{6}$/);
  await expectAccessible(page);
  await page.getByLabel('6-stelliger Code').fill(code);
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(
    page.getByText('WhatsApp ist verbunden. Wir haben Ihnen eine Testnachricht geschickt.'),
  ).toBeVisible();
  await expect(page.getByText(`Verbunden: +49 ••• ${phone.slice(-4)}`)).toBeVisible();
  const { messages } = (await (await request.get(`${API_URL}/v1/dev/whatsapp`)).json()) as {
    messages: { to: string; template: string }[];
  };
  expect(messages.find((m) => m.to === to)?.template).toBe('ps_test');

  await page.getByRole('button', { name: 'WhatsApp trennen' }).click();
  await expect(page.getByText('WhatsApp ist getrennt.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Handynummer')).toBeVisible();
});
