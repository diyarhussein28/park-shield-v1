# NFC stickers from our own stock — Phase 0 review and plan

_2026-11-27. Task: [`docs/nfc-sticker-prompt.md`](nfc-sticker-prompt.md). Spec: [`docs/nfc-decals.md`](nfc-decals.md).
Status: **approved 2026-11-27. Phases 1–3 done** (`docs/handover.md` §27); phases 4–5 open._

## 1. The owner's answers to the open questions (2026-11-27)

1. Serial number like `PS-000001`, **printed on the sticker**.
2. **We design** the generic sticker; size stays **80 × 80 mm**.
3. Change-over: the old code ends **14 days after shipping** at the latest (or when the new sticker is
   tested in the app).
4. **All current customer accounts and their orders on the test server are test data and will be
   deleted** (staff accounts stay). Done at the deploy of this feature, after a last confirmation.
5. **Withdrawal stays as it is:** the sticker's value (3 €) is still kept on a withdrawal.

## 2. What exists and is reused

| Need | Already there |
| --- | --- |
| Stock state of a code | `qr_tokens.status` `in_stock` → `assigned` → `revoked`, history in `tag_events`, `TagsService.transition` (row lock, allowed transitions) |
| Batches | `token_batches` (generated → printed → shipped), `FulfilmentService.createBatch / batchPrintFile / advanceBatch`, ops page `/partner`, permission `tokens.manage` |
| Packing from stock | `fulfillment.mode = from_stock`, `scanStockSticker` (ops order page, `orders.manage`): the scanned stock code becomes the vehicle's code |
| Orders and shipping | `decal_orders` / `decal_order_items`, `/bestellungen`, `decal_shipped` mail, welcome print, 3 € print, paid new code |
| QR and URL | `layoutDecal` (the vehicle label is optional, so a generic decal needs no new layout code), `SCANNER_BASE_URL/s/<code>`, QR export in `letters/` |
| Scanner decision | `scannerDecision`: an `assigned` code of a live contract shows the alert page; everything else the inactive page |

## 3. Problems found in the existing code

1. **In-house stock would be claimable by customers.** `VehiclesService.claimable/claim` accepts any
   `in_stock` code of any batch. Fix: only partner batches can be claimed.
2. **The app would show the wrong code during the change-over.** The vehicle's "current" code is the
   newest by `created_at`, but a stock code was created long before the vehicle's own code. Fix: order by
   `assigned_at`.
3. **„Sperren“ stops only the current code.** With two live codes for a few days, the old one would keep
   working. Fix: „Sperren“ (and car sold, withdrawal, ops override) stop every live code of the vehicle.
