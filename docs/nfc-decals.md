# NFC decals — specification

_Status: owner decisions taken 2026-11-27 (§11); first draft 2026-11-26. Requirement `SC-11` (`docs/01-requirements.md`),
Phase 2 („NFC decals“, `docs/03-user-stories.md`). Nothing here is built yet._

## 1. What it is

The printed decal gets a small NFC chip (a sticker inlay with an antenna) between its layers. A person
at the car holds a phone against the decal (1–3 cm) and the phone opens **the same scanner page as the
QR code**: `https://park-shield.de/s/<code>`. No app, no account, no battery in the chip.

- iPhone XS and later read the chip in the background (screen unlocked); Android reads it when NFC is
  on (the default on most phones). Phones without NFC still have the QR code next to it.
- The chip holds **only the URL**. No name, plate, phone number or anything else (privacy is the
  product; hard rules 2–4 in `AGENTS.md` §8 stay untouched).
- The QR code stays. NFC is an addition, never a replacement.

## 2. Two stages

| | Stage 1: static URL | Stage 2: authenticated URL (SUN) |
| --- | --- | --- |
| Chip | NXP **NTAG213** (144 bytes user memory) | NXP **NTAG 424 DNA** |
| Price per chip (indicative, by volume) | ~0,10–0,30 € | ~0,60–1,20 € |
| Content | fixed URL, locked after writing | URL with an encrypted counter and a signature that change with every tap |
| Copying | can be copied, like a photo of the QR code | cannot be cloned: the server checks signature and counter |
| Code changes | almost none (job ticket, ops page) | new verification route, new table, keys |

Start with stage 1. Stage 2 adds an authenticity mark on the scanner page („Echter ParkShield-Aufkleber
geprüft“) and helps against fake decals (`docs/runbooks`), and needs the steps in §7.

## 3. What is written on the chip

One **NDEF** message with one **URI record** (well-known type `U`):

- prefix byte `0x04` = `https://`
- then `park-shield.de/s/<code>` (about 30 bytes; `SCANNER_BASE_URL` without the scheme)

The URL is built by the same code that builds the QR code (`layoutDecal`, `apps/api/src/decal`), from
the same `qr_tokens` row, so QR and NFC can never point to different codes in our data.

After writing, the chip is **permanently locked** (NTAG lock bits → read-only). Nobody can rewrite it
later to point to a phishing page. A password lock (`PWD_AUTH`) is not used: it can be attacked and adds
a secret to manage.

## 4. Where the URL is written in our system: the print job

Today every order produces two files in `PRINT_OUTBOX_DIR` (`PRINT_PARTNER=manual`,
`apps/api/src/providers/fake-print.ts`), or the same data goes to the print partner's adapter later:

```
PRINT-7K3Q9X.pdf    the print file (contains the QR code)
PRINT-7K3Q9X.json   the job ticket: order, product, quantity, shipping address
```

For the product `nfc_vinyl_sticker` (already in the DB enum `decal_product` and in `PrintJob`) the job
ticket gets one more field:

```json
{
  "orderId": "…",
  "product": "nfc_vinyl_sticker",
  "quantity": 1,
  "address": { "…": "…" },
  "nfc": {
    "chip": "NTAG213",
    "url": "https://park-shield.de/s/7K3Q9XAB",
    "lock": true
  }
}
```

- `PrintJob` (`apps/api/src/providers/ports.ts`) gets an optional `nfc: { chip, url, lock }`, filled by
  `OrdersService.submitToPrinter` only for `nfc_vinyl_sticker`; `FakePrintPartner` writes it into the
  JSON; a later partner adapter maps it to the partner's format (API field or a CSV column).
- The ticket holds nothing new that is secret: the PDF already carries the code. Both files hold the
  shipping address and stay private, deleted with the order data as today.
- `quantity > 1` is not allowed for NFC decals: one chip = one code.

## 5. Who writes the chip

### 5a. The print partner (volume)

