import { expect, test, type Browser } from '@playwright/test';
import {
  alertIdOf,
  appDevice,
  escalationDue,
  expectAccessible,
  ownerWithActiveDecal,
  smsDeliveries,
  sql,
  uniqueEmail,
  waitForAppPush,
} from './helpers';

const deliveries = (email: string) =>
  sql<{ alert_type: string; channel: string; status: string; suppressed_reason: string | null }>(
    `SELECT a.alert_type, d.channel, d.status, d.suppressed_reason
       FROM alert_deliveries d JOIN alerts a ON a.id = d.alert_id
       JOIN vehicles v ON v.id = a.vehicle_id JOIN users u ON u.id = v.owner_user_id
      WHERE u.email = $1 AND NOT a.is_test AND d.recipient = 'owner' ORDER BY d.queued_at`,
    [email],
  );

/** Each "scanner" gets its own browser identity, so the per-scanner limit does not interfere. */
async function scanAs(browser: Browser, url: string, n: number) {
  const ctx = await browser.newContext({
    locale: 'de-DE',
    userAgent: `Mozilla/5.0 (Linux; Android 15; E2E-${n}) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36`,
  });
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

test('quiet hours mute the push of normal alerts; urgent pushes pass; never an SMS (US-26)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail('quiet');
  const url = await ownerWithActiveDecal(page, request, email);
  const app = await appDevice(request, email);
  await page.goto('/konto/benachrichtigungen');
  await page.waitForLoadState('networkidle'); // typing before hydration would be reset to the defaults
  await expect(page.getByText('Keine Ruhezeiten eingerichtet.')).toBeVisible();
  await page.getByLabel('Von').fill('00:00');
  await page.getByLabel('Bis').fill('00:00');
  await expect(
    page.getByLabel('Dringende Warnungen trotzdem per App zustellen (empfohlen)'),
  ).toBeChecked();
  await expect(page.getByText(/Während einer Ruhezeit schicken wir nie eine SMS/)).toBeVisible();
  await page.getByRole('button', { name: 'Ruhezeit hinzufügen' }).click();
  const rules = page.getByRole('list', { name: 'Ruhezeiten' });
  await expect(rules.getByRole('listitem')).toHaveText([
    /Täglich: 00:00–00:00 Uhr.*dringende Warnungen kommen trotzdem per App/,
  ]);
  await expectAccessible(page);

  const one = await scanAs(browser, url, 1);
  await one.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await one.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(one.page.getByText('Ihre Warnung wurde gesendet.')).toBeVisible();
  const two = await scanAs(browser, url, 2);
  await two.page.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await two.page.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(two.page.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  const urgent = await alertIdOf(two.page);
  await waitForAppPush(request, app.fcmToken, 'alert', urgent);
  const show = async () =>
    (await deliveries(email)).map(
      (d) => `${d.alert_type}:${d.channel}:${d.status}:${d.suppressed_reason ?? ''}`,
    );
  await expect
    .poll(show)
    .toEqual(
      expect.arrayContaining([
        'lights_on:native_push:suppressed:quiet_hours',
        'blocking:native_push:sent:',
      ]),
    );
  // The muted alert stays "sent", never "delivered": the scanner is not told about quiet hours.
  await expect(one.page.getByText('Ihre Warnung wurde gesendet.')).toBeVisible();

  // 30 minutes without a reaction: no SMS during quiet hours, not even for the urgent alert.
  const muted = await alertIdOf(one.page);
  await escalationDue(muted, 'sms');
  await escalationDue(urgent, 'sms');
  for (const id of [muted, urgent])
    await expect
      .poll(
        async () => (await smsDeliveries(id)).map((d) => `${d.status}:${d.suppressed_reason}`),
        {
          timeout: 20_000,
        },
      )
      .toEqual(['suppressed:quiet_hours']);
  await one.ctx.close();
  await two.ctx.close();

  await page.getByRole('button', { name: /^Ruhezeit entfernen:/ }).click();
  await expect(page.getByText('Keine Ruhezeiten eingerichtet.')).toBeVisible();
});

test('"Kurzer Halt" shows scanners when the driver is back (US-26, OW-17)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const url = await ownerWithActiveDecal(page, request, uniqueEmail('stop'));
  await page.reload(); // still on the vehicle page
  await expect(page.getByRole('heading', { name: 'Vorübergehender Modus' })).toBeVisible();
  await page.getByLabel(/Kurzer Halt/).check();
  await page.getByLabel('Dauer').selectOption({ label: '1 Stunde' });
  await page.getByRole('button', { name: 'Modus starten' }).click();
  const active = page.getByText(/^Kurzer Halt bis \d{2}:\d{2} Uhr$/);
  await expect(active).toBeVisible();
  const until = /bis (\d{2}:\d{2})/.exec((await active.textContent())!)![1]!;
  await expectAccessible(page);

  const scan = await scanAs(browser, url, 3);
  await expect(scan.page.getByText(`Fahrer ist gegen ${until} zurück`)).toBeVisible();
  await scan.ctx.close();

  await page.getByRole('button', { name: 'Modus beenden' }).click();
  await expect(page.getByText('Modus beendet.')).toBeVisible();
  const after = await scanAs(browser, url, 4);
  await expect(after.page.getByText(/Fahrer ist gegen/)).toHaveCount(0);
  await after.ctx.close();
});

test('protection score (e-mail, app, mobile number, decal) and summary setting (US-28, US-30)', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('score');
  await ownerWithActiveDecal(page, request, email);
  // E-mail confirmed, mobile number verified, decal tested; the app is missing: 3 of 4 steps.
  await page.goto('/konto');
  await expect(page.getByRole('heading', { name: 'Ihr Schutz' })).toBeVisible();
  await expect(page.getByText('75 % eingerichtet')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Ihr Schutz' })).toHaveAttribute(
    'aria-valuenow',
    '75',
  );
  await expect(page.getByText('Schutz unvollständig')).toBeVisible();
  await expect(page.getByText('ParkShield-App mit Mitteilungen verbinden')).toBeVisible();
  await expect(page.getByText(/Notfallkontakt|Vertrauensperson/)).toHaveCount(0);
  await expectAccessible(page);

  // The app is connected: fully protected.
  await appDevice(request, email);
  await page.reload();
  await expect(page.getByText('100 % eingerichtet')).toBeVisible();
  await expect(page.getByText('Vollständig geschützt')).toBeVisible();
  await expectAccessible(page);

  // The e-mail summary setting lives on "Abo & Konto".
  await page.goto('/konto/abo');
  await expect(page.getByLabel('Wie oft?')).toHaveValue('monthly');
  await page.getByLabel('Wie oft?').selectOption('weekly');
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Wie oft?')).toHaveValue('weekly');
});
