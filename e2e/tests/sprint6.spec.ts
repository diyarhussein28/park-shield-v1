import { expect, test } from '@playwright/test';
import {
  alertIdOf,
  API_URL,
  appDevice,
  escalationDue,
  expectAccessible,
  expectNoAlertMail,
  ownerWithActiveDecal,
  scannerPage,
  sql,
  uniqueEmail,
  waitForAppPush,
  waitForEscalationSms,
} from './helpers';

/**
 * Owner replies since 2026-11-21: alerts reach the owner by app push only; without a reaction a
 * reminder push follows after 10 minutes and one SMS after 30 minutes. The SMS carries the view link
 * `/v/<token>`, whose page has the same reply buttons as the app („Ich komme“, …).
 */
test('no reaction: reminder push, then one SMS whose view link answers „Ich komme“; the scanner sees it (US-23, US-22)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail('reply');
  const { url } = await ownerWithActiveDecal(page, request, email);
  const app = await appDevice(request, email);
  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Licht brennt noch' }).click();
  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  await expect(scan.getByText('Fahrzeughalter wurde benachrichtigt.')).toBeVisible({
    timeout: 15_000,
  });
  const alertId = await alertIdOf(scan);
  await waitForAppPush(request, app.fcmToken, 'alert', alertId);

  // Due times are set at once; nothing else goes out with the alert (no SMS, no e-mail).
  const [due] = await sql<{ remind: number; sms: number; stage: string }>(
    `SELECT extract(epoch FROM remind_at - created_at)::int AS remind,
            extract(epoch FROM sms_due_at - created_at)::int AS sms, escalation_stage AS stage
       FROM alerts WHERE id = $1`,
    [alertId],
  );
  expect(due).toEqual({ remind: 600, sms: 1800, stage: 'none' });

  // 10 minutes later: the reminder push (generic payload).
  await escalationDue(alertId, 'reminder');
  const reminder = await waitForAppPush(request, app.fcmToken, 'reminder', alertId);
  expect(reminder.body.message.data).toEqual({ alertId, kind: 'reminder' });

  // 30 minutes: one SMS with the view link, one GSM-7 segment, no plate.
  await escalationDue(alertId, 'sms');
  const sms = await waitForEscalationSms(request, alertId);
  expect(sms.body.length).toBeLessThanOrEqual(160);
  expect(sms.body).not.toMatch(/K-AB|1234/);
  const view = /(https?:\/\/\S+\/v\/[A-Za-z0-9_-]+)/.exec(sms.body)?.[1];
  expect(view, 'view link in the SMS').toBeTruthy();
  await expectNoAlertMail(request, email);

  const owner = await browser.newContext({ locale: 'de-DE' });
  const phone = await owner.newPage();
  await phone.goto(view!);
  await phone.waitForLoadState('networkidle');
  await expect(phone.getByText(/Licht brennt noch bei „Der Blaue“/)).toBeVisible();
  for (const name of ['Ich komme', 'In ca. 30 Min', 'Bin nicht in der Nähe']) {
    await expect(phone.getByRole('button', { name })).toBeVisible();
  }
  await expectAccessible(phone);
  // Opening the link changed nothing yet (NT-02).
  await expect(scan.getByText(/Der Fahrzeughalter ist unterwegs/)).toHaveCount(0);

  await phone.getByRole('button', { name: 'Ich komme' }).click();
  await expect(phone.getByText('Danke! Die Person sieht, dass Sie unterwegs sind.')).toBeVisible();
  await expect(scan.getByText(/Der Fahrzeughalter ist unterwegs/)).toBeVisible({
    timeout: 10_000,
  });

  // The same link a second time.
  await phone.reload();
  await expect(phone.getByText('Sie haben bereits geantwortet: „Ich komme“.')).toBeVisible();
  await owner.close();
  await ctx.close();
});

test('„Bin nicht in der Nähe“ from the app shows the scanner who can help (NT-10, SC-13)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('notnear');
  const { url } = await ownerWithActiveDecal(page, request, email);
  const app = await appDevice(request, email);
  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  await scan.getByRole('button', { name: 'Warnung senden' }).click();
  const alertId = await alertIdOf(scan);
  await waitForAppPush(request, app.fcmToken, 'alert', alertId);

  const r = await request.post(`${API_URL}/v1/app/alerts/${alertId}/ack`, {
    headers: app.headers,
    data: { reply: 'not_nearby' },
  });
  expect(r.status()).toBe(200);
  await expect(scan.getByText(/Fahrer ist nicht in der Nähe/)).toBeVisible({ timeout: 10_000 });
  await expect(scan.getByRole('heading', { name: 'Was Sie jetzt tun können' })).toBeVisible();
  await expect(scan.getByRole('link', { name: '112' })).toHaveAttribute('href', 'tel:112');
  await expectAccessible(scan);

  // A reply stops the escalation: no reminder, no SMS.
  const [row] = await sql<{
    stopped: boolean;
    reason: string;
    remind: Date | null;
    sms: Date | null;
  }>(
    `SELECT escalation_stopped_at IS NOT NULL AS stopped, escalation_stop_reason AS reason,
            remind_at AS remind, sms_due_at AS sms FROM alerts WHERE id = $1`,
    [alertId],
  );
  expect(row).toMatchObject({ stopped: true, remind: null, sms: null });
  await ctx.close();
});