Partners for NFC labels have an encoder in the production line. Per job: write the URL, lock, read back
and compare, reject failures. **Print and encode in the same pass**, so a chip can never end up in the
wrong personalised decal. The partner returns, per order, the chip **UID** (7 bytes, unique per chip)
and a pass/fail flag — by API callback or a CSV in the SFTP drop. We store the UID (§6).

### 5b. Staff in the ops app (now, `PRINT_PARTNER=manual`)

New page in the ops app: **Bestellungen → Auftrag → „NFC schreiben“**. It uses **Web NFC**
(`NDEFReader`, Chrome on Android only; the ops app is VPN-only, so the phone joins the VPN):

1. The page loads the order's URL from the API (never typed by hand).
2. Staff hold the sticker to the phone: `write()` the URI record, then `makeReadOnly()`.
3. The page reads the chip back and compares the URL; then staff scan the printed QR code with the same
   page (camera) and the page checks that both point to the same code. A mismatch blocks the order.
4. The API stores the UID and writes an audit entry.

- API: `GET /ops/v1/orders/:id/nfc` (returns the URL, permission `orders.manage`, audited because it
  shows a code) and `POST /ops/v1/orders/:id/nfc` (`{ uid, verified: true }`, same permission, audit
  `decal.nfc_written`). Both follow the ops rules (`AGENTS.md` §7: permission check and audit on reads).
- Fallback without the page: an Android phone with the app „NFC Tools“ (Write → URL, then Lock tag) or a
  USB writer (e.g. ACR122U). Then staff enter the UID by hand; the QR/NFC comparison is the owner's test
  (§8).

### 5c. Pre-printed stock (`fulfillment.mode = from_stock`)

Partner decals printed in batches get their chips written in the same batch run; the batch CSV lists
code → UID. The packer's scan stays as today.

## 6. Data

Stage 1 needs one small table:

