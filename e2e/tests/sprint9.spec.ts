import { expect, test } from '@playwright/test';
import {
  expectAccessible,
  ownerWithActiveDecal,
  scannerPage,
  staffBrowser,
  uniqueEmail,
  waitForMail,
} from './helpers';

test('support opens Customer 360 and the trace; break-glass needs a second person (US-35, US-36)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('c360');
  // Unique per run: approvers see every open request, including the other project's.
  const ticket = `ZM-${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;
  const url = await ownerWithActiveDecal(page, request, email);
  const { ctx, page: scan } = await scannerPage(browser, url);
  await scan.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(scan.getByText('Die Warnung ist beim Fahrer angekommen.')).toBeVisible({
    timeout: 15_000,
  });
  await ctx.close();

  const support = await staffBrowser(browser, 'support', ['support']);
  await support.goto('/kunden');
  await support.getByLabel('E-Mail-Adresse oder letzte 4 Zeichen des Codes').fill(email);
  await support.getByRole('button', { name: 'Suchen' }).click();
  await support.getByRole('link', { name: email }).click();
  await expect(support.getByRole('heading', { level: 1, name: email })).toBeVisible();
  const customerUrl = support.url();
  await expect(support.getByText('K-•• ••34')).toBeVisible();
  await expect(support.getByText('K-AB 1234')).toHaveCount(0);
  await expectAccessible(support);

  // Delivery trace: attempts, never content.
  await support.getByRole('link', { name: 'Zustellverlauf' }).first().click();
  await expect(support.getByText('Freitexte werden hier nie angezeigt.')).toBeVisible();
  await expect(support.getByRole('table', { name: 'Zustellversuche' })).toContainText('email');
  await expectAccessible(support);
  await support.goto(customerUrl);
  await support.waitForLoadState('networkidle'); // hydrated: the buttons below are interactive

  await support.getByRole('button', { name: /^Freigabe anfordern\s?: Kennzeichen/ }).click();
  await support
    .getByLabel('Begründung (mind. 10 Zeichen)')
    .fill('Abschleppdienst braucht das Kennzeichen');
  await support.getByLabel('Ticketnummer').fill(ticket);
  await support.getByRole('button', { name: 'Freigabe anfordern' }).click();
  await expect(support.getByText(/Angefordert\. Eine zweite Person muss freigeben/)).toBeVisible();

  const admin = await staffBrowser(browser, 'admin', ['admin']);
  await admin.goto('/break-glass');
  const pending = admin
    .getByRole('list', { name: 'Warten auf Ihre Freigabe' })
    .getByRole('listitem')
    .filter({ hasText: ticket });
  await expectAccessible(admin);
  await pending.getByRole('button', { name: 'Freigeben' }).click();
  await expect(pending).toHaveCount(0);

  await support.goto('/break-glass');
  const mine = support
    .getByRole('list', { name: 'Meine Anfragen' })
    .getByRole('listitem')
    .filter({ hasText: ticket });
  await mine.getByRole('button', { name: 'Anzeigen' }).click();
  await expect(mine.getByText('K-AB 1234')).toBeVisible();
  const notice = await waitForMail(request, email, 'break_glass_notice');
  expect(notice.text).toContain(ticket);
});

test('privacy request by e-mail: the person confirms, then the steps are worked off (US-37)', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail('dsr');
  await ownerWithActiveDecal(page, request, email);
  const dpo = await staffBrowser(browser, 'dsb', ['admin']);
  await dpo.goto('/datenschutz');
  await dpo.waitForLoadState('networkidle');
  await dpo.getByLabel('Art').selectOption({ label: 'Löschung' });
  await dpo.getByLabel('E-Mail-Adresse der Person').fill(email);
  await dpo.getByRole('button', { name: 'Erfassen und Bestätigungslink senden' }).click();
  await expect(
    dpo.getByText(/Erfasst\. Die Person hat einen Bestätigungslink bekommen\./),
  ).toBeVisible();
  await expectAccessible(dpo);

  const mail = await waitForMail(request, email, 'dsr_verify');
  const link = /(https?:\/\/\S+\/datenschutz-anfrage#t=[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  const person = await browser.newContext({ locale: 'de-DE' });
  const p = await person.newPage();
  await p.goto(link);
  await expectAccessible(p);
  await p.getByRole('button', { name: 'Ja, die Anfrage kommt von mir' }).click();
  await expect(p.getByText(/Ihr Konto wird in 24 Stunden gelöscht/)).toBeVisible();
  await person.close();

  await dpo.reload();
  await dpo.waitForLoadState('networkidle');
  const row = dpo
    .getByRole('list', { name: 'Datenschutz-Anfragen' })
    .getByRole('listitem')
    .filter({ hasText: email });
  await row.getByRole('link', { name: /Öffnen/ }).click();
  await expect(dpo.getByText(/Bestätigt \(email_link\)/)).toBeVisible();
  await dpo.waitForLoadState('networkidle'); // typing before hydration would not reach React state
  await expect(dpo.getByText(/Löschung geplant/)).toBeVisible();
  await expectAccessible(dpo); // includes reflow: the long address in the heading once widened the page
  const zammad = dpo
    .getByRole('list', { name: 'Schritte je Auftragsverarbeiter' })
    .getByRole('listitem')
    .filter({ hasText: 'zammad' });
  await zammad.getByLabel('Nachweis (zammad)').fill('Keine Tickets vorhanden');
  const na = zammad.getByRole('button', { name: 'Nicht zutreffend' });
  await expect(na).toBeEnabled();
  await na.click();
  await expect(zammad.getByText('nicht zutreffend', { exact: true })).toBeVisible();
  await expect(na).toHaveCount(0);
  await dpo.getByRole('button', { name: 'Anfrage abschließen' }).click();
  await expect(dpo.getByText(/Noch offen: .*parkshield_db/)).toBeVisible();
  await expectAccessible(dpo);
});

test('abuse centre: owner report handled; a new filter word is live at once (US-38)', async ({
  page,
  request,
  browser,
}, info) => {
  // The word list is global state: two projects publishing and rolling back at once would race.
  test.skip(info.project.name !== 'desktop-chrome', 'global word list: one project only');
  test.setTimeout(120_000);
  const email = uniqueEmail('abuse');
  const url = await ownerWithActiveDecal(page, request, email);
  const first = await scannerPage(browser, url);
  await first.page.getByRole('button', { name: 'Licht brennt noch' }).click();
  await expect(first.page.getByRole('heading', { name: 'Status Ihrer Warnung' })).toBeVisible();
  await first.ctx.close();
  await page.goto('/konto/verlauf');
  const card = page
    .getByRole('list', { name: 'Verlauf' })
    .getByRole('listitem')
    .filter({ hasText: 'Licht brennt noch' })
    .filter({ hasNotText: 'Test' });
  await card.getByRole('button', { name: 'Missbrauch melden' }).click();
  await card.getByRole('button', { name: 'Melden', exact: true }).click();
  await expect(card.getByText(/Gemeldet\./)).toBeVisible();

  const mod = await staffBrowser(browser, 'mod', ['abuse_moderator']);
  await mod.goto('/missbrauch');
  const report = mod
    .getByRole('list', { name: 'Meldungen' })
    .getByRole('listitem')
    .filter({ hasText: 'harassment' })
    .first();
  await expect(report).toContainText('„Der Blaue“');
  await expectAccessible(mod);
  await report.getByRole('button', { name: 'Bearbeitet' }).click();

  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const word = `prüfwort${Array.from({ length: 6 }, () => letters[Math.floor(Math.random() * 26)]).join('')}`;
  await mod.goto('/missbrauch/woerter');
  await mod.waitForLoadState('networkidle');
  const de = mod.getByLabel('Beleidigungen (Deutsch)');
  await de.fill(`${await de.inputValue()}\n${word}`);
  await mod.getByLabel('Was wurde geändert?').fill('E2E-Testwort');
  await mod.getByRole('button', { name: 'Neue Version veröffentlichen' }).click();
  await expect(mod.getByText(/Version \d+ ist live\./)).toBeVisible();
  await expectAccessible(mod);

  // The public API reloads the lists from the settings broadcast; the next text with the word is blocked.
  const second = await browser.newContext({
    locale: 'de-DE',
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; E2E-words) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
  });
  const s = await second.newPage();
  await s.goto(url);
  await s.getByRole('button', { name: 'Eigene Nachricht' }).click();
  await s.getByLabel('Ihre Nachricht').fill(`Du ${word}!`);
  await s.getByRole('button', { name: 'Nachricht senden' }).click();
  await expect(s.getByRole('alert').filter({ hasText: /\S/ })).toContainText(
    'Diese Nachricht können wir nicht senden',
  );
  await second.close();

  // Roll back so the dev word list does not keep growing.
  await mod.reload();
  await mod
    .getByRole('list', { name: 'Versionen' })
    .getByRole('listitem')
    .nth(1)
    .getByRole('button', { name: /Diese Version wiederherstellen/ })
    .click();
  await expect(mod.getByText(/Version \d+ ist live\./)).toBeVisible();
});
