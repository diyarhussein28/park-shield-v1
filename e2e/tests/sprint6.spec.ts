import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import {
  expectAccessible,
  ownerWithActiveDecal,
  scannerPage,
  uniqueEmail,
  waitForMail,
} from './helpers';

/** The owner taps a reply link from the alert e-mail (any device, no sign-in needed). */
async function replyLink(request: APIRequestContext, email: string, reply = 'coming') {
  const mail = await waitForMail(request, email, 'alert_received');
  const m = new RegExp(`(https?://\\S+/antwort\\?r=${reply}#t=[A-Za-z0-9_-]+)`).exec(mail.text);
  expect(m, 'reply link in the alert e-mail').not.toBeNull();
  return m![1]!;
}

async function inviteContact(page: Page, contactEmail: string) {
  await page.goto('/konto');
  await page.getByRole('link', { name: 'Notfallkontakte verwalten' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notfallkontakte' })).toBeVisible();
  await page.getByLabel('Name des Kontakts').fill('Kim');
  await page.getByLabel('E-Mail-Adresse des Kontakts').fill(contactEmail);
  await page.getByLabel('Ihr Name').fill('Jonas');
  await page.getByRole('button', { name: 'Einladung senden' }).click();
  await expect(page.getByText(/Einladung gesendet/)).toBeVisible();
}

async function acceptInvitation(
  browser: Browser,
  request: APIRequestContext,
  contactEmail: string,
) {
  const mail = await waitForMail(request, contactEmail, 'ec_invite');
  const link = /(https?:\/\/\S+\/notfallkontakt#t=[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  const ctx = await browser.newContext({ locale: 'de-DE' });
  const page = await ctx.newPage();
  await page.goto(link);
  await expect(
    page.getByText('Jonas möchte Sie als Notfallkontakt bei ParkShield eintragen.'),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Zustimmen' }).click();
  await expect(page.getByText('Danke! Sie sind jetzt Notfallkontakt für Jonas.')).toBeVisible();
  await ctx.close();
}

test('owner replies "Ich komme" from the e-mail; the scanner sees it at once (US-23, US-22)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('reply');
  const url = await ownerWithActiveDecal(page, request, email);
  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(scan.getByText('Die Warnung ist beim Fahrer angekommen.')).toBeVisible({
    timeout: 15_000,
  });

  // A normal alert without Push stops at e-mail, which carries the three reply buttons.
  const link = await replyLink(request, email);
  const owner = await browser.newContext({ locale: 'de-DE' });
  const phone = await owner.newPage();
  await phone.goto(link);
  await expect(phone.getByText(/Licht brennt noch bei „Der Blaue“/)).toBeVisible();
  for (const name of ['Ich komme', 'In ca. 30 Min', 'Bin nicht in der Nähe']) {
    await expect(phone.getByRole('button', { name })).toBeVisible();
  }
  await expectAccessible(phone);
  // Opening the link changed nothing yet (NT-02).
  await expect(scan.getByText('Die Warnung ist beim Fahrer angekommen.')).toBeVisible();

  await phone.getByRole('button', { name: 'Ich komme' }).click();
  await expect(phone.getByText('Danke! Die Person sieht, dass Sie unterwegs sind.')).toBeVisible();
  await expect(scan.getByText(/Der Fahrer hat bestätigt und ist unterwegs/)).toBeVisible({
    timeout: 5_000,
  });

  // The same link a second time.
  await phone.goto(link);
  await phone.reload();
  await expect(phone.getByText('Sie haben bereits geantwortet: „Ich komme“.')).toBeVisible();
  await owner.close();
  await ctx.close();
});

test('emergency contact: invitation, consent, and escalation on "Bin nicht in der Nähe" (US-24, NT-10)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail('escalate');
  const contact = uniqueEmail('kim');
  const url = await ownerWithActiveDecal(page, request, email);
  await inviteContact(page, contact);
  await expect(page.getByText(/Wartet auf Zustimmung bis/)).toBeVisible();
  await expectAccessible(page);
  // Plus allows one contact: the form is replaced by the limit notice.
  await expect(page.getByRole('button', { name: 'Einladung senden' })).toHaveCount(0);

  await acceptInvitation(browser, request, contact);
  await waitForMail(request, email, 'ec_decided');
  await page.reload();
  await expect(page.getByText('Bestätigt', { exact: true })).toBeVisible();

  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  const link = await replyLink(request, email, 'not_nearby');
  const owner = await browser.newContext({ locale: 'de-DE' });
  const phone = await owner.newPage();
  await phone.goto(link);
  await phone.getByRole('button', { name: 'Bin nicht in der Nähe' }).click();
  await expect(
    phone.getByText('Danke! Wir benachrichtigen jetzt Ihren Notfallkontakt.'),
  ).toBeVisible();

  const mail = await waitForMail(request, contact, 'escalation');
  expect(mail.text).toContain('Fahrzeug versperrt Ausfahrt');
  expect(mail.text).toContain('„Der Blaue“');
  expect(mail.text).not.toContain('K-AB');
  await expect(scan.getByText('Eskaliert an Notfallkontakt')).toBeVisible({ timeout: 10_000 });
  await owner.close();
  await ctx.close();
});

test('without a contact, "Bin nicht in der Nähe" shows the scanner who can help (NT-10, SC-13)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90_000);
  const email = uniqueEmail('notnear');
  const url = await ownerWithActiveDecal(page, request, email);
  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Fahrzeug versperrt Ausfahrt' }).click();
  const link = await replyLink(request, email, 'not_nearby');
  const owner = await browser.newContext({ locale: 'de-DE' });
  const phone = await owner.newPage();
  await phone.goto(link);
  await phone.getByRole('button', { name: 'Bin nicht in der Nähe' }).click();
  await expect(phone.getByText(/nicht in der Nähe sind, und bekommt Hinweise/)).toBeVisible();
  await expect(scan.getByText(/Fahrer ist nicht in der Nähe/)).toBeVisible({ timeout: 5_000 });
  await expect(scan.getByRole('heading', { name: 'Was Sie jetzt tun können' })).toBeVisible();
  await expect(scan.getByRole('link', { name: '112' })).toHaveAttribute('href', 'tel:112');
  await owner.close();
  await ctx.close();
});

test('owner changes the channel order (US-22, OW-05)', async ({ page, request }) => {
  await ownerWithActiveDecal(page, request, uniqueEmail('order'));
  await page.goto('/konto/benachrichtigungen');
  const order = page.getByRole('list', { name: 'Reihenfolge bei normalen Warnungen' });
  await expect(order.getByRole('listitem')).toHaveText([/1\. Push/, /2\. E-Mail/, /3\. WhatsApp/]);
  await expect(page.getByRole('button', { name: 'Push nach oben' })).toBeDisabled();
  await page.getByRole('button', { name: 'E-Mail nach oben' }).click();
  await expect(page.getByText('Reihenfolge gespeichert.')).toBeVisible();
  await expect(order.getByRole('listitem')).toHaveText([/1\. E-Mail/, /2\. Push/, /3\. WhatsApp/]);
  await page.reload();
  await expect(order.getByRole('listitem')).toHaveText([/1\. E-Mail/, /2\. Push/, /3\. WhatsApp/]);
  await expectAccessible(page);
});