4. **Packing revokes the old code at once** (`scanStockSticker`). Fix: the change-over below.
5. **Packing writes no `code_issuances` row**, and the 10-day new-code wait counts from the newest row.
   Plan: record it as a new kind `stock_sticker` that does **not** start the 10-day wait (it is not the
   owner's request).
6. A batch must have a partner today; in-house batches have none. Batch creation inserts codes one by
   one (fine up to 10,000, but a bulk insert is better).
7. The order flow freezes a `design_snapshot` with the vehicle label „for the personalised sticker“.
   The physical sticker is generic now; the snapshot stays only for the 3 € withdrawal rule (answer 5),
   and texts that call the sticker „personalisiert“ change.

## 4. Design

### Data (one migration, with rollback)

- `token_batches`: `kind` (`partner` | `inhouse_nfc`, default `partner`), `chip` (`NTAG215` or null).
- `qr_tokens`: `serial_no` (integer from a sequence, unique; shown as `PS-000001`; in-house stock only)
  and `retire_after` (timestamptz: the deadline of an old code in a change-over).
- New table `nfc_tags` (from `docs/nfc-decals.md` §6, adapted): one row per stock code — `chip`,
  `uid_bidx` (HMAC blind index, unique, nullable until read), `programmed_at/_by`, `verified_at/_by`,
  `locked_at/_by`, `method` (`web_nfc` | `nfc_tools`). The UID is never used for access decisions.
- Enum values: `code_issue_kind` + `stock_sticker`; revoke reasons + `damaged`, `retired_change_over`.
- Settings (`app_settings`): `fulfillment.old_code_grace_days` (14), `stock.low_threshold` (e.g. 50).
- Test server: `fulfillment.mode = from_stock` once stock exists.

### Change-over (decision 5 of the prompt)

1. Packing (`scanStockSticker`): only a stock sticker of an in-house batch that is **verified and
   locked**; it becomes `assigned` to the vehicle at once (scanner works immediately). The vehicle's
   other live codes stay `assigned`; one transaction, row locks, so a sticker never goes to two vehicles.
2. Shipping (`markShipped`): the old codes get `retire_after = shipped_at + 14 days`.
3. The owner taps „Aufkleber testen“ and scans the new sticker → the old codes are revoked
   (`retired_change_over`). A worker sweep revokes old codes whose `retire_after` has passed.
4. The app shows the new code (QR, PDF) as soon as the sticker is packed, with the notice „Neuer Aufkleber
   unterwegs – nach dem Aufkleben bitte testen. Ihr alter Code funktioniert bis dahin.“
5. Returned or cancelled before shipping: the stock code is revoked (`damaged`/returned), the old code
   simply stays.

### Ops (back office, VPN)

- New page **„Aufkleber-Lager“**: counts (made, not yet programmed, ready, packed, shipped, in
  change-over, damaged/revoked), low-stock warning (also in the ops health checks), batches (create an
  in-house batch of any quantity, print PDF of the generic design with QR and serial, export, mark
  printed), sticker search by serial (never by code).
- **Export** per batch: CSV (serial, URL, NDEF URI content `0x04` + URL without `https://`, batch) and
  ZIP (SVG + PNG per sticker, named by serial). New permission `tokens.export` (admin); every download
  is an audited read; nothing is stored.
- **Sticker detail → „NFC schreiben“**: URL with copy button and QR; with Chrome on Android: write →
  read back and compare → confirmation „Endgültig sperren (nicht umkehrbar)“ → `makeReadOnly()` → read
  back. Without Web NFC (iPhone, desktop): instructions for NFC Tools, then „Prüfen“ by scanning the
  printed QR and reading the chip (or pasting what NFC Tools read); a mismatch blocks the sticker.
  „Beschädigt“ takes a sticker out of stock.
- API: `/ops/v1/stickers` (search, detail), `/ops/v1/stickers/:id/nfc` (GET URL — audited read;
  POST programmed / verified / locked), `/ops/v1/stickers/:id/damaged`, batch export routes; all with a
  permission and an audit entry. No new public route; the scanner page `/s/[code]` is unchanged.

### App

- Vehicle screen: a „Aufkleber“ card with serial, order and shipping status, the change-over notice and
  install help („innen an die Scheibe, Beifahrerseite unten“).
- „Mit NFC testen“ (`react-native-nfc-manager`) needs a new EAS build: **proposed for later**, after the
  rest works; QR testing covers the change-over.
- Lost or damaged: the existing „Sperren“ / new-code screens; the printed replacement now comes from stock.

### Texts to change (DE + EN)

The home page card „Der Aufkleber“ (`landing.stickerF*`: „sechs Designs mit dem Namen Ihres Fahrzeugs“),
print and order screens and e-mails that say the sticker carries the vehicle name or is personalised,
help articles, FAQ, the AGB / contract wording on the sticker (shown to the owner before changing legal
texts).

## 5. Phases and commits

| Phase | Content | Needs |
| --- | --- | --- |
| 1 | Migration, in-house batches, serial numbers, generic print file, CSV/ZIP export, claim restriction (§3.1) | approval of this plan |
| 2 | `nfc_tags`, ops „NFC schreiben“ / „Prüfen“ / „Beschädigt“, packing gate | phase 1 |
| 3 | Change-over (§3.2–3.5), shipping notice, worker sweep | phase 2 |
| 4 | App sticker card and notices, texts on website, app and e-mails | phase 3 |
| 5 | Stock overview and low-stock warning | phase 1 |
| Deploy | Test server: migration, `from_stock`, delete test customers (confirmation first), owner's hardware test | the owner's go |

Each phase: API integration tests, ops E2E (mocked `NDEFReader`, `expectAccessible`), app Jest tests,
lint, typecheck, `db:check`, `db:types`, docs; commit and push. The manual hardware test list goes into
`docs/nfc-decals.md`.

## 6. Risks

- Web NFC works only in Chrome on Android; staff on iPhones use NFC Tools plus the „Prüfen“ step.
- A locked chip cannot be fixed: the confirmation step and the read-back come first, always.
- Heat-reflective windscreens can block NFC; the QR code still works (hardware test).
- Stock codes are live secrets once printed: export and print file are audited reads; a lost batch is
  revoked as a whole (ops action, phase 5).
- Deleting the test customers (answer 4) cannot be undone; it is a separate, confirmed step.

## 7. Small questions (defaults used unless the owner says otherwise)

1. Low-stock warning below **50** ready stickers.
2. Serial numbers count up globally (`PS-000001`, `PS-000002`, …), across batches.
3. „Mit NFC testen“ in the app: later, with the next EAS build.
