import { expect, test, type Browser } from '@playwright/test';
import { expectAccessible, ownerWithActiveDecal, sql, uniqueEmail } from './helpers';

const deliveries = (email: string) =>
  sql<{ alert_type: string; status: string; suppressed_reason: string | null }>(
    `SELECT a.alert_type, d.status, d.suppressed_reason
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

test('quiet hours mute normal alerts; urgent ones still come through (US-26)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail('quiet');
  const url = await ownerWithActiveDecal(page, request, email);
  await page.goto('/konto/benachrichtigungen');
  await page.waitForLoadState('networkidle'); // typing before hydration would be reset to the defaults
  await expect(page.getByText('Keine Ruhezeiten eingerichtet.')).toBeVisible();
  await page.getByLabel('Von').fill('00:00');
  await page.getByLabel('Bis').fill('00:00');
  await expect(page.getByLabel('Dringende Warnungen trotzdem zustellen (empfohlen)')).toBeChecked();
  await page.getByRole('button', { name: 'Ruhezeit hinzufügen' }).click();
  const rules = page.getByRole('list', { name: 'Ruhezeiten' });
  await expect(rules.getByRole('listitem')).toHaveText([
    /Täglich: 00:00–00:00 Uhr.*dringende Warnungen kommen trotzdem/,
  ]);
  await expectAccessible(page);

  const one = await scanAs(browser, url, 1);
  await one.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(one.page.getByText('Ihre Warnung wurde gesendet.')).toBeVisible();
  const two = await scanAs(browser, url, 2);
  await two.page.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await expect(two.page.getByText('Die Warnung ist beim Fahrer angekommen.')).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () =>
      (await deliveries(email)).map(
        (d) => `${d.alert_type}:${d.status}:${d.suppressed_reason ?? ''}`,
      ),
    )
    .toEqual(expect.arrayContaining(['lights_on:suppressed:quiet_hours', 'blocking:sent:']));
  // The muted alert stays "sent", never "delivered": the scanner is not told about quiet hours.
  await expect(one.page.getByText('Ihre Warnung wurde gesendet.')).toBeVisible();
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

test('protection score, summary setting and escalation delay (US-28, US-30, OW-07)', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await ownerWithActiveDecal(page, request, uniqueEmail('score'));
  await page.goto('/konto');
  await expect(page.getByRole('heading', { name: 'Ihr Schutz' })).toBeVisible();
  // E-mail confirmed and decal tested: 2 of 4 steps.
  await expect(page.getByText('50 % eingerichtet')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Ihr Schutz' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await expect(page.getByText('Schutz unvollständig')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notfallkontakt einladen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Aufkleber testen' })).toHaveCount(0);

  await expect(page.getByLabel('Wie oft?')).toHaveValue('monthly');
  await page.getByLabel('Wie oft?').selectOption('weekly');
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  await expectAccessible(page);
  await page.reload();
  await expect(page.getByLabel('Wie oft?')).toHaveValue('weekly');

  await page.getByRole('link', { name: 'Notfallkontakt einladen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Wann benachrichtigen wir den Kontakt?' }),
  ).toBeVisible();
  await page.getByLabel('Wenn Sie nicht reagieren, nach').selectOption({ label: '3 Minuten' });
  await expect(page.getByText('Gespeichert.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Wenn Sie nicht reagieren, nach')).toHaveValue('3');
});