```sql
CREATE TABLE nfc_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_token_id uuid NOT NULL REFERENCES qr_tokens(id),
  order_id    uuid REFERENCES decal_orders(id),
  uid_bidx    bytea NOT NULL UNIQUE,      -- HMAC blind index of the chip UID (hard rule 3)
  chip        text NOT NULL,              -- 'NTAG213' | 'NTAG424DNA'
  written_by  text NOT NULL,              -- 'partner' | 'staff'
  last_counter integer,                   -- stage 2 only
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

The UID itself is not personal data, but it identifies one physical decal; we keep only the blind index.
When a code is locked („Sperren“) or replaced, the chip points to a revoked code and the scanner page
already says so; nothing extra is needed. A new code always comes with a new printed decal (3 €, or free
once a year), so chips are never rewritten.

## 7. Stage 2: NTAG 424 DNA with SUN (Secure Unique NFC)

The chip appends two values to the URL on every tap: `…/s/<code>?d=<picc>&m=<cmac>`.

- `d` = the chip UID and a tap counter, AES-encrypted; `m` = a CMAC over them.
- **Keys:** one key per chip, derived from a master key and the UID (NXP AN10922 diversification). Only
  the master key is a secret: env `NFC_MASTER_KEY_V<n>` like `DATA_KEY_V<n>`; never in the DB, never in
  logs.
- **Check on the server** (scanner route, before the page renders): decrypt `d`, verify `m`, look up
  `uid_bidx`, require `counter > last_counter`, store the new counter. Valid → the page shows „Echter
  ParkShield-Aufkleber“. Invalid or replayed → the page works as usual (the QR path never had a check)
  but shows no mark, and the abuse module counts it (fake-decal signal, `docs/runbooks`).
- The scanner page stays a plain-HTML route handler within its 1.5 s / 90 KB budget; the check is one API
  call. No cookies, no storage (E2E `abuse-protection.spec.ts`).
- New public behaviour on an existing route: add the parameters and their abuse control to
  `apps/api/src/security/routes.test.ts`. Rate limit from `app_settings` (hard rule 6).
- Encoding stage 2 needs the partner's encoder to set the SUN configuration and diversified keys; Web
  NFC cannot do it. So stage 2 is partner-only.

## 8. App and website

- Decal designs: a small NFC mark and „Handy hier anhalten“ next to the QR code (texts through
  `packages/i18n`, DE first).
- App „Aufkleber testen“ (existing): add „Mit NFC testen“ in a development or store build
  (`react-native-nfc-manager`; iOS entitlement `com.apple.developer.nfc.readersession.formats` and
  `NFCReaderUsageDescription`). It reads the chip and confirms that it opens this vehicle's code — the
  owner's own check that QR and NFC match.
- Help centre: an article „NFC-Aufkleber“ (where to place it, how a tap works).

## 9. Material and placement

- **Recommended: inside the windscreen or a side window, read from outside.** Clear PET/PVC film with
  adhesive on the printed face („innenklebend“, „Frontklebe“) and a full white backing print behind the
  design so the QR code keeps its contrast; the NFC inlay sits between the layers. Protected from rain,
  car wash, UV and vandalism, and a fake sticker cannot be stuck over it. Glass does not block NFC.
  - Place it outside the driver's field of view (§35b StVZO): the lower corner on the passenger side or a
    rear side window.
  - Some heat-reflective windscreens (metal-coated „Wärmeschutzverglasung“) weaken NFC; test on several
    cars before launch. Dark tinted rear windows lower the QR contrast.
- **Alternative: on the body.** Cast vinyl (e.g. 3M IJ180, Avery MPI 1105) with a removable adhesive
  (no paint damage) and a **matt** UV/scratch laminate (gloss reflects and breaks scans). Metal blocks
  NFC, so it needs an on-metal chip with a ferrite layer (thicker, more expensive).
- Heat: up to 80–90 °C behind glass in summer; adhesive, ink and inlay must be rated for cars.
- QR rules for both: ECL Q (already used), quiet zone ≥ 4 modules, module ≥ 0.8–1 mm, black on white,
  matt surface; the current 80 × 80 mm decal fits.

## 10. Tests

- API: the job ticket of an `nfc_vinyl_sticker` order carries `nfc.url` equal to the QR URL;
  `quantity > 1` refused; the ops endpoints check the permission and write the audit entry; stage 2:
  valid tap, wrong CMAC, replayed counter, unknown UID.
- Ops E2E: the „NFC schreiben“ page with a mocked `NDEFReader`.
- Manual: write and lock a real NTAG213; read it with an iPhone and an Android phone through a
  windscreen and a side window; try to rewrite it (must fail).

## 11. Owner decisions (2026-11-27)

The questions below were answered on 2026-11-27; the task that builds them is
[`docs/nfc-sticker-prompt.md`](nfc-sticker-prompt.md). Where this spec says otherwise, the decisions win:

- The NFC sticker **replaces** the printed decal and is **generic** (no vehicle name, no chosen design;
  the free PDF keeps both). The lawyer accepted it.
- **One code per vehicle** for QR, NFC, app and PDF (`park-shield.de/s/<code>`).
- Stickers come **from our own stock** (`fulfillment.mode = from_stock`), produced in batches; the code
  is **active at once**, no manual activation. The vehicle's old code keeps working until the owner tests
  the new sticker in the app, or a set number of days after shipping (default 14).
- **Inside the glass only.** Chip **NTAG215**, static URL (stage 1 only, no NTAG 424 DNA).
- **We print and program ourselves** for now; the chip is locked permanently after the check.

## 11a. The original open questions (2026-11-26)

1. Placement: inside the glass only, or also a body version (on-metal chip)?
2. Stage 1 first, or straight to NTAG 424 DNA?
3. Price: is NFC part of the 3 € printed decal, or an add-on with its own price (`app_settings`)? The
   old add-on prices in `docs/05-business.md` (3,00 € upgrade, 8,90 € extra decal) date from before the
   single plan.
4. Print partner with NFC encoding (ties in with the open print-partner item in `AGENTS.md` §11).
5. Legal: the store listings and the privacy policy need no change for stage 1 (the chip holds the same
   URL as the QR code); stage 2 stores a tap counter per decal — the lawyer should confirm the privacy
   policy wording (`LEGAL_REVIEW.md`).
