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

    // Phase 5: the stock card, and a lost batch revoked only after the explicit confirmation.
    await admin.goto('/lager');
    await admin.waitForLoadState('networkidle');
    await expect(admin.getByRole('heading', { level: 2, name: 'Bestand' })).toBeVisible();
    const again = admin
      .getByRole('list', { name: 'Chargen' })
      .getByRole('listitem')
      .filter({ hasText: note });
    await again.getByRole('button', { name: /^Charge verloren\?/ }).click();
    const lostForm = admin.getByRole('form', { name: /^Charge .+ als verloren sperren$/ });
    await lostForm.getByLabel('Was ist passiert?').fill('Paket beim Versand verloren');
    const submit = lostForm.getByRole('button', { name: 'Charge sperren' });
    await expect(submit).toBeDisabled();
    await expectAccessible(admin);
    await lostForm
      .getByLabel(
        'Ich habe verstanden, dass das Sperren der Charge nicht rückgängig zu machen ist.',
      )
      .check();
    await submit.click();
    await expect(
      admin.getByText('Die Aufkleber dieser Charge im Lager sind gesperrt.'),
    ).toBeVisible();
    const revoked = await sql(
      `SELECT count(*)::int AS n FROM qr_tokens WHERE batch_id = $1 AND revoke_reason = 'batch_lost'`,
      [b.id],
    );
    expect(revoked[0].n).toBe(2);
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

  // Phase 2: write, check and lock the chip with Web NFC. The test browser has no NFC, so a stand-in
  // NDEFReader keeps what was "written" and hands it back on the next "tap".
  test('Web NFC: write, check, lock only after the confirmation; the sticker is ready', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const lager = await staffBrowser(browser, 'nfc', ['fulfillment']);
    await lager.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      // A new chip every run: a UID belongs to one sticker for good.
      w.__nfc = { url: '', locked: false, uid: `04:${Math.random().toString(16).slice(2, 14)}` };
      const state = w.__nfc as { url: string; locked: boolean; uid: string };
      class FakeReader extends EventTarget {
        async write(msg: { records: { data: string }[] }) {
          if (state.locked) throw new Error('read-only');
          state.url = msg.records[0]!.data;
        }
        async scan() {
          setTimeout(() => {
            const ev = new Event('reading') as Event & Record<string, unknown>;
            ev.serialNumber = state.uid;
            ev.message = {
              records: [
                {
                  recordType: 'url',
                  data: new DataView(new TextEncoder().encode(state.url).buffer),
                },
              ],
            };
            this.dispatchEvent(ev);
          }, 50);
        }
        async makeReadOnly() {
          state.locked = true;
        }
      }
      w.NDEFReader = FakeReader;
    });
    await lager.goto('/lager');
    await lager.waitForLoadState('networkidle');
    const form = lager.getByRole('form', { name: 'Neue Charge' });
    const note = `NFC ${Date.now()}`;
    await form.getByLabel('Anzahl Aufkleber (höchstens 5000)').fill('1');
    await form.getByLabel('Notiz').fill(note);
    await form.getByRole('button', { name: 'Charge erzeugen' }).click();
    await expect(lager.getByText('Charge mit 1 Aufkleber erzeugt.')).toBeVisible();
    const [row] = await sql(
      `SELECT t.serial_no FROM qr_tokens t JOIN token_batches b ON b.id = t.batch_id WHERE b.note = $1`,
      [note],
    );
    const serial = `PS-${String(row.serial_no).padStart(6, '0')}`;

    const find = lager.getByRole('form', { name: 'Aufkleber finden' });
    await find.getByLabel('Seriennummer oder Inhalt des QR-Codes').fill(serial);
    await find.getByRole('button', { name: 'Suchen' }).click();
    await lager.getByRole('link', { name: serial, exact: true }).click();
    await expect(
      lager.getByRole('heading', { level: 1, name: `Aufkleber ${serial}` }),
    ).toBeVisible();
    await lager.waitForLoadState('networkidle');

    await lager.getByRole('button', { name: 'Adresse und QR-Code anzeigen' }).click();
    await expect(
      lager.getByRole('img', { name: `QR-Code des Aufklebers ${serial}` }),
    ).toBeVisible();
    await lager.getByRole('button', { name: 'Chip beschreiben' }).click();
    await expect(lager.getByText('Chip beschrieben. Jetzt prüfen.')).toBeVisible();
    await lager.getByRole('button', { name: 'Chip prüfen' }).click();
    await expect(
      lager.getByText('Geprüft: Der Chip trägt die Adresse dieses Aufklebers.'),
    ).toBeVisible();

    // Locking is irreversible: the button stays off until the confirmation is ticked.
    const lock = lager.getByRole('button', { name: 'Chip endgültig sperren' });
    await expect(lock).toBeDisabled();
    await expectAccessible(lager);
    await lager
      .getByLabel('Ich habe verstanden, dass das Sperren nicht rückgängig zu machen ist.')
      .check();
    await lock.click();
    await expect(
      lager.getByText('Chip endgültig gesperrt. Der Aufkleber ist bereit zum Verpacken.'),
    ).toBeVisible();
    await expect(lager.getByText('Bereit zum Verpacken', { exact: true })).toBeVisible();
    expect(
      await lager.evaluate(
        () => (window as unknown as { __nfc: { locked: boolean } }).__nfc.locked,
      ),
    ).toBe(true);
    await expect(lager.getByRole('button', { name: 'Chip beschreiben' })).toHaveCount(0);
    const [tag] = await sql(
      `SELECT n.method, n.locked_at IS NOT NULL AS locked FROM nfc_tags n
         JOIN qr_tokens t ON t.id = n.qr_token_id WHERE t.serial_no = $1`,
      [row.serial_no],
    );
    expect(tag).toEqual({ method: 'web_nfc', locked: true });
  });
});
