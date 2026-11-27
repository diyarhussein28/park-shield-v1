import { expect, test } from '@playwright/test';
import { API_URL, expectAccessible, sql, staffBrowser } from './helpers';

// In-house NFC sticker stock, phase 1 (2026-11-27, docs/nfc-sticker-plan.md).
test.describe('Aufkleber-Lager', () => {
  test.skip(({ isMobile }) => isMobile, 'ops pages are tested on desktop');

  test('admin creates a batch, downloads the production files; the scanner shows nothing', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);
    const note = `E2E ${Date.now()}`;
    const admin = await staffBrowser(browser, 'admin', ['admin']);
    await admin.goto('/lager');
    await admin.waitForLoadState('networkidle');
    await expect(admin.getByRole('heading', { level: 1, name: 'Aufkleber-Lager' })).toBeVisible();
    const form = admin.getByRole('form', { name: 'Neue Charge' });
    await form.getByLabel('Anzahl Aufkleber (höchstens 5000)').fill('2');
    await form.getByLabel('Notiz').fill(note);
    await form.getByRole('button', { name: 'Charge erzeugen' }).click();
    await expect(admin.getByText('Charge mit 2 Aufklebern erzeugt.')).toBeVisible();

    const [b] = await sql(
      `SELECT b.id, min(t.serial_no) AS first FROM token_batches b
         JOIN qr_tokens t ON t.batch_id = b.id WHERE b.note = $1 GROUP BY b.id`,
      [note],
    );
    const serial = (n: number) => `PS-${String(n).padStart(6, '0')}`;
    const item = admin
      .getByRole('list', { name: 'Chargen' })
      .getByRole('listitem')
      .filter({ hasText: note });
    await expect(item).toContainText(`${serial(b.first)} – ${serial(b.first + 1)}`);
    await expect(item).toContainText('2 Aufkleber · 0 zugeordnet');
    await expect(item).toContainText('NTAG215');
    await expectAccessible(admin);

    const csv = admin.waitForEvent('download');
    await item.getByRole('link', { name: /^Produktionsliste \(CSV\)/ }).click();
    expect((await csv).suggestedFilename()).toMatch(/^parkshield-batch-.+\.csv$/);
    const zip = admin.waitForEvent('download');
    await item.getByRole('link', { name: /^QR-Bilder \(ZIP\)/ }).click();
    expect((await zip).suggestedFilename()).toMatch(/^parkshield-batch-.+-qr\.zip$/);

    // The partner page lists partner batches only.
    await admin.goto('/partner');
    await admin.waitForLoadState('networkidle');
    await expect(admin.getByText(note)).toHaveCount(0);

    // A sticker that is not packed yet is not active and offers no set-up.
    const { codes } = (await (
      await request.get(`${API_URL}/v1/dev/batches/${b.id}/codes`)
    ).json()) as { codes: string[] };
    expect((await request.get(`${API_URL}/v1/scan/${codes[0]}`)).status()).toBe(404);
    expect((await request.get(`${API_URL}/v1/claim/${codes[0]}`)).status()).toBe(404);
  });

  test('fulfilment staff create and print batches but cannot download the production files', async ({
    browser,
  }) => {
    const lager = await staffBrowser(browser, 'lager', ['fulfillment']);
    await lager.goto('/lager');
    await lager.waitForLoadState('networkidle');
    await expect(lager.getByRole('form', { name: 'Neue Charge' })).toBeVisible();
    await expect(lager.getByRole('link', { name: /^Produktionsliste/ })).toHaveCount(0);
    await expect(lager.getByRole('link', { name: /^QR-Bilder/ })).toHaveCount(0);
  });
});
