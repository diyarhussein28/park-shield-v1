# Task: NFC stickers from our own stock (prompt for a developer or AI agent)

_Written 2026-11-27 with the owner's decisions. Replaces the owner's first draft, which described a new
system; most of it already exists. Read this whole file before you start._

## 0. Before anything

- Read `AGENTS.md`, `docs/status.md`, `docs/handover.md` and **`docs/nfc-decals.md`** (the NFC spec;
  §11 now holds the owner's decisions). Follow the hard rules in `AGENTS.md` §8 and the standing
  instructions in `CLAUDE.md`: answer the owner in **Arabic**, code and docs in English, German UI texts
  first in `packages/i18n`, commit and push to `main` after every finished part, keep
  `docs/handover.md` and `docs/status.md` current.
- Start with a **review and a written plan** (what you reuse, the migrations, the risks, the answers to
  §6 below). **Wait for the owner's approval before any migration or larger change.** Never deploy to
  production; the test server only after the owner says so.

## 1. Owner decisions (2026-11-27, final)

1. **The NFC sticker replaces today's printed decal.** It is one generic design: **no vehicle name, no
   design chosen by the customer.** The free PDF to print at home keeps the customer's design and vehicle
   name. The lawyer accepted this.
2. **One code per vehicle.** QR code, NFC chip, the app's QR and the PDF all carry the same URL,
   `SCANNER_BASE_URL/s/<code>` (`https://park-shield.de/s/<code>`), built by the existing code
   (`apps/api/src/decal`). No new URL format, no new token type, no `pkshd.de` short links.
3. **From our own stock.** We produce batches in advance (`fulfillment.mode = from_stock`). When an order
   is packed, the sticker's code becomes the vehicle's code.
4. **Active at once.** No manual activation by staff; the existing subscription rules decide what the
   scanner page shows.
5. **Change-over:** the vehicle's old code (and any PDF printed with it) **keeps working until the
   customer installs the new sticker**: it ends when the owner tests the new sticker in the app
   („Aufkleber testen“) or automatically N days after shipping (new setting, default 14). The vehicle is
   never without protection while the sticker travels.
6. **Inside the glass only** (windscreen corner on the passenger side or a side window, read from
   outside, `docs/nfc-decals.md` §9).
7. **Chip: NXP NTAG215**, static URL only (stage 1). No NTAG 424 DNA / SUN.
8. **We produce ourselves for now:** print, stick the inlay, program, verify. No print-partner adapter.
9. **Permanent lock** of the chip after a successful write and read-back check, only after an explicit
   „irreversible“ confirmation.

Unchanged: the first printed sticker is included in the plan, every further one 3 €; „Sperren“ and the
new-code rules (`vehicles/code-rules.ts`: free once per subscription year after a „Sperren“, otherwise
3 €, at most every 10 days) apply as they are — a lost or damaged sticker is „Sperren“ plus a new code,
which now means a new sticker from stock.

## 2. What already exists — reuse it, do not build a second system

- `qr_tokens` with `status` `in_stock` / `assigned` / `revoked`, a `batch_id`, `code_hash` + `code_enc`,
  and the history table `tag_events` (`TagsService.transition`, `apps/api/src/vehicles/tags.service.ts`).
- `token_batches` (generated → printed → shipped) and the ops batch pages (`/partner`,
  `FulfilmentService.createBatch`, `batchPrintFile`, `advanceBatch`).
- `fulfillment.mode = from_stock` and **`FulfilmentService.scanStockSticker`**: the packer scans a stock
  sticker in ops → it becomes the vehicle's code and the order is `packed`. Today it revokes the old code
  at once; that changes with decision 5.
- `decal_orders` / `decal_order_items`, product `nfc_vinyl_sticker` in the `decal_product` enum, the ops
  order pages (`/bestellungen`), the `decal_shipped` mail, `code_issuances`, the welcome print.
- The QR export (SVG/PNG/PDF/ZIP, ECL Q) in `apps/api/src/letters/`.
- The customer side is the **app** (`apps/mobile`); the website has no portal since 2026-11-24. The admin
  side is the **ops app** (VPN-only, every route a permission, every read audited).

## 3. What to build, in phases (one commit or more per phase, each phase green before the next)

**Phase 1 — Stock batches of NFC stickers (ops + API)**

- A batch gets a kind: in-house NFC stock vs. partner batch. **In-house stock must never be claimable
  by customers**: `VehiclesService.claimable/claim` (`/v1/claim/:code`, `POST /v1/vehicles/:id/claim`)
  today accepts any `in_stock` code of any batch; restrict it to partner batches. Only staff assign
  in-house stock (packing).
- A human-readable **serial number** per sticker (e.g. `PS-000001`, printed small on the sticker),
  unique; staff search by serial, never by code. Propose the format in the plan.
- Generate a batch of any quantity (existing limit 1–10,000), secure random codes as today.
- **Print file** for the generic design with the QR code and the serial; the design itself is the
  owner's (ask for it, or a placeholder until it exists).
- **Export** for production: CSV with serial, URL, NDEF URI content (prefix byte `0x04` + the URL without
  `https://`), batch; optional ZIP with one SVG and one PNG QR per sticker, named by serial. The export
  contains the codes, which let anyone send alerts: its own permission, an audit entry per download,
  never stored on the server. No Excel file (the CSV opens in Excel).

**Phase 2 — Programming and checking the chip (ops)**

- Per sticker (search by serial or scan its QR): show the URL (copy button) and the QR code.
- **„NFC schreiben“** with Web NFC (`NDEFReader`, Chrome on Android only — never assume iOS): write the
  URI record, read it back, compare with the stored URL; then the separate confirmation step
  „Endgültig sperren (nicht umkehrbar)“ → `makeReadOnly()`, read back once more.
- Fallback **NFC Tools** (Android or iPhone): staff write and lock with the app, then the page checks the
  chip by reading it (Web NFC) or by scanning the printed QR and the chip's URL; a mismatch blocks the
  sticker.
- Store per sticker: programmed, verified, locked, by whom and when, and the chip UID as a blind index
  only (`nfc_tags` in `docs/nfc-decals.md` §6, adapt it). Audit every step.
- **A sticker can only be packed when it is verified and locked.**
- NTAG215 has 504 bytes; the URL needs about 30. The UID proves nothing about authenticity (it can be
  copied or emulated) — never use it for access decisions.

**Phase 3 — Packing, change-over, shipping**

- Extend `scanStockSticker`: refuse stickers that are not verified and locked; the stock code becomes the
  vehicle's active code at once; the old code is not revoked yet but marked as replaced with a deadline
  (decision 5). It is revoked when the owner tests the new sticker in the app or by a worker sweep at the
  deadline (setting `fulfillment.old_code_grace_days`, default 14, in `app_settings`). Everything in one
  transaction with row locks: a sticker never belongs to two vehicles, and two packers cannot take the
  same sticker.
- Decide in the plan how „Sperren“, the abuse blocks (`block_ref`), the new-code rules, the app's QR and
  the PDF behave during the change-over window (two codes for one vehicle for a few days). „Sperren“ in
  that window must stop both.
- The customer is told when the sticker ships (existing `decal_shipped` mail and an app push without
  content, FCM rule) and that the app's QR and the PDF change to the new code once it is installed.

**Phase 4 — App and website texts**

- App: the vehicle shows the physical sticker (serial, order and shipping status), the change-over
  („Neuer Aufkleber unterwegs – bitte nach dem Aufkleben testen“), install help for inside the glass, and
  a „Mit NFC testen“ option in development and store builds (`react-native-nfc-manager`, iOS entitlement
  and `NFCReaderUsageDescription`), as `docs/nfc-decals.md` §8 says. Lost or damaged → the existing
  „Sperren“ / new-code screens.
- Everything that says the printed sticker carries the vehicle name or a chosen design must change:
  the home page „Der Aufkleber“ card (`landing.stickerF*`), help articles, onboarding, the order
  confirmation step that freezes `design_snapshot`, e-mails, AGB / contract texts.
- **Withdrawal:** today the sticker's value is kept on a withdrawal because it is personalised
  (§ 312g Abs. 2 Nr. 1 BGB, `computeWithdrawalRefund` in `legal/rules.ts`, `LEGAL_REVIEW.md` §12). A
  generic sticker is not personalised. Show the owner what changes and do not change the refund formula
  without their answer.

**Phase 5 — Stock overview in ops**

- Counts per state (made, not yet programmed, ready, packed/shipped, in change-over, revoked, damaged),
  a low-stock warning (threshold in `app_settings`) in the existing ops overview / health checks.

## 4. Do not build

A new URL or token format, a separate „stickers“ table beside `qr_tokens`, manual activation, customer
self-assignment of in-house stock, Excel export, telling QR scans and NFC taps apart in statistics (same
URL), NTAG 424 DNA / SUN, a print-partner adapter, Web NFC on iOS. The scanner page `/s/[code]` stays as
it is (plain HTML, 1.5 s / 90 KB, no cookies or storage).

## 5. Tests

API integration tests (`apps/api/src/test/harness.ts`): batch generation, unique codes and serials, the
CSV and the NDEF content equal the QR URL, export permission and audit, programming states and the
„verified and locked“ gate, in-house stock not claimable, concurrent packing of the same sticker,
change-over (old code works until test or deadline, then revoked; „Sperren“ in between), duplicate
payment webhooks for a 3 € sticker, subscription ended / renewed, lost-sticker replacement, old decals
and PDFs keep working. Ops E2E with a mocked `NDEFReader` and `expectAccessible(page)`; app tests
(Jest). New public behaviour → `apps/api/src/security/routes.test.ts`. Run the full suite, lint,
typecheck, `npm run db:check` and `npm run db:types`.

Write the **manual hardware test list** into `docs/nfc-decals.md`: write and lock a real NTAG215, try to
rewrite it (must fail), read it with an iPhone and an Android phone through a windscreen and a side window
(also a heat-reflective windscreen if you can get one), QR and NFC open the same page.

## 6. Questions for the plan (ask the owner, in Arabic)

1. Serial number format and whether it is printed on the sticker.
2. Who makes the generic sticker design, and does its size stay 80 × 80 mm?
3. The change-over deadline: 14 days after shipping?
4. Customers who already have a personalised sticker on order when this goes live: finish them as they
   are, or switch them?
5. The withdrawal question in Phase 4.

## 7. Deliverables

The plan first; then per phase: migrations (with rollback), API, ops pages, app screens, tests and
their results, docs (`docs/nfc-decals.md`, `docs/handover.md`, `docs/status.md`, `AGENTS.md` where the
map changes), a short security review, and the deploy and rollback steps for the test server.
