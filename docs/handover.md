# Handover — single plan, app-only alerts, escalation, Sperren, UI update

**Read this first if you continue this work.** It is kept current with every commit (owner rule in
`CLAUDE.md`). The full task is [single-plan-update-prompt.md](single-plan-update-prompt.md); the owner's
answers and the design sheets are summarised below.

_Last updated: 2026-11-28 (app paywall: both buttons inside the plan card like the website; needs an EAS build). Before: 2026-11-28 (dark navy design step 2: dark title band on every other page; deployed `8527c19`). Before: 2026-11-28 (home page in the dark navy design, step 1 of 2; deployed `51f1fc2`). Before: 2026-11-27 (website explains QR + NFC with the new sticker; deployed `9e984ff`). Before: 2026-11-27 (owner sticker design in the batch print file, `layoutStockSticker`). Before: 2026-11-27 (test guide §12a: NFC sticker scenarios). Before: 2026-11-27 (test server: all test customers and their orders deleted, §27). Before: 2026-11-27 (NFC stickers deployed to the test server, `662a338`, still on demand, §27). Before: 2026-11-27 (NFC stickers Phase 5 done: stock overview, low-stock warning, lost batch; all five phases built, §27; not deployed). Before: 2026-11-27 (NFC stickers Phase 4 done: app sticker card and change-over notice, texts, shipping mail, §27; not deployed, app needs an EAS build). Before: 2026-11-27 (NFC stickers Phase 3 done: change-over from the old code to the packed stock sticker, §27; not deployed). Before: 2026-11-27 (NFC stickers Phase 2 done: write, check and lock the chip in ops, packing gate, §27; not deployed). Before: 2026-11-27 (NFC stickers Phase 1 done: in-house batches, serials, exports, „Aufkleber-Lager“, §27; not deployed). Before: 2026-11-27 (NFC sticker plan, Phase 0, `docs/nfc-sticker-plan.md`, waiting for approval; §27). Before: 2026-11-27 (NFC sticker decisions and the task prompt `docs/nfc-sticker-prompt.md`, §27). Before: 2026-11-27 (CI green again: the app's icon list got `moon`, the contract mail test the `lifetime` value). Before: 2026-11-27 (`/favicon.ico` with the current logo, deployed `8890db7`, §26). Before: 2026-11-26 (home page: four new parts after comparing a competitor site, deployed `288e6db`, §24). Before: 2026-11-26 („Bin gleich zurück“ tested on an Android phone, two app fixes, §23). Before: 2026-11-26 („Bin gleich zurück“ deployed to the test server `9618790`, §23). Before: 2026-11-26 (QA case file 1.1: expected results checked against the build, §22). Before: 2026-11-26 (scan page asked for basic auth after „Senden“: `/scanner-assets/*` opened in the Caddyfile, §21, deployed `cf1a6ca`). Before: 2026-11-26 (QA fixes deployed `7c15291`, §20). Before: 2026-11-26 (all 213 QA cases run, 5 defects fixed, §20). Before: 2026-11-26 (NFC decal spec; company block in the website footer, deployed `f743aae`, §19). Before: 2026-11-25 (first Google Play purchase works, §17). Before: 2026-11-25 (deployed `7726a04`: the app says why a plan ended, clear store purchase errors, §17). Before: 2026-11-25 (website: one logo source, pages open at the top, deployed `162ec31`, §16). Before: 2026-11-25 (deployed `1a13c01` to the test server, §15b). Before: 2026-11-25 (owner decisions on the QA findings: first lock without cooldown, paywall, receipt print/PDF, localized `<title>`, worker warn, §15b). Before: 2026-11-25 (full QA run on web, iOS, Android, e-mails and ops; fixes and open findings in §15). Before: 2026-11-24 (owner decisions on `/aktivieren`, `/antwort`, passkeys and the first code done, §14). Before: 2026-11-24 (all 4 phases done: app UI for the new code, §14). Before: 2026-11-24 (phase 3: paid 3 € new code through Stripe, refunds keep the code, Customer 360, §14). Before: 2026-11-24 (phase 2: new-code rules, 10-day cooldown, free once per year, §14). Before: 2026-11-24 (phase 1: website without sign-in, portal and checkout, §14). Before: 2026-11-24 (park-shield.de switched to the server, §13). Before: 2026-11-24 (`__Host-` cookies, Vercel dropped, §13). Before: 2026-11-24 (website e-mail change, scanner 110/112 links, trusted-contact clean-up, ops subscription source, Google Play pause, §12). Before: 2026-11-24 (Konto: change e-mail and mobile number, §11). Before: 2026-11-23 (USt-IdNr. in the e-mail footer and support replies via Webmail signatures, §10). Before: 2026-11-23 (in-app contact form and the renewal reminder fix, §9). Before: 2026-11-22 (evening). **Unified billing (RevenueCat + Stripe) and the personalised sticker are implemented** (§8, `docs/billing-unified.md`). Earlier the same day: **the seven fix prompts of 2026-11-22 are implemented, tested and pushed** (see §7): block state + unblock, Alerts screen design, German default + onboarding + sign-out, badge, website footer, unified e-mail layout + contract PDF, support@/payment@ routing. API 615 tests, app Jest 152, typecheck, lint, prettier, db:check green. Deployed to the test server with this commit; the app changes need a new EAS build._

---

## 1. Owner decisions (answers 2026-11-21, binding)

| #   | Question                                   | Decision                                                                                                       |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | Trusted contacts (Notfallkontakte)         | **Remove completely** (feature, pages, data). Only the owner is escalated to (push → SMS).                    |
| 2   | Vehicles per plan                          | **One plan for one vehicle** (`limits.vehicles` = 1). A second car needs a second account for now.            |
| 3   | Existing 10 € / 15 € test subscriptions    | **All move to the single 20 € plan** (only test subscriptions exist). Note for real customers in LEGAL_REVIEW. |
| 4   | Lawyer approval date of annual renewal     | **2026-11-21** (today) → `LEGAL_REVIEW.md`.                                                                    |
| 5   | Old accounts without a phone number        | **Must complete the account** (blocking „Konto vervollständigen“, alerts are never blocked).                  |
| 6   | SMS during quiet hours                     | **Never**, not even for urgent alerts (urgent bypass is for the app push only).                               |
| 7   | Test alerts                                | **No SMS**; the 10-minute reminder push is sent.                                                               |
| 8   | Website portal `/konto/*`                  | **Update it the same way** as the app (pricing, terms, contract card, Sperren, print, notifications).          |
| 9   | Authenticity notice on the scanner page    | **„Nur echt auf park-shield.de“** (not pkshd.de). `SCANNER_BASE_URL` in production = `https://park-shield.de`. |
| 10  | Paper-clip icon in the scanner chat input  | **Remove** — chat is text only; photos only in the report form.                                                |
| 11  | Second vehicle                             | Temporarily one vehicle; may be improved later.                                                                |

## 2. Progress

Legend: ✅ done and tested · 🟡 code written, tests/UI open · ⬜ not started.

### Stage 1 — single plan, phone, contract card, Sperren, print

- ✅ Migration `20261206000000_single_plan.sql`: enum `plan_code` = `standard` only, price 2000, limits,
  all subscriptions → `standard` + `annual`, `users.free_welcome_print_used`, `decal_orders.paid_print`.
- ✅ `packages/shared/src/plans.ts`: `PlanCode = 'standard'`, `PLAN_PRICE_CENTS = 2000`,
  `ADDON_PRICES_CENTS.printShipped = 300`, `PLAN_FEATURE_COUNT = 6` (i18n keys `landing.planF1..6`).
- ✅ Legal texts in `packages/shared/src/legal-content.ts` (AGB §1/§3, privacy phone section) with
  `TODO [LEGAL REVIEW]`.
- 🟡 API: `EntitlementService` (no plan gating), billing (`plans()`, `yearPrice()` from setting
  `prices.plan_year_cents`, checkout needs verified phone → 409 `phone_required`), Stripe env
  `STRIPE_PRICE_YEARLY` / `STRIPE_PRICE_MONTHLY` (old `STRIPE_PRICE_PLUS_*`/`PREMIUM_*` removed).
- 🟡 Phone: `ChannelsService.startPhone/verifyPhone` use Twilio Lookup (mobile only) + Verify when
  `TWILIO_VERIFY_SERVICE_SID` is set, else own OTP; countries setting `owner_phone.countries` (DE+EU);
  `DELETE /v1/channels/sms` → 409 `phone_required` (change only); `GET /v1/me/profile` has `phoneVerified`.
- 🟡 Sperren: `POST /v1/vehicles/:id/tokens/revoke` (no new code), `POST /v1/vehicles/:id/tokens`
  (new code, free, 409 `code_active` while one is active, keeps the last design).
- 🟡 Print: `GET /v1/vehicles/:id/print-options`, `POST /v1/vehicles/:id/order-print` (free welcome print
  once, then ops-granted free replacements, then 3 € Stripe one-time; `order-included`/`order-replacement`
  are aliases). Setting `prices.print_shipped_cents` = 300.
- ✅ Home PDF: 80 × 80 mm with cut marks + weatherproof notice; `decal.png` (300 dpi), `decal-download.svg`.
- ✅ i18n for the website (landing.planF1..6 etc.), web `/konto/*`, pricing, help articles, contacts pages
  removed (typecheck, lint, build, i18n parity pass; not yet tested in a browser / E2E).
- ⬜ App: paywall `/tarif`, `/abo` contract card, sign-up phone step, completion gate for phone,
  Sperren dialog, „Kein aktiver Code“ state, print options screen.
- ⬜ API tests rewritten (see §4), E2E.
- ⬜ `LEGAL_REVIEW.md` (approval date 2026-11-21, §356a card, €3 print withdrawal), `docs/status.md`.

### Stage 2 — app-only alerts and escalation

- ✅ Migration `20261206000100_owner_escalation.sql`: `alerts.escalation_stage` (`none`,
  `reminder_sent`, `sms_sent`), `sms_due_at`, `sms_sent_at`, `escalation_stopped_at`,
  `escalation_stop_reason`, `resolved_at`; trusted contacts data deleted (table kept, empty).
- 🟡 Contacts module and the contact escalation chain deleted (`contacts/*`, `escalation.service.ts`).
- 🟡 `OwnerReminderService` (`notifications/owner-reminder.service.ts`): `initialTimes()` (reminder
  10 min, SMS 30 min, none for tests), `sweep()` reminder, `sweepSms()` single SMS, `stop()`; settings
  `escalation.reminder_minutes`, `escalation.sms_minutes`; worker sweeps every 5 s.
- 🟡 Stop conditions via `stopEscalation()` (`notifications/escalation.ts`): ack/reply (`AckService`),
  chat open + owner chat message (`ChatService`), resolve (`POST /v1/app/alerts/:id/resolve`).
  **Block sender → still to wire in Stage 3.** Seen does not stop.
- 🟡 `DispatchService`: alerts → `native_push` only; no e-mail; no web push; reminder push only;
  `escalateSms()` (quiet hours → suppressed, cap → suppressed `fair_use` + log); push payload
  generic text + `{ alertId, kind }`.
- 🟡 `FairUseService`: cap = `sms.monthly_cap` (20), no e-mail, `capReached` in usage.
- ⬜ Notification settings screen (app + web): push status + permission button, verified number,
  quiet hours; remove e-mail/channel order. Persistent warning „Mitteilungen sind aus. Sie erfahren
  von Warnungen erst nach 30 Minuten per SMS.“
- ⬜ Tests: no alert e-mail; payload; 10-min reminder; one SMS at 30 min; every stop condition; seen
  does not stop; sweeper recovery; cap.

### Stage 3 — block sender and chat (🟡 API done, UI open)

- 🟡 API: `HistoryService.block`, `POST /v1/app/alerts/:id/block`, `POST /v1/alerts/:id/block`,
  `ChatService.closeBlocked` (reason `blocked`, migration `20261206000200_block_sender`).
- ✅ App: „Absender blockieren“ on the alert card, detail and chat (`components/block-sender.tsx`);
  web history's existing „Absender blockieren“ now ends the chat and the escalation too.


Existing: `HistoryService` „Absender blockieren“ (`history/history.service.ts` ~line 150, uses
`scanner_blocks` by `block_ref`, phone bans, Protected Mode), `ChatService.senderBlocked`. To do: block
button on alert card / detail / chat (app) + history; on block: close chat (scanner sees „Der Chat wurde
beendet.“), `stopEscalation('blocked')`, existing abuse module only (no new identifiers, no storage).

### Stage 4 — home, vehicle photo, design refresh, scanner UI

- ✅ Scanner page redesign (`apps/web/lib/scanner/*`, select card then „Warnung senden“, ~71 KB).
- ✅ App Home (greeting, status, decal preview, no alert cards, tab badge), vehicle photo on device
  (`lib/vehicle-photo.ts`, `/fahrzeug/foto/[id]`, expo-image-picker ~58.0.10 — needs a new dev/EAS
  build), design refresh after saving (listeners + `k=` cache key). Not tried on a real device.


See §3 for the designs.

## 3. Designs to build (from the owner's reference sheets)

The original sheets were shared in chat (they show a real test account's e-mail, so they are **not**
committed to this public repo). Ask the owner for them if you need the pixels. Visual language:

- **General:** light background (very light blue-grey), white cards with soft 1 px borders and large
  radius (~16 px), soft shadow; primary blue CTAs full width, pill/rounded (~14 px), bold white text;
  secondary buttons = white with blue 1.5 px border and blue text; line illustrations in blue with a
  yellow accent; headings Plus Jakarta Sans bold; body system font; green „Active“ pills, yellow
  „1 step left“ pills, red danger cards (light red background, red border, red text).
- **Bottom tab bar (4):** Home · Alerts · Vehicles · Account; active tab blue icon + blue label, others
  grey; **Alerts tab gets an unread/open badge** (red dot/count).
- **Home:** header with bell (left, red dot when open alerts) · ParkShield logo (centre) · person icon
  (right); greeting „Hallo {Vorname}“ / „Welcome back, {first name}“; big car card (blue car
  illustration with QR on the roof, light blue rounded background) — **tap the car to pick a photo**;
  title „“{nickname}” is protected / almost protected“ + status pill; „Next step (2 of 3) · Test your
  decal“ card with blue „Test now ▶“; footer line „✓ No open alerts“. **No alert cards on Home.**
  Add: compact preview of the current QR sticker (style, headline, status) with quick actions „Ansehen/
  Testen“ and „Design bearbeiten“. Warning state: „Kein aktiver Code – Ihr Fahrzeug ist nicht
  geschützt“ + „Neuen Code erstellen“.
- **Alerts:** segmented control „Current | History (90 days)“ (blue filled active segment); cards with
  icon, type, nickname in quotes, time right, status pill (Done green, Expired grey, Test grey); urgent
  cards red border + light red background. Add „Absender blockieren“ on the card.
- **Vehicles & QR codes:** header with „+ Add vehicle“ (hide/disable: one vehicle); vehicle row with
  sticker thumbnail, nickname, plate, „Decal: active“ green pill.
- **Plan & Invoices / Subscription details:** plan card „ParkShield · Active“, contract number, renews
  on; „Change payment method“ outlined button; „Your plan includes“ list with green checks — replace
  with the single-plan list (1 vehicle, push alerts, reminder after 10 min, one SMS after 30 min, alert
  photos, anonymous chat, one free printed decal); „Invoices“ row. **Remove „Upgrade to Premium“.**
  Contract card per prompt §1.3 („Vertrag“: withdrawal part only during the period, then cancel part).
- **Account:** profile card (initials avatar, name, e-mail, customer number), list rows with chevrons
  (Your details, Plan & invoices, Data & export, Help & support, Notification settings, Language),
  red outlined „Log out“.
- **Your details / sign-up address:** labelled inputs, Germany flag select, blue „Save changes“.
- **Data & export:** Download JSON (blue) / Download PDF (outlined), red „Delete account“ card.
- **Help & support / Didn't get the alert?:** headset / phone illustrations, checklist with green ✓ and
  yellow ! rows — change „No SMS number (included in Premium)“ to „Handynummer nicht bestätigt“.
- **Onboarding (4 scenes)** „Welcome to ParkShield“, „Someone notices a problem with your car“, „You know
  at once“ (text → „per App – und per SMS, wenn Sie nicht reagieren“), „You reply, anonymously“; dots;
  blue CTA; „I already have an account“ link.
- **Create account:** steps with progress bar: 1 e-mail + 6-digit code, 2 address, **3 mobile number +
  SMS code (new, required)**, 4 plan summary (single plan, no Plus/Premium choice), 5 consent + „Zahlungs-
  pflichtig bestellen – 20 € / Jahr“ with „Secure and encrypted“ lock line.
- **Notifications (settings):** bell illustration header; rows: Mobile number (verified, masked,
  „SMS nach 30 Min ohne Reaktion“), App notifications (Active pill, device, last active, button to
  open system settings), Quiet hours (moon icon, days chips with blue checkboxes, From/To time selects,
  info line about past-midnight, „Still deliver urgent alerts“ toggle = push only, blue „Add quiet
  hours“). **Remove** Push (browser), E-mail and Order of channels rows/screens.
- **Scanner `/s/<code>` (web, plain HTML):** header logo + DE/EN segmented toggle (EN active blue);
  „Test mode“ info banner (flask icon, light blue); „What is the problem?“ H1 + subtitle; optional
  vehicle description input with car icon; 2-column grid of 6 problem cards (urgent ones light red with
  red icon; selected = red border + red check badge top-right); big blue gradient „Custom message“
  card with chat illustration and chevron; „Photos (optional)“ with two dashed upload boxes „+ Add
  photo 1/2“; „Decal looks suspicious?“ link row with shield icon; full-width blue „Send report“ with
  paper-plane icon; footer: shield „Genuine page: **park-shield.de** · ParkShield never asks for
  payment“ + „Protect your car too? park-shield.de ↗“.
- **Scanner status page:** same header + test banner; „Status of your alert“ stepper Sent → Delivered
  → Confirmed (blue filled circles with checks, grey outline for pending); info box „The vehicle owner
  has been notified.“; „Chat with the vehicle owner“ card: system bubble (light blue), owner bubble
  (grey, car avatar, „Vehicle owner · time“), own bubble (blue, right, ✓✓ read time); input „Type your
  reply…“ (**no paper clip**) + round blue send button; rules line „No phone numbers, links or e-mail
  addresses. Up to 500 characters.“ + counters „0 of 500 characters · 20 of 20 messages left“;
  outlined „+ Send another alert“; „Decal looks suspicious?“; red triangle „In real danger: 110 (police)
  or 112 (fire, ambulance).“; authenticity footer as above. **Blocked/closed chat state:** input hidden,
  grey note „Der Chat wurde beendet.“

## 4. How to test

- API: `cd apps/api && npx vitest run` (needs PostgreSQL + Valkey on 6380; see AGENTS.md §4).
  Baseline before this work: 46 files / 509 tests green.
- Build the shared packages first: `npx turbo run build --filter=@parkshield/shared --filter=@parkshield/i18n`.
- Node 24 (`/opt/node24/bin` in the cloud container).

## 4a. State of the work in the tree (if you take over now)

- **API tests** (`apps/api/src/**/*.test.ts`): being rewritten for the new rules; partially done
  (billing, sync, channels, letters, escalation.test.ts new, sms-templates, back-office, orders,
  preferences, scan). Still open at the stop: privacy, profile, routes (security registry), the
  Stage 3 block tests. Run `cd apps/api && npx vitest run`, fix until green.
- **App** (`apps/mobile`): Stage 1+2 screens partially done (abo contract card, subscription,
  profil phone step, alert detail escalation stage + „Erledigt“, vehicle Sperren + print screen
  `fahrzeug/drucken/[id].tsx`). Still open at the stop: push-off warning banner component,
  „Kein aktiver Code“ component on Home/Vehicles, notifications screen cleanup, Jest tests.
- **Not started:** Stage 3 UI (block buttons app + web history), Stage 4 app (Home without alert
  cards + tab badge, on-device vehicle photo with expo-image-picker, design refresh after
  „Design speichern“), E2E updates for phone-before-checkout / Sperren dialog / removed pages, a full
  manual run of the stack as a real user.

## 4b. Real-user run on the local stack (2026-11-21, Playwright script, 390 px)

All passed: landing shows 20 €/Jahr and no Plus/Premium → sign-up by magic link → name/address →
landline rejected („Festnetz- und Internetnummern können keine SMS empfangen“) → mobile number
verified with the SMS code → „Zahlungspflichtig bestellen – 20 € / Jahr“ → subscription `standard`,
`annual`, 365 days → `/konto/abo` shows „Vertrag widerrufen“ during the period, no Premium → one
vehicle, add form hidden → test alert → real alert: `remind_at` +10 min, `sms_due_at` +30 min, no SMS
and no e-mail at alert time → reminder stage → exactly one SMS (157 chars, GSM-7, view link) → still no
alert e-mail → „Absender blockieren“ in the history: chat `closed|blocked`, stop reason `blocked`,
scanner page shows „Der Chat wurde beendet.“ → Sperren dialog with the exact four facts → no active
code, warning shown, old code scans as inactive → „Neuen Code erstellen“ → print section: self-print
free (80 × 80 mm with cut marks), shipped „kostenlos (Willkommensdruck)“ → PDF/PNG/SVG downloads 200.

## 5. Next steps (in order)

1. Fix/rewrite the API tests for the new behaviour; add the Stage 1 and 2 tests listed in the prompt.
2. i18n texts; web portal; app screens (Stage 1 + 2 UI).
3. Stage 3, then Stage 4.
4. `LEGAL_REVIEW.md`, `docs/status.md`, `AGENTS.md` (channel matrix, plans, Stripe env) at each stage.

## 6. Open items after the code (owner / deploy)

Done on 2026-11-21/22 (deploy and real run on the test server, see `docs/status.md` §1a):

- ✅ Stripe test price 20 € / year (tax-inclusive) → `STRIPE_PRICE_YEARLY`; old `STRIPE_PRICE_PLUS_*` /
  `PREMIUM_*` removed from `server.env`.
- ✅ Twilio Verify service → `TWILIO_VERIFY_SERVICE_SID` (owners' numbers checked for real).
- ✅ Deployed `1e9bc1c` (= `e19a9e4` + a CLAUDE.md change); migrations 20261206000000/0100/0200 applied.
- ✅ EAS iOS preview build from `82d9d98` (build `74cdacab-1d7f-44a8-a0c3-985a19fef589`).
- ✅ Test guide updated (`docs/test-guide.md`), all old test customers deleted.

Still open:

1. `SCANNER_BASE_URL=https://park-shield.de` in production; 301 from `pkshd.de/s/*` if old decals exist.
2. Push on a real device: install the new build, sign in, check alert / reminder push and the „Ich
   komme“ action (Expo Go in the simulator cannot receive FCM). Vehicle photo on a device.
3. Next app build must include `b446f6b` (permission screen text: the push is generic).
   **Android push prepared 2026-11-23** (not built yet, owner's choice): Firebase Android app
   `de.parkshield.app`, `google-services.json` uploaded to EAS as the secret file variable
   `GOOGLE_SERVICES_JSON` (preview + production), `eas.json` preview builds an APK. Next:
   `npx eas-cli@latest build --platform android --profile preview` (steps in
   `apps/mobile/firebase/README.md` → „Android“). After pulling, run `npm ci` in `apps/mobile`:
   new native modules (`expo-font`, `expo-image-picker`, …) make `expo config` fail otherwise.
4. Lawyer: `LEGAL_REVIEW.md` §9 (price change, phone purpose, § 356a card, 3 € print withdrawal).
5. ~~Small follow-ups: 110/112 as tappable links on the scanner page; contact texts; clean-up
   migration~~ (done 2026-11-24, §12). Left on purpose: `alert_types.escalates`, `alerts.escalate_at` /
   `escalated_at` and `notification_rules.escalation_minutes` are still read by old code paths (privacy
   export, history); a later migration can drop them with that code.
6. Findings of the real run (2026-11-22): ~~the vehicle row „Druck oder Versand“ shows no price after
   the welcome print was used~~ (fixed 2026-11-22: it shows „3,00 € einmalig inkl. MwSt.“); ~~the
   Warnungen tab badge still counts an alert whose sender was blocked as open~~ (fixed 2026-11-22: the
   badge counts unopened alerts from the server); right-aligned free-text fields on an RTL keyboard are
   intended (P16 in `components/form.tsx`: only e-mail, codes, numbers and postcodes are forced LTR); the
   3 € paid print was not paid in the run.

## 7. Fix prompts of 2026-11-22 (`ParkShield-Fix-Prompts.md`, all seven done)

| # | What | Where |
| - | ---- | ----- |
| 1 | Block state per alert from the server (`senderBlocked`, `blockedUntil`), „Blockierung aufheben“ (`POST /v1/app/alerts/:id/unblock-sender`, audited, idempotent; chat stays closed); every card of the sender updates at once | `abuse/sender-block.service.ts`, `history.service.ts`, app `alert-card.tsx`, `alerts-store.tsx` |
| 2 | Alerts screen design (own header, blue segmented switch, tinted icon squares, pills, purple custom-message cards, block footer) | app `(tabs)/alerts.tsx`, `alert-card.tsx`, `block-sender.tsx` |
| 3 | German by default, four onboarding slides incl. 20 € / year, „Sprache“ in Konto (device + account), full sign-out back to slide 1 | app `lib/language.ts`, `willkommen.tsx`, `lib/auth.tsx` |
| 4 | Badge = unopened alerts from the server (`unseenCount`, `/unseen-count`, push `aps.badge`), opening an alert stops the reminder and the SMS (also when already queued), icon badge | `notifications/unseen.ts`, `app-alerts.service.ts`, `dispatch.service.ts` |
| 5 | Website footer like the image (2 × 2 on phones, 4 columns from 768 px, § 312k / § 356a labels) | web `components/site-chrome.tsx`, i18n `common.siteFooter` |
| 6 | One e-mail layout for every mail; contract confirmation with the PDF „Vertragsbestätigung“; sent versions in `contract_confirmations` | `mail/layout.ts`, `billing/contract-confirmation.ts` |
| 7 | Contact form → `SUPPORT_EMAIL` (reply-to customer) + customer receipt; payments → `PAYMENT_NOTIFY_EMAIL` with the letter PDF (`payment_notifications`) | `support/*`, `billing/payment-notify.*` |

Open after these:

- **Mailboxes:** create `support@park-shield.de` and `payment@park-shield.de` at Strato (EU) with a
  deletion rule for payment@ (LEGAL_REVIEW.md §11); the test server still sends support mails to
  `SUPPORT_EMAIL=contact@park-shield.de` (server.env) until that is changed.
- **App build:** a new EAS build is needed for prompts 1–4 (the server part is live).
- **Lawyer:** LEGAL_REVIEW.md §10 (contract PDF, English model withdrawal form) and §11.
- The „print-order letter“ of prompt 7 is the customer's current letter from the one generator (the
  same PDF as the admin download); a dedicated print-order letter text would be a new letter type.

## 8. Unified billing and the personalised sticker (2026-11-22, `ParkShield-Billing-and-Sticker-Prompt.md`)

Option **A** (owner OK 2026-11-22): our backend is the entitlement hub; design and API contract in
[billing-unified.md](billing-unified.md), legal questions in `LEGAL_REVIEW.md` §12.

Done (API 640+ tests, app Jest 162, typecheck, lint, prettier green):

- Migration `20261208000000_unified_billing` (provider, store ids, will_renew, refunded_at,
  sticker_value_cents, withdrawal_notice_version; `billing_webhook_events`; order snapshot).
- RevenueCat: adapter + fake (`providers/revenuecat.ts`), webhook `POST /v1/webhooks/revenuecat`
  (Authorization secret, event ids once, outbox topic `store.sync`), `StoreSyncService` (REST
  subscriber is the truth; contract mail + payment@ once per new subscription; renewals → payment@
  only; refunds cancel unpersonalised orders), `POST /v1/billing/store/prepare|sync`, unified status in
  `GET /v1/billing/subscription`, user id in `GET /v1/me`.
- Stripe: durable event dedupe, `payment_intent.succeeded` and `charge.refunded`; subscription
  description with the price breakdown; 3 € print creates a Stripe customer for store subscribers.
- Part B: vehicle label 2–20 chars + bad-word filter, printed on every design; print confirmation step
  (app + web) with frozen `design_snapshot`; welcome print CTA + push reminders after 1 and 3 days;
  B4 refund formula (whole days, sticker 3 € after personalisation) with the breakdown in the refund
  mail; store subscriptions never run our refund logic.
- App: `react-native-purchases` (needs a new EAS build), paywall with store price, restore purchases,
  store manage/refund routes. Web: checkout breakdown + notice, store subscriber views, print step,
  Datenschutz (RevenueCat) and Widerrufsbelehrung `2026-11-28`.

Still open (owner accounts):

1. ✅ 2026-11-22: RevenueCat webhook → `https://test.park-shield.de/v1/webhooks/revenuecat` (test event
   received and stored), `REVENUECAT_WEBHOOK_AUTH` and the v1 `REVENUECAT_SECRET_KEY` in `server.env`
   (REST call verified). Still open: App Store / Play apps in RevenueCat (P8 key, product), offering.
2. ✅ 2026-11-22: EAS env `preview` has `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `…_ANDROID_KEY` = the
   RevenueCat **Test Store** public key (sandbox purchases without the stores; the API accepts
   `TEST_STORE` only on test environments). Offering `default` (current) has the Test Store `yearly`
   package. Replace both with the `appl_…` / `goog_…` keys once the store apps exist.
   ✅ 2026-11-23 App Store Connect: app „ParkShield“ (`de.parkshield.app`, SKU `parkshield-ios`,
   German), subscription group `ParkShield`, auto-renewable `parkshield_yearly` (1 year, Germany only,
   **19,99 €** — owner decision, 20,00 € is no App Store price point; the web stays 20,00 €), German
   display name „ParkShield Jahresabo“. Still open there: P8 in-app purchase key → RevenueCat iOS app,
   review screenshot of the paywall (needed when the first version is submitted).
   ✅ 2026-11-23 RevenueCat: iOS app „ParkShield iOS“ (P8 key uploaded by the owner), product
   `parkshield_yearly` attached to `parkshield_pro` and to the `$rc_annual` package of offering
   `default` (next to the Test Store `yearly`). EAS `preview`: `EXPO_PUBLIC_REVENUECAT_IOS_KEY` = the
   `appl_…` key (Apple sandbox purchases; needs a Sandbox Tester); Android still the Test Store key.
   App Store Connect / Play Console: the yearly subscription product (20,00 € or 19,99 €), sandbox
   tester, Play internal test track; EAS env `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `…_ANDROID_KEY`, new
   development build (Expo Go cannot buy).
3. Stripe test webhook: add `payment_intent.succeeded` and `charge.refunded` to the endpoint's events.
4. Lawyer: `LEGAL_REVIEW.md` §12.
5. ✅ 2026-11-23 First real Apple sandbox purchase (iPhone, `appl_` key): stayed „pending“ because the
   RevenueCat REST API reports `store: "app_store"` in lower case; fixed in `6f2f019` (case-insensitive
   `storeProvider()`), deployed; subscription active, contract confirmation and payment@ sent once.
   App paywall: store price (19,99 €) everywhere and a store-specific pending text (`6d0d84b`, needs a
   new EAS build). Onboarding slide: ✅ 2026-11-23 owner decision: the app shows the store price „19,99 €“ (`STORE_PLAN_PRICE_CENTS`, also the paywall default before the store price loads); the web stays 20,00 €.
6. ✅ 2026-11-23 Logo: e-mails and the contract PDF use the app's mark (shield with the QR finder
   pattern, `LogoMark`), not the old star shield. E-mail files `apps/web/public/email/parkshield-logo.png`
   (footer) and `parkshield-logo-tile.png` (white tile for the blue header); the old
   `parkshield-shield.png` now holds the new mark too, so mails already sent show it. They are served
   from `park-shield.de` (Vercel until the switch-over, then our server, §13): deploy after changing them. Dark mode in mail apps
   stays as it is (owner, 2026-11-23).
7. ✅ 2026-11-23 Store price in the contract confirmation: store subscriptions keep the price the store
   charged (`subscriptions.store_price_cents`, from RevenueCat `subscriptions[].price`, fallback setting
   `prices.store_year_cents` = 1999). E-mail, PDF and payment@ show 19,99 € for App Store purchases;
   the web stays 20,00 €.
8. ✅ 2026-11-23 Contract confirmation redesign (owner prompt with reference screenshots): shared e-mail
   blocks in `mail/layout.ts` (success badge, details table, info cards, help row, footer with
   Impressum and support e-mail) usable by every template (`badge`, `blocks` in `mail/templates.ts`);
   icons in `mail/icons.ts`, PNGs from `node --import tsx scripts/email-assets.ts` into
   `apps/web/public/email/`. New contract e-mail (summary table, provider card, documents, term and
   withdrawal, declaration, „Abo verwalten“ → `/konto/abo`). New PDF: page 1 contract at a glance (with
   customer and provider), page 2 legal information, appendix A AGB and B Widerrufsbelehrung + full
   statutory model form; Plus Jakarta Sans headings (`apps/api/assets/fonts`, copied in the Dockerfile).
   Contract start = first purchase; sandbox dates with time. Open legal points: `LEGAL_REVIEW.md` §13.
9. ✅ 2026-11-23 E-mail images (logo, icons) showed as empty boxes in Yahoo Mail: the server accepted
   TLS 1.3 only and Yahoo's image proxy connects with TLS 1.2. Caddy (test stack and the production
   template) now allows TLS 1.2 with forward-secret AEAD suites only, plus TLS 1.3; the ops subdomain
   stays TLS 1.3 only. Owner decision; docs/02-architecture.md and docs/security/asvs-l2.md updated.
10. 2026-11-23 Google Play: app „ParkShield“ (`de.parkshield.app`, default language German, free app,
    declarations accepted by the owner) created in the owner's **personal** Play developer account.
    Google Cloud project `parkshield-play` (same Google account): Play Android Developer API, Play
    Developer Reporting API and Pub/Sub enabled; service account
    `revenuecat@parkshield-play.iam.gserviceaccount.com` (Pub/Sub Admin, Monitoring Viewer) invited in
    Play Console with view app information, view financial data and manage orders and subscriptions.
    RevenueCat: app „ParkShield Android“ (`de.parkshield.app`); EAS `preview`
    `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` = its `goog_…` key (Android no longer uses the Test Store).
    EAS profile `play-internal` (preview env + test API, app bundle, store distribution, EAS-made
    upload keystore) builds the AAB for the first manual upload to the internal test track.
    ✅ 2026-11-24: payments profile (organisation, bank verification pending), first bundle
    (versionCode 4, `play-internal`) uploaded and saved as an internal-testing **draft**; subscription
    `parkshield_yearly`, base plan `yearly` (auto-renewing, yearly, 14-day grace, Germany only,
    **19,99 €** incl. 19 % VAT) active; RevenueCat: service-account JSON uploaded by the owner, product
    `parkshield_yearly:yearly` imported, attached to `parkshield_pro` and to the `$rc_annual` package of
    `default`; Google developer notifications connected (topic
    `projects/parkshield-play/topics/Play-Store-Notifications`, set in Play Console → Monetization
    setup); test server `APP_ANDROID_PACKAGE` / `APP_ANDROID_SHA256` (Play App Signing key) set,
    `/.well-known/assetlinks.json` serves it. Android manifest fix: `apps/mobile/firebase.json` (FCM
    default channel = expo-notifications `alerts`).
    ✅ 2026-11-24 iOS: RevenueCat now has the App Store Connect API key (owner, „Valid credentials“);
    the iOS product moved from „Could not check“ to „Missing Metadata“. Added the German localization
    of the subscription group („ParkShield“, app name). Review screenshot of the paywall (1290 × 2796) uploaded
    on `parkshield_yearly`; RevenueCat shows the iOS product as „Ready to Submit“ (it goes to review with
    the first app version). Apple server notifications:
    ✅ RevenueCat „Apply in App Store Connect“ set the production and sandbox URLs (App Information).
    ✅ 2026-11-24: internal testers = e-mail list „ParkShield intern“ (2 owner accounts; the earlier
    48-tester list was deleted on the owner's request); release 4 (1.0.0) published to internal testers (opt-in link
    `https://play.google.com/apps/internaltest/4700661487824769350`, temporary name until review).
    RevenueCat Android: „Valid credentials“ (all three checks), Google test notification received.
    ✅ 2026-11-24 bug fixed (`d985aad`, deployed): one Apple sandbox ID bought on account A, then
    on account B; RevenueCat transferred the purchase (TRANSFER), B's insert hit A's unique
    (provider, original transaction) key and the app showed „activating takes a moment longer“
    forever. `StoreSyncService.sync` now ends A's rows (id marked `#moved:<row>`) and creates B's
    contract. Test: `store.test.ts` „a store purchase moved to another of our accounts“.
    ✅ 2026-11-25: license testing (Play Console → Manage account → Play apps settings → License
    testing) uses the list „ParkShield intern“ (response RESPOND_NORMALLY): its accounts buy for free.
    Open: closed
    test track for the 12-testers/14-days rule (needs the store listing and the App content forms). Play's subscription „Pause“ is on by default (Monetization
    setup); the backend handles it since 2026-11-24 (§12). A personal
    account must run a closed test (12 testers, 14 days) before production.

## 9. In-app contact form and the hourly renewal reminder (2026-11-23)

- **Bug fixed (`4b38d56`):** a tester got the same „Vertragsverlängerung“ reminder 7 times and then
  every hour. Cause: an App Store **sandbox** subscription, whose „year“ is one hour and renews all
  day; each renewal moved `current_period_end` into the 30-day window again, and the hourly
  `renewals` job mailed again. `RenewalsService.remind()` now only reminds when the period is longer
  than the reminder window (`renewal.reminder_days`). Test: `apps/api/src/billing/renewals.test.ts`.
  Deployed to the test server 2026-11-23 (`88e073f`).
- **In-app contact (`POST /v1/app/support/contact`):** app session (bearer, so no captcha), free
  subject (3–120), reply address pre-filled with the account's and editable, message (10–5000).
  Limits `support.ip`, `support.email` per account and per reply address. Goes through the support
  desk (`SUPPORT_PROVIDER=email` → `SUPPORT_EMAIL`, default support@park-shield.de) in the shared
  e-mail layout with reply-to = the customer, customer and contract number, „Betreff“ line; the
  customer gets `support_received`. Tests: `apps/api/src/support/support.test.ts`.
- **App „Hilfe“ (`apps/mobile/src/app/hilfe.tsx`):** two buttons — „Hilfe-Center und FAQ öffnen“
  (in-app browser, always `https://park-shield.de/hilfe`, `WEBSITE_URL` in `lib/config.ts`) and
  „Kontakt aufnehmen“ (API live on the test server since `88e073f`; form on the same screen with validation, loading state, error banner,
  confirmation with the case number, privacy note + link). Texts in `lib/i18n.ts` (DE/EN). iOS
  EAS build `preview` from `356ae17` finished 2026-11-23 (build `e0bde081`, internal distribution);
  the Android `play-internal` build from `afa22be` includes it too. Test: `src/__tests__/help-screen.test.tsx`.

## 10. Support replies by hand and the USt-IdNr. in the e-mail footer (2026-11-23)

- **Replies to customers** are written by hand in Strato Webmail (no ops inbox, no Zammad for now).
  The shared e-mail layout (`mail/layout.ts`, `replyable: true`) is stored there as two signatures,
  „ParkShield DE“ and „ParkShield EN“, placed above the quoted text; DE is the default for new mails
  and replies on contact@ and on the webmaster mailbox. Webmail „Nachrichtenformat“ is **HTML**
  (with „HTML und Text“ a reply to a plain-text mail, e.g. from mail.de, dropped to plain text).
  Images load from `https://park-shield.de/email/…`, so those files must stay on the website. After a
  layout or company-data change, re-render the body of `renderLayout` and paste it via the
  signature editor's „Quellcode“ button.
- **Footer:** every system e-mail now ends the address line with „USt-IdNr. DE454570643“ (EN „VAT ID
  …“) when the company profile has a VAT ID (`MailFrame.company.vatId`, from ops → Einstellungen →
  Unternehmen, default `COMPANY.vatId`). Test: `apps/api/src/mail/templates.test.ts`. Not deployed
  to the test server yet.

## 11. Change e-mail and mobile number in the app (2026-11-24)

Konto tab → new group „Anmeldung & Kontakt“ with two rows (current e-mail, masked number, „Ändern“).

- **E-mail** (`apps/mobile/src/app/email-aendern.tsx`, API `apps/api/src/profile/email-change.service.ts`):
  `POST /v1/me/email/change {email}` → 6-digit code by e-mail (`email_change_code`) to the **new** address;
  `POST /v1/me/email/change/verify {code}` → `users.email` replaced in place (+ `email_verified_at`, any
  `contact_channels` e-mail row, unused sign-in links spent), audit `user.email_changed` without any
  address, outbox `billing.customer_email` (worker → `BillingService.syncCustomerEmail` → Stripe
  `customers.update(email)`), security notice `email_changed` to the **old** address (new one masked);
  `DELETE /v1/me/email/change` cancels. Nothing in PostgreSQL before the code: the pending change is in
  Valkey (`email:change:<userId>`, 15 min, HMAC of the code, 5 tries). `email_taken` (409) is checked
  at start and again in the transaction; limits `email_change.user` / `.email` (5/h) and `.verify`
  (15/h).
- **Mobile number** (`apps/mobile/src/app/nummer-aendern.tsx`): reuses `/v1/channels/phone` (SMS only,
  Twilio Verify / own code), now with an explicit consent checkbox (Art. 6(1)(a)) in the app. The code
  is valid 15 min (was 10); the old number stays linked until the code is confirmed, then the row is
  replaced (`address_enc`, new `address_bidx`, `verified_at`/`opted_in_at` = now) and the audit log gets
  `user.phone_changed` (`user.phone_added` for the first number), never the number.
- Tests: `apps/api/src/profile/contact-change.test.ts` (6). API profile/channels/billing/auth/mail/ops/
  worker green, app Jest 166 green. **Not deployed yet; the app needs a new EAS build.** Open: lawyer
  check of the consent wording (`TODO [LEGAL REVIEW]` in `nummer-aendern.tsx`).

## 12. Open code items of 2026-11-24 (owner: „make all of them and test“)

- **Website: change the e-mail address** (`apps/web/components/email-change.tsx` on `/konto/abo`): the
  same API and flow as the app (§11): code to the new address, confirmed on the page, notice to the
  old one. E2E `e2e/tests/account-contact.spec.ts`.
- **Scanner page: 110 and 112 are `tel:` links** in the danger line (`render.ts` `telLinks`,
  `client.ts` `telText` keeps them after the DE/EN switch). E2E in the same file.
- **Trusted contacts, last remains:** migration `20261210000000_drop_trusted_contacts` (table, delivery
  columns, `alerts.escalation_step`, `escalation_enabled` on users and vehicles, `acknowledged_by` =
  `owner` only; metrics views: the last funnel step / a quarter of the protection score is now the
  verified mobile number, column `verified_phone`). Code: break-glass targets, Customer 360, Zammad
  summary, GDPR export, chaos drill; texts on the scanner, reply pages and ops reworded or removed; the
  ops alert-type switch „Eskaliert an Notfallkontakt“ (no effect any more) is gone.
- **Ops: where a subscription was bought:** Customer 360 shows the source (Website/Stripe, App Store,
  Google Play), the unified status, „verlängert sich nicht“ and the store price; the refund link is only
  offered for Stripe, the refund page explains that Apple/Google refund store purchases (the API already
  refused them, now with a German error text). Zammad summary shows the source too.
- **Google Play „Pause“:** migration `20261210000100_store_pause`, see AGENTS.md §7. Website and app
  show „Ihr Abo ist bei Google Play pausiert“ with „In Google Play fortsetzen“ instead of the paywall.
  Tests: `store.test.ts` (pause → 409 → resume, same contract, one confirmation), app
  `portal-screens.test.tsx`.
- Tests (2026-11-24, cloud container): API 656, app Jest 167, i18n/ui/shared, typecheck, lint,
  `db:check` green; E2E 128 tests: all green after fixing `sprint10.spec.ts`, which still expected the
  old per-started-day refund (19,95 €) instead of the whole-day rule of 2026-11-22 (20,00 € same day).
- Not deployed yet; the app part needs a new EAS build.

## 13. `__Host-` cookies and dropping Vercel (2026-11-24)

- **Cookies** (`apps/api/src/auth/cookies.ts`, test `cookies.test.ts`): with `NODE_ENV=production` and an
  `https://` `WEB_BASE_URL` (ops: `OPS_BASE_URL`) the session and CSRF cookies are `__Host-ps_session` /
  `__Host-ps_csrf` (ops `__Host-ps_ops_*`); the guards and the support form read only those, sign-in
  clears an old plain cookie, the web and ops clients prefer the prefixed CSRF cookie. CI and local dev
  (http://localhost) keep the plain names. The test server switches with its next deploy: everyone is
  signed out once (website and ops; the app uses bearer tokens and is not affected).
- **Vercel dropped:** `.vercelignore`, the `VERCEL` build switch and env entry are gone (`next build`
  always makes the standalone output). The Caddyfile has a public block `{$PUBLIC_DOMAIN}` that serves
  only the public pages and the e-mail images on `park-shield.de` until go-live. **Owner steps** (in this
  order, `infra/single/README.md`): `PUBLIC_DOMAIN=park-shield.de` in the server `.env` + deploy +
  recreate caddy → DNS of `park-shield.de` and `www` at Strato to the server IP (MX/SPF/DMARC/Mailjet
  untouched) → check pages, `/email/*` and a test e-mail → delete the Vercel project.
- Not validated with a Caddy binary in the cloud container (download blocked): run
  `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` on the server after the deploy.
- **Switch-over done 2026-11-24:** `PUBLIC_DOMAIN=park-shield.de` in the server `.env` (backup
  `.env.bak-20261124-160200`), `5925c7a` deployed (migrations `20261210000000`, `…0100` applied), `caddy
  validate` → „Valid configuration“. Strato: A `park-shield.de` 216.198.79.1 (Vercel) → the server IP,
  CNAME `www` Vercel → `park-shield.de.` (TTL 150 s; no AAAA; MX, SPF, DMARC, Mailjet untouched and checked).
  Let's Encrypt certificates for both names issued; `/`, `/impressum`, `/datenschutz`, all 24 `/email/*`
  images and `/.well-known/assetlinks.json` answer 200, `www` → 301, `X-Robots-Tag: noindex`.
  `apple-app-site-association` is empty (`APP_IOS_TEAM_ID` / `APP_IOS_BUNDLE_ID` not set on the server;
  Vercel served no file at all). Test e-mail in the real layout (all images from `park-shield.de`)
  sent via Mailjet and checked by the owner: logo shows. Still open: delete the Vercel project (owner
  wants to wait).


## 14. App first, paid new code, 10-day cooldown (2026-11-24)

The owner's task, agreed in chat on 2026-11-24, in four phases; after each phase: tests green, docs,
commit and push, then stop and report to the owner (in Arabic) before the next one.

**Decisions (binding):** app first (sign-up, sign-in, portal, billing in `apps/mobile`); subscription
billing unchanged (do not remove Stripe or unified billing); „Sperren“ always free and immediate, no new
code; **new code free once per subscription year after a „Sperren“** (digital: code + self-print); else
**3 € = new code + printed and shipped sticker, Stripe only** (physical product; never IAP); price =
`prices.print_shipped_cents` unless there is a strong reason for its own setting (ask first); **cooldown
10 days per vehicle** counted from the last issued code (incl. the first), setting
`codes.reissue_cooldown_days`; ops override with its own permission + audit; eligibility checked before
the Stripe page; after payment the code is always issued; `charge.refunded` never revokes the code;
audit `qr_code.replaced`; e-mail stays Mailjet.

### Phase 1 — website (done 2026-11-24)

- `/anmelden`, `/anmelden/link`, `/konto/*` and their components (`konto-shell`, `konto-access`,
  `email-change`, `phone-setup`) deleted; `next.config.ts` redirects them (308) to the new page **`/app`**
  (`apps/web/app/app/page.tsx` + `app-account.tsx`, texts `appPage.*` in `packages/i18n`): what the app
  does, store buttons from `APP_STORE_URL` / `PLAY_STORE_URL` (https on apps.apple.com /
  play.google.com only; empty = „Die App erscheint in Kürze …“), links to `/kuendigen`, `/widerrufen`,
  `/hilfe`. Header button „Zur App“, landing CTAs, help-article actions, contact form, deletion-cancel
  page and the alert deep-link fallback point to `/app` (or the help article).
- `/app/anmelden` no longer offers a browser sign-in. API: every magic link (also ops „Anmeldelink
  senden“) is `/app/anmelden#t=…`; e-mail buttons that pointed to `/konto/*` and the welcome letter's
  portal URL now say `/app`. Website checkout return URLs stay (they redirect to `/app`). No endpoint was
  removed.
- Caddyfile public block: `/app` added. `.env.example`: `APP_STORE_URL`, `PLAY_STORE_URL` (set them in
  `server.env` once the apps are in the stores).
- E2E rewritten on the owner API as the app calls it (`appOwner`, `payPlan`, `addVehicle`,
  `ownerWithActiveDecal` returns `{ url, headers, vehicleId, … }`); new test „app first“ in
  `sprint2.spec.ts`; the a11y sweep checks `/app` instead of the portal pages.
- **Open owner questions:** `/aktivieren` (pre-printed partner decals: the page needs a web sign-in;
  claim works only via `POST /v1/vehicles/:id/claim` until the app has a claim screen — keep, move into
  the app, or delete?), `/antwort` (old e-mail reply page, nothing links to it — delete?), passkeys for
  owners (were added on the website portal — drop?).

### Phase 2 — new-code rules in the API (done 2026-11-24)

- Migration `20261211000000_code_issuances`: enum `code_issue_kind` (`legacy`, `initial`, `free`, `paid`,
  `ops_override`, `ops_reissue`, `resubscribe`, `partner_claim`) and table `code_issuances` (vehicle,
  user, token, kind, subscription, `subscription_year_start`, unique `stripe_ref`, `issued_at`); every
  existing code backfilled as `legacy`. New permission `codes.override_cooldown` (role admin).
- Settings `codes.reissue_cooldown_days` (10) and `codes.free_reissues_per_year` (1), labels in ops.
- `apps/api/src/vehicles/code-rules.ts`: `CodeRulesService.eligibility()` is the one decision (newest
  code of the vehicle from the ledger and `qr_tokens.assigned_at`; free codes counted per subscription
  and subscription year = first purchase + whole years), `recordIssuance()`, `auditCodeReplaced()`
  (`qr_code.replaced`), `lockCodes()` (advisory lock per account). Every issuing path records its row:
  vehicle creation, free new code, ops reissue (abuse centre), re-subscription, partner claim, override.
- Owner API: `GET /v1/vehicles/:id/new-code` → `freeAvailable`, `paidAvailable`, `nextEligibleAt`,
  `lastIssuedAt`, `cooldownDays`, `priceCents` (= `prices.print_shipped_cents`), `freePerYear`,
  `freeUsed`, `hasActiveCode`, `reason` (`subscription_required` | `cooldown` | `code_active` |
  `free_used` | null). `POST /v1/vehicles/:id/tokens` (free code): 409 `code_cooldown`
  (+ `nextEligibleAt`, `cooldownDays`), 409 `code_active`, 402 `payment_required` (+ `priceCents`).
- Ops API: `POST /ops/v1/vehicles/:id/new-code` `{ reason }` (`codes.override_cooldown`): revokes the
  active code, issues a free one with the same design, records `ops_override`, audits with the reason.
  **No button in the ops app yet** (comes with the Customer 360 work of phase 3).
- Tests: `vehicles/code-rules.test.ts` (8: year start, first code starts the cooldown, exact boundary,
  free once per year → 402 → yearly reset, settings, race, no subscription, override + permission);
  `scan.test.ts` and E2E `sprint4.spec.ts` age the first code before the free new code. API 667 green,
  `db:check` green.
- **Note for phase 4:** the current app sends `POST …/tokens` and only knows `code_active`; until the
  new screen exists it shows a generic error for `code_cooldown` / `payment_required`.

### Phase 3 — paid 3 € flow (Stripe) (done 2026-11-24)

- Migration `20261211000100_paid_new_code`: `decal_orders.new_code`, `code_issuances.refunded_at`.
- `POST /v1/vehicles/:id/new-code/order` `{ address, personalizationConfirmed: true, appReturn? }`
  (`OrdersService.orderNewCode`): eligibility checked first (409 `code_cooldown` + `nextEligibleAt`,
  no order, no payment page), label check (422), design + label frozen (`design_snapshot`), order
  `pending_payment` with `paid_print` + `new_code`, Stripe one-time payment (metadata `orderId`,
  `kind: new_code`), returns `{ id, url, priceCents }`. App return as for the 3 € print (`to=order`);
  website fallback `/app?order=paid`.
- Payment (`OrdersService.markPaid`, called for `checkout.session.completed` and
  `payment_intent.succeeded`): in the same transaction as `pending_payment → paid` the active code is
  revoked, a new one with the frozen design is issued and becomes the order's item (the printer prints
  the new code), ledger row `paid` with `stripe_ref = order:<id>` (unique), audit `qr_code.replaced`.
  Always issued once paid; a second event for the same payment changes nothing.
- `charge.refunded` (`BillingService.onChargeRefunded`): the code is **never** revoked; the ledger row
  gets `refunded_at` and the audit entry `qr_code.payment_refunded` (`codeKept: true`), once.
- Ops Customer 360: per vehicle „Ausgestellte Codes“ (kind, date, code hint, „erstattet am …, Code
  bleibt aktiv“), orders marked „Neuer Code“, and for `codes.override_cooldown` the form „Neuen Code
  trotz Wartezeit ausstellen“ with a reason (`override-code.tsx`).
- Tests: API `orders/new-code-order.test.ts` (5: refused in the cooldown before any payment, active code
  replaced with the frozen design and printed, after „Sperren“ with the free code used, one code per
  payment also for repeated events and after an override in between, refund keeps the code); E2E
  `new-code.spec.ts` (fake Stripe page, Customer 360 history, override, support without the button).
- Legal questions: `LEGAL_REVIEW.md` §14 (withdrawal for the bundle, § 356 Abs. 5, AGB text).

### Phase 4 — app UI (done 2026-11-24)

- `src/components/new-code.tsx`: `useNewCodeOptions()` (`GET /v1/vehicles/:id/new-code`, on focus and
  whenever the vehicle's code changes) and `NewCodeActions`: „Neuen Code erstellen (kostenlos)“ when
  `freeAvailable`; „Neuer Code + gedruckter Aufkleber (3 €)“ when `paidAvailable` (opens the paid
  screen); within the cooldown the buttons are off and „Ein neuer Code ist ab dem {date} möglich.“
  (Europe/Berlin, `newCodeDate()` in `lib/portal.ts`); always „Ein neuer Code ist höchstens alle {days}
  Tage möglich.“; texts for `code_active`, `free_used`, `subscription_required`.
- „Kein aktiver Code“ (`no-code.tsx`, on Start, Fahrzeuge, the vehicle and the print screen) uses it;
  the vehicle screen has a card „Neuer Code“ while a code is active; the „Sperren“ dialog says „einmal pro
  Vertragsjahr kostenlos, höchstens alle {days} Tage“.
- New screen `src/app/fahrzeug/neuer-code/[id].tsx`: price chip, what happens, preview, label and
  design („Design ändern“), personalisation notice, address (prefilled from `print-options`), „3 €
  bezahlen und zusenden“ → `POST …/new-code/order` with `appReturn` → Stripe's page in the app
  (`payInApp`) → waits for the webhook (the vehicle's code changes, `waitForNewCode`) → the new QR code
  with „Drucken“ and the PDF; „Zahlung wird noch bestätigt“ if it takes longer; the wait date instead of
  the form inside the cooldown.
- „Tarif und Rechnungen“ (`abo.tsx`): „Einmalige Käufe“ lists the paid 3 € orders („Neuer Code +
  gedruckter Aufkleber“ / „Gedruckter Aufkleber“, date, price, „erstattet“). API: `GET /v1/orders`
  now returns `totalCents`, `paidPrint`, `newCode`.
- `shortEuro()` moved to `lib/portal.ts`. Texts in `src/lib/i18n.ts` (de + en).
- Tests: app Jest 174 (7 new in `portal-screens.test.tsx`: texts, active code, cooldown date in German
  time, free used, paid flow through Stripe to the new code, paid screen inside the cooldown, purchases
  list); typecheck green. Note: `npx expo lint` adds a `lint` script to `package.json` when it runs —
  do not commit that; the pre-existing lint errors (`_layout.tsx` font `require`, test mocks) are
  unchanged.
- **Needed to reach testers:** deploy the API (migrations `20261211000000`, `…0100`) and a new EAS build
  of the app.

**All four phases are done.**

### Owner decisions on the open points (2026-11-24, done the same day)

1. **`/aktivieren`**: no pre-printed decals were handed out (test only). The website page and
   `lib/pending-claim.ts` are deleted; `/aktivieren` → 308 `/app`. The scanner page of an unclaimed
   decal links „Aufkleber einrichten“ to `/app/aktivieren#c=<code>` (Universal Link in the AASA file,
   Android App Link through the `/app` path prefix); without the app that web page offers
   `parkshield://aktivieren#c=…`. The set-up itself is the app screen `src/app/aktivieren.tsx`
   (code check, partner, plan/vehicle first, choose the vehicle, claim); `src/app/app/aktivieren.tsx`
   receives the link. Texts `claim.*` no longer say „Plus“.
2. **`/antwort`**: page deleted, 308 `/app`; `AckService.links()` and `Message.links` removed. The reply
   token and `POST /v1/ack` stay (the view page `/v/<token>` uses them).
3. **Passkeys**: no website UI (gone with the portal; the web `Me` type no longer has `passkeys`); the
   passkey API stays for the app.
4. **First code**: issued at once with the vehicle, never waits; the 10 days for every later new code
   (free or paid) count from it. That is the behaviour since phase 2; a test now states it
   (`code-rules.test.ts`). Note: deleting the vehicle and adding it again gives a new first code at once
   (one vehicle per account) — an owner who wants to close that loophole must decide it.

Tests: API 673, app Jest 177, E2E 118 green (12 skipped as before).

## 15. Full QA run (2026-11-25)

Local stack with fake providers (`.claude/launch.json` config `stack`), app in Expo Go on the iOS
simulator (iPhone 15 Pro) and the Android emulator (Pixel 9). Automated: API 673, E2E 120 (10 desktop-only
skips), app Jest 177, typecheck and lint green. By hand: website (all public pages DE/EN at 1280 and
320 px, axe, redirects), scanner (moderation, alert, live status, locked code), app sign-up end to end on
both platforms (validation, landline rejected, national number normalised, AT address, consent gate,
fake checkout incl. cancel), alert detail and replies, Sperren and cooldown, language switch, plan,
cancellation in the app and on `/kuendigen` (wrong plate → `needs_review`, right plate → `scheduled`),
e-mails light/dark, ops pages for all roles and the audit trail.

Fixed in this commit:
- App alert detail showed the planned reminder/SMS after opening, because the detail loaded in parallel
  with `POST /seen`; it now reloads after `/seen` (`app/alerts/[id].tsx`).
- „Gekauft auf park-shield.de“ / „Website (Stripe)“ for Stripe purchases (they come from the app since
  2026-11-24): now „Direkt bei ParkShield bezahlt (Stripe)“ in the app, e-mail, contract PDF and ops.
- App Plan screen told users to add passkeys on the website (removed 2026-11-24): the card now only
  appears when passkeys exist, to remove them.
- E-mail details table split words on phones (`overflow-wrap:anywhere`, e.g. „personalisierte|r“): words
  now wrap at spaces only; e-mail addresses and links may break after `@ . / _` (`<wbr>`).

Open findings (not changed, need a decision or a dev build):
- Android: after the Stripe page the browser tab does not return to the app by itself (Expo Go,
  `exp://`); verify with a development build (`parkshield://`). Locally the fake checkout also needs
  `adb reverse tcp:3000 tcp:3000` because its URL is `localhost`.
- ~~Lock within 10 days of the first code: the car stays unprotected until the cooldown ends~~ (done
  2026-11-25, §15b: the first lock is an exception).
- ~~Paywall: layout jump when ticking the consent box; box toggles while the checkout loads~~ (done, §15b).
- „Ich komme“ shows the chip „Erledigt“ although „Erledigt“ is also a separate button.
- ~~App cancellation receipt without a print/save button~~ (done, §15b).
- ~~Website `<title>` stays German on EN pages~~ (done, §15b).
- Ops pages without permission still show filters / „Noch keine …“ next to „Dafür fehlt Ihnen die
  Berechtigung“.
- ~~Worker logs `payment.notify_attachment … letter not available yet` as ERROR~~ (done, §15b: `warn`).


### 15a. Price 19,99 € everywhere (owner decision 2026-11-25)

`PLAN_PRICE_CENTS` and the setting `prices.plan_year_cents` are 1999; all texts (landing, help, AGB,
paywall), tests and docs say 19,99 €. New safety check: the Stripe subscription checkout reads the
`STRIPE_PRICE_YEARLY` price once and answers 503 `price_mismatch` (logged as error) when its amount differs
from the displayed price, instead of charging 20,00 € while showing 19,99 €
(`StripePayments.assertPrice`, test `providers/stripe-payments.test.ts`). **Test server done 2026-11-25:** price
`price_1UfUvLFjhnZQE717fgQNDj4f` (EUR 19.99, yearly, inclusive) in `STRIPE_PRICE_YEARLY` (backup
`server.env.bak-20261125-price`), deployed `674c6e9`. **Open:** the same price in live mode before go-live. Existing test subscriptions
keep their 20 € price until they are changed in Stripe.

### 15b. Owner decisions on the QA findings (2026-11-25)

Work on the branch `claude/gifted-heisenberg-pmqvj7` (owner: push only after the E2E tests pass, not
straight to `main`).

- **First lock is an exception to the 10-day wait** (`vehicles/code-rules.ts`): while a vehicle has had
  exactly one code and that code is locked, the cooldown does not apply — the free new code (once per
  subscription year) and the 3 € route are available at once. `GET /v1/vehicles/:id/new-code` also
  returns `firstLock`. Every later new code waits 10 days from the newest code as before. The 3 €
  replacement of an *active* first code still waits. Tests: `code-rules.test.ts`, E2E `sprint4.spec.ts`.
- **Paywall** (`components/subscription.tsx`): the „Bitte bestätigen …“ hint keeps its space once the box
  is ticked (invisible and hidden from screen readers), so the pay button no longer jumps; while the
  checkout runs the consent box, the sticker choice and the promo field are locked (`Check` and `Choice`
  got a `disabled` prop in `components/form.tsx`).
- **Receipt** of a cancellation and a withdrawal in the app: „Seite drucken“ (system print dialog) and
  „Als PDF sichern“ (share sheet), built on the device from the receipt lines (`lib/receipt.ts`,
  `components/receipt.tsx`, `expo-print` + `expo-sharing`, nothing sent to the server).
- **Website `<title>` and description in the visitor's language** (`apps/web/lib/meta.ts`, texts
  `meta.*` in `packages/i18n`): picked language (cookie), else the phone's or browser's language
  (Accept-Language); switching the language on the page calls `router.refresh()` so the title follows.
- **Worker log level**: an outbox handler that waits for something expected throws `RetryLaterError`
  (`core/retry-later.ts`) and is logged as `warn` („outbox handler waiting, will retry“); the last
  attempt is still an `error`. Used for the payment-notification letter attachment.
- Still open from §15: Android return from the Stripe page (needs a development build), the „Erledigt“
  chip after „Ich komme“, ops pages without permission showing filters.
- ✅ API, web and ops deployed to the test server 2026-11-25 (`1a13c01`, no new migration; containers
  healthy, `/v1/ready` ok). Still needed to reach testers: a new EAS build of the app.

## 16. Website: one logo and pages open at the top (2026-11-25)

- **One logo source.** The official mark (blue shield, white QR finder squares, one yellow) is defined
  once in `apps/web/lib/brand-mark.ts`. Built from it: `components/brand/logo.tsx` (`LogoMark`, and
  `Logo` with `variant` `onLight` / `onDark` and `size`), the scanner page (`lib/scanner/render.ts`)
  and, via `npx tsx scripts/email-assets.ts`, the e-mail logo (unchanged, byte-identical) and the
  favicon and app icons in `public/icons` (they showed an old shield with a check mark before). The
  footer's star shield (`StarShield`) is gone; header and footer both use `Logo` (footer: white
  „Park“, blue „Shield“, a faint glow on dark). Logo link name `nav.homeLogo` („ParkShield –
  Startseite“ / „ParkShield – Home“); the unused `nav.home` was removed. The API's PDFs and the decal
  already draw the same mark (own copies in `apps/api`, not touched).
- **Bug: the logo on `/app` opened the home page at the footer.** Cause: `scroll-behavior: smooth` on
  `<html>` (globals.css). Since Next.js 16 the router switches it off during page changes only when
  `<html>` has `data-scroll-behavior="smooth"`; without it the router's jump to the top ran smoothly
  and was overtaken by its `scrollIntoView` on the page's elements (footer first). Fix: the attribute in
  `app/layout.tsx`, plus the safety net `components/scroll-to-top.tsx` (top on every path change, not
  for links with a hash and not for back/forward). The logo on the home page itself scrolls smoothly up.
- Tested locally (DE/EN, 1024 px and 375 px): `/app` → logo at the top; footer „Preise“ jumps to the
  section; footer „Hilfe & Kontakt“, „Verträge hier kündigen“, „Vertrag widerrufen“ and the `/app`
  links open at the top; logo on the scrolled home page → smooth to the top; Back restores the position;
  no console errors.
- ✅ Deployed 2026-11-25 (`162ec31`) and re-tested on https://test.park-shield.de with the same results.
  On `park-shield.de` the footer links „Verträge hier kündigen“ and „Vertrag widerrufen“ lead back to
  the home page: until go-live Caddy serves only the public pages there (`infra/single/Caddyfile`,
  `@website`) and redirects everything else to `/` — on purpose, not a scroll bug.

## 17. Android test: „noch kein Abo“ on another phone and the Google Play purchase error (2026-11-25)

Owner report from a real Android phone: after signing in on another phone the app said „Sie haben noch
kein Abo“ (account with an invoice of 21 Nov and a credit note of 23 Nov), and „Zahlungspflichtig
bestellen“ ended in Google Play's „The item you were attempting to purchase could not be found“ and
„Etwas ist schiefgelaufen“.

- **Server data checked, no lost subscription.** Account A (the owner's test account): Stripe contract
  withdrawn on 2026-11-23 (the credit note of 19,95 €); its later Apple sandbox purchase was moved to
  account B on 2026-11-23 (RevenueCat TRANSFER: the same sandbox Apple ID bought on B). Account B
  (a second owner test account): that Apple **sandbox** subscription renewed hourly (a sandbox „year“ is one hour),
  Apple stopped renewing it and it expired on 2026-11-24 11:32 UTC; RevenueCat shows no entitlement.
  Signing in on another phone changes nothing: the API reads only `subscriptions`.
- **Fix: the app says why there is no plan.** `GET /v1/billing/subscription` has a new field `ended`
  (`BillingService.endedSummary`: the latest ended contract while nothing is live or paused, with
  `reason` `withdrawn` / `refunded` / `moved` / `expired`, `endedAt`, `provider`, `contractNo`).
  „Abo und Rechnungen“ shows „Sie haben Ihren Vertrag am … widerrufen“, „Ihr Abo ist am … abgelaufen“
  or „Ihr Kauf bei Apple gehört seit dem … zu einem anderen ParkShield-Konto …“ instead of „noch kein
  Abo“ (app texts `ended*`). Tests: `billing.test.ts` (withdrawn), `store.test.ts` (moved, expired),
  app `portal-screens.test.tsx`.
- **Fix: store purchase errors have their own text.** `storeErrorKey()` (`apps/mobile/src/lib/billing.ts`)
  maps RevenueCat codes: 5 product not available (Play's „item could not be found“), 6 already bought
  (→ „Käufe wiederherstellen“), 7/13 the purchase belongs to another ParkShield account, 20 payment
  pending, 3 purchases not allowed, 2/10/32/35 store not reachable. Used by the paywall and by „Käufe
  wiederherstellen“; unknown codes keep the generic error.
- **The Play error itself is a Play Console / test set-up issue, not code.** The product loaded (the
  paywall showed Play's „€19.99“), so `parkshield_yearly:yearly` exists; Play refuses the purchase
  (ITEM_UNAVAILABLE) when the app was not installed from Play (for example the EAS `preview` APK) or the
  phone's Google account is not an internal tester who accepted the opt-in link. To check: install from
  the internal-test opt-in link (`play-internal` build, §8 item 10), Google account in the tester list
  „ParkShield intern“ and under Settings → License testing (free test purchases), payments profile
  verified. ✅ 2026-11-25: „ParkShield intern“ (2 owner Google accounts) is the internal-test list
  (track active, release 4) and now also the license-tester list. A phone's Google account outside that
  list must be added to it first.
- ✅ 2026-11-25 **first Google Play purchase works** (Samsung phone). Play first showed „Item not found“
  on „Download test app“: the Play Store app was signed in with another Google account than the tester
  who joined in the browser. After switching the Play Store account to the tester's, the app installed
  from Play, the paywall bought `parkshield_yearly` and the account got an active `play_store`
  subscription. The same wrong Play Store account was most likely behind the earlier purchase error.
  License-test subscriptions renew every 30 minutes (a test „year“) and stop after a few renewals; the
  app then shows „Ihr Abo ist am … abgelaufen“, as expected.
- Not a bug: after the new purchase the account showed a car at once. It is the account's own car,
  added on 2026-11-21 with its first (Stripe) plan; vehicles stay with the account when a plan ends
  (the withdrawal only revoked the old QR code, a later purchase issued a new one).
- ✅ API deployed 2026-11-25 (`7726a04`): `ended` is live (the two test accounts answer `moved` and
  `expired`). The app texts reach testers with the next EAS build (`play-internal` for Play).

## 18. Test cases for an external QA company (2026-11-26)

`docs/qa/ParkShield-Test-Cases.xlsx` (source `docs/qa/cases.mjs`, generator `build.mjs`, how-to in
`docs/qa/README.md`): 213 cases in 23 modules for web, scanner, iOS, Android, e-mails, SMS and ops,
with negative, edge, security, accessibility, performance and compatibility cases, a summary sheet,
device matrix and defect log. No credentials inside; basic auth, TestFlight/APK links and staff
invites go to the company separately. Open: send it to the company, agree the window for load and
intrusive security tests, provide app builds (push and Stripe return need a real build).

## 19. NFC decal spec and the company block in the website footer (2026-11-26)

- **NFC decals:** specification in [`docs/nfc-decals.md`](nfc-decals.md) (draft for the owner's
  decision, nothing built). Stage 1: NTAG213 with the same URL as the QR code, locked after writing; the
  URL goes into the job ticket (`nfc` field of `PrintJob`, product `nfc_vinyl_sticker` already in the DB
  enum) and is written by the print partner's encoder or by staff with a new ops page „NFC schreiben“
  (Web NFC, read-back and QR/NFC comparison, UID stored as a blind index in `nfc_tags`). Stage 2: NTAG
  424 DNA with SUN (signed tap counter, keys derived from `NFC_MASTER_KEY_V<n>`), checked on the scanner
  route. Material and placement (inside the glass, „innenklebend“), tests and open decisions are in the
  spec.
- **Website footer:** a company block above „© ParkShield“ — „ParkShield ist ein Angebot von“, company
  name, owner, address, e-mail (mailto) and USt-IdNr., all from `COMPANY` in
  `packages/shared/src/legal-content.ts` (the Impressum's data), texts `common.siteFooter.operatorIntro`,
  `owner`, `country`, `vatId` (DE/EN). The unused hard-coded `common.footer.operator` text was removed.
  The phone number stays on the Impressum only. Checked at 320 px and 1024 px, DE and EN, no horizontal
  scroll; E2E `sprint2.spec.ts` („site footer“) asserts the block.
- Locally the E2E tests „… is linked in the footer and accessible“ fail now and then in dev mode (the
  click lands before hydration, the page stays on `/`); they fail the same way without this change.
- ✅ Deployed 2026-11-26 (`f743aae`): the company block is live on https://park-shield.de and the test site.

## 20. Full run of the 213 QA cases (2026-11-26)

All 213 cases of `docs/qa/ParkShield-Test-Cases.xlsx` were run on the local stack (fake providers);
results per case in `docs/qa/ParkShield-QA-Results-2026-11-26.xlsx` (status, actual result, evidence,
defect log; rebuilt from `results-2026-11-26.mjs` with `fill.mjs`). **189 Pass, 24 Blocked, 0 Fail.**
Automated: API 677, app Jest 182, UI/i18n/shared 58, typecheck and lint green, E2E 134 (120 existing +
14 new in `e2e/tests/qa-blackbox.spec.ts`: old URLs, 404, app link files, security.txt, contact form
validation, unknown/injected codes, message limits, captcha, double tap, tampered status/view tokens,
IDOR on 15 owner routes, ops routes on the public API, security headers, forged Stripe/RevenueCat/
Twilio webhooks, e-mail enumeration, e-mail/phone/address validation and number normalisation, vehicle,
header and new-code rules, cancellation without login). Live check of park-shield.de: noindex header,
HSTS, valid TLS, security.txt until 2027-11-10.

Fixed:
- D-01 ops `/mitarbeitende` and `/mitarbeitende/pruefung` were 355/342 px wide at 320 px (staff shown
  by their e-mail address): names and addresses now wrap (`min-w-0 wrap-anywhere`).
- D-02 ops pages without the permission showed filters, forms and „Noch keine …“ next to the notice
  (open since §15): `/bestellungen`, `/gutscheine`, `/partner`, `/datenschutz`, `/missbrauch/woerter`,
  `/willkommensbriefe` now show only the notice.
- D-03 app: after „Ich komme“ the chip said „Erledigt“ (open since §15): now „Beantwortet“ / „Answered“;
  „Erledigt“ only after the „Erledigt“ action (`alerts/[id].tsx`, `alert-card.tsx`). Needs a new EAS build.
- D-04 `/app/zurueck` without a valid app target answered a bare „Not found“: now 303 to `/app`.
- D-05 case ONB-10 used „0151 2345678“, which is too short for a 0151 number (rightly refused); the
  case now uses 0151 23456789. WEB-07 no longer says „known finding“.
- Tooling: `apps/api/.vitest` (local Vitest cache) is git- and Prettier-ignored (it broke `format:check`).

Blocked (need what a local run cannot give): Face ID / lock (ONB-14, AUTH-06/07/08), sign-in link into
the app (AUTH-02), Stripe declined/3DS cards and customer portal on the test server (PAY-02/03/15),
Android return from Stripe in a dev build (PAY-05, open since §15), network loss while paying (PAY-06),
store purchases, errors and Play pause (PAY-08/09/10/12), push on devices (ALERT-02/06), real inboxes and
spam (MAIL-04), screen readers (A11Y-01/02), device timings and matrix (PERF-02, COMPAT-02/04/06), load
test only with written approval (PERF-03).
- ✅ Deployed 2026-11-26 (`7c15291`): all containers healthy, `/v1/ready` 200, `/app/zurueck` answers 303
  to `/app` on the test site. Still needed: a new EAS build for the app chip fix (D-03).

## 21. Scan page asked for basic auth after „Senden“ (2026-11-26)

- Found by the owner on an iPhone: scanning a test-server QR code opens without a password, but after
  „Senden“ Safari asked „Sign in to test.park-shield.de“. Cancel let the page continue.
- Cause: after sending, the page loads the live chat client `/scanner-assets/socket.io.min.js` (and, with a
  real captcha, `/scanner-assets/frc-sdk.js`). `/scanner-assets/*` was missing from the Caddyfile's
  `@scanner_web` list, so it answered 401 behind basic auth. After „Cancel“ the chat library is missing, so
  the scanner's live chat cannot work; status updates (plain `fetch` to `/v1/alerts/*`) were not affected.
- Fix: `/scanner-assets/*` added to `@scanner_web` in `infra/single/Caddyfile` (public static files, no
  data). Production has no basic auth, so only the test stack was affected.
- ✅ Deployed 2026-11-26 (`cf1a6ca`): `/scanner-assets/socket.io.min.js` and `frc-sdk.js` answer 200,
  the rest of the test site (`/hilfe`, `/v1/ready`) still 401 behind basic auth.

## 22. QA case file 1.1: expected results checked (2026-11-26)

- Owner request: the file for the external testers must say exactly what is correct; anything else is a
  defect. Every „Expected result“ in `docs/qa/cases.mjs` was checked against the code and the test server;
  70 cases rewritten, `docs/qa/ParkShield-Test-Cases.xlsx` rebuilt (same 213 IDs, all „Not run“).
- Corrected facts, among others: `/kuendigen` identifies by name + e-mail + contract number or plate
  (wrong data → same receipt, checked by hand, no end date); `/widerrufen` always gives a receipt, the
  worker refunds or (out of period / store) leaves it to staff; the plan screen is „Abo und Rechnungen“;
  the first lock of a vehicle's first code has no 10-day wait; the app push texts; moderation refuses at
  once; chat input stops at 500, scanner 20 messages; ops session 30 min idle / 12 h; break-glass e-mail
  only when chosen; fixed findings (paywall jump, chip „Erledigt“, ops filters, cancel receipt) are no
  longer listed as known.
- Read me: the alert limits per scanner (one browser on one network). On the test server only
  `ratelimit.alert.scanner_vehicle` is relaxed (1 per minute); 3 per day per scanner and vehicle, 6 per
  hour per scanner and 20 per day per vehicle still applied. ✅ Owner decision the same day: raised on the
  test server (SQL into `app_settings`): `ratelimit.alert.scanner_vehicle_day` 50/day,
  `ratelimit.alert.scanner_global` 60/h, `ratelimit.alert.vehicle` 100/day, `ratelimit.alert.phone_vehicle`
  1/min, `ratelimit.alert.phone_vehicle_day` 50/day; the Read me and the SCAN cases say so. Undo before
  go-live: `docs/status.md` §4 item 1.
- Note: the code default of `ratelimit.alert.scanner_vehicle` is 2 per hour, not „15 minutes“ as
  `docs/status.md` §4 item 1 says; restoring means deleting the override either way.

## 23. „Bin gleich zurück“ / "Be right back" (2026-11-26)

Owner spec (temporary status message per vehicle, scanner „Ich warte“), behind `VEHICLE_STATUS_ENABLED`
(API env, default off). Design and rules: [`vehicle-status.md`](vehicle-status.md).

| Part | State |
| --- | --- |
| Shared rules (presets, durations, text check), migration `20261212000000_vehicle_status`, API (`vehicle-status/`, `/v1/vehicles/:id/status`, `POST /v1/scan/:code/waiting`), outbox jobs + sweep, pushes | ✅ API tests `src/vehicle-status` (12), routes/hardening/seed tests green |
| Scan page card (message, countdown in memory, „Ich warte“, live „Ich komme“), DE + EN | ✅ E2E `e2e/tests/vehicle-status.spec.ts` |
| App: button + bottom sheet on Home and the vehicle screen (`components/be-right-back.tsx`), active banner with mm:ss, „+5 Min“ (off at the cap), „Beenden“, „Aktiv“ chip, „1 Person wartet“, `PS_BRB` notification actions, refetch on focus / foreground / push / silent data message, alert icon for `waiting` | ✅ Jest `be-right-back.test.tsx` (7), whole app suite 188 green; needs a new EAS build |

Owner decisions (2026-11-26): the „Ich warte“ push stays **without the vehicle label** (FCM rule: no
label, plate or name in a push), and the texts stay with **„Sie“** (not the spec's „du“). Deploy to the
test server done 2026-11-26: `VEHICLE_STATUS_ENABLED=true` added to `server.env`, deployed `9618790`
(migration applied, triggers and alert type `waiting` present, flag on in api and worker, new routes
answer, worker started without errors). The app part reaches testers only with a new EAS build.

Device test 2026-11-26 (Samsung SM-S931B, Expo Go over USB against the local stack with fake providers):
two taps activate (first preset, 10 min), the banner counts down, „1 Person wartet“ after „Ich warte“
on the phone's browser (a second tap sent nothing), the WAITING alert with the clock icon and the badge,
„Ich komme“ shows live on the scan page („The vehicle owner is on the way.“), „+5 Min“ and „Beenden“
work and the scan page is the normal one again. Two bugs that only the device showed were fixed: the
bare import `@parkshield/shared` (Metro resolves subpaths only; it would have broken the EAS bundle, a
Jest test now guards it) and `HAS_FIREBASE` in Expo Go (no native Firebase module there). Not testable in
Expo Go: pushes (pre-expiry with „+5 Min“ / „Beenden“, silent „ended“) — needs the EAS build.

## 24. Home page: four new parts (2026-11-26)

The owner had a competitor site (laqeeni.me, Egypt, same idea: QR + NFC sticker, alerts by WhatsApp/SMS,
one-time price) compared with ours. Our home page already covered almost everything; the owner chose to
build the four gaps (`apps/web/components/landing.tsx`, texts in `packages/i18n` `landing.*`, DE + EN):

1. **Situations:** below the four photo cards, the rest of the problem list as chips (Schaden,
   Alarmanlage, eigene Nachricht) and „Dringende Warnungen erreichen Sie auch in Ihrer Ruhezeit.“
2. **„Alles in Ihrer App“** (replaces the old Channels section, which is now its second row „Wenn Sie
   nicht reagieren“): a drawn phone with the alert, the three replies and a chat line, and the owner's
   controls — one-tap replies, anonymous chat, quiet hours (urgent alerts still arrive in the app), block
   sender / lock code, and **„Bin gleich zurück“ only while `VEHICLE_STATUS_ENABLED=true`** (the home page
   reads the same server variable at runtime, `app/page.tsx` is `force-dynamic`; on the test server it is
   on, so `park-shield.de` shows it too).
3. **„Der Aufkleber“** card next to the price: 8 × 8 cm UV-resistant film, inside of the windscreen, six
   designs with the vehicle's name, free PDF to print yourself, one printed decal incl. shipping, every
   further one 3 €.
4. **„Datenschutz in Zahlen“** below the privacy cards, each fact checked in the code: no cookies or
   storage on the scan page; no ads, analytics or tracking (no analytics script in `apps/web`); the push
   carries no content (FCM rule); free text after 7 days, photos after 30 days, alerts after 90 days
   (`run_retention()`, `alert_media`); encrypted data, servers in Germany.

Not copied on purpose: the scanner's location, a one-time price, WhatsApp/Meta, a cookie on the scan
page, invented testimonials or customer numbers (we have no customers yet).

Tests: E2E `a11y.spec.ts` (axe at 320 and 1280 px, WCAG text spacing at 320 px), `sprint2.spec.ts` and
`foundation.spec.ts` green on desktop and mobile. `sprint2.spec.ts` now expects two headings in the
pricing section (the plan and the decal card) and waits for `networkidle` before clicking footer links
(a click during hydration was lost now and then). Screenshots (DE/EN, desktop/mobile) are in the session
notes, not in the repo. **Deployed to the test server on 2026-11-26 (`288e6db`)**: all four parts are live on
`park-shield.de` (with „Bin gleich zurück“, the flag is on there), web and API logs clean.

## 25. Lifetime plan: 29,99 € once, one button under the yearly one (2026-11-26)

Owner decision: next to the yearly plan (19,99 € / year, unchanged) the same plan can be paid **once
for 29,99 €** (one vehicle, everything included, no renewal, nothing to cancel). The owner kept 29,99 €
after being told that only 10 € more than one year will move most buyers to lifetime and end most
recurring revenue from the 2nd year (SMS, server and support costs keep running).

Design (owner: „no new card, one button under the yearly button, persuasive texts and motion“):
- **App paywall** (`components/lifetime-offer.tsx`, used by `CheckoutForm`): under „Zahlungspflichtig
  bestellen – 19,99 € / Jahr“ an „oder“ divider and a yellow box (accent tokens) with the badge „Nur
  10 € mehr – dafür für immer“, „Einmal zahlen. Für immer geschützt.“, „Ab dem 2. Jahr günstiger · in
  5 Jahren 69,96 € gespart“ and the button „Zahlungspflichtig bestellen – 29,99 € einmalig“ (§ 312j).
  A light band sweeps over it three times, then stops (none with reduced motion). The same
  immediate-start checkbox unlocks both buttons. Every number is computed from the real prices
  (`lifetimeCheaperFromYear`, `yearlyTotalCents` in `packages/shared`; the store's prices in store
  builds). Deliberately not used: timers, „only 3 left“, „most popular“, shaming „no“ texts (UWG).
- **Website** (`landing.tsx` `LifetimeButton`, CSS `.lifetime-shine`): the same under „Jetzt bestellen“
  on the pricing card; it links to `/app` like the yearly button (purchases are in the app).
- **Contract**: lifetime = a `subscriptions` row with `interval = 'lifetime'`, `current_period_end`
  NULL, `will_renew` false (migration `20261213000000_lifetime_plan`). Summary/API: `lifetime: true`,
  unified status ACTIVE. Cancellation finds nothing to cancel (request kept for review);
  withdrawal works (refund of the one-time charge, Wertersatz per used day against one contract year,
  TODO legal). Contract confirmation e-mail and PDF say „29,99 € einmalig“, „Laufzeit: dauerhaft, ohne
  Verlängerung“. Renewal reminders and the expiry sweep never touch it.
- **Stripe**: one-time Checkout with `price_data` (no price ID to create), metadata `term=lifetime`;
  `stripe_payment_intent` identifies the contract (webhook + return confirmation idempotent). Settings
  `prices.lifetime_cents` / `prices.store_lifetime_cents` (2999). No promo codes on lifetime.
- **Stores**: a non-consumable read from RevenueCat `non_subscriptions`, same entitlement
  `parkshield_pro`. The app shows the lifetime button in store builds only when the current offering
  has a lifetime package.

**Store set-up (done 2026-11-27):**
1. App Store Connect: in-app purchase **Non-Consumable** `parkshield_lifetime` (Apple ID 6839814481),
   „ParkShield Lifetime“, base country Germany 29,99 €, all countries, German name and description.
   Status „Prepare for Submission“: it goes to review with the next app version, and Apple still needs
   a **review screenshot** of the paywall (upload it on the product page before submitting).
2. Google Play Console (account Dodobasha): one-time product `parkshield_lifetime`, purchase option
   `lifetime` (Buy, backwards compatible), **active**, 174 countries; set as 25,20 € net so Germany is
   29,99 € incl. 19 % VAT.
3. RevenueCat: products `parkshield_lifetime` (iOS and Android, non-consumable) and Test Store
   `lifetime` (29,99 USD, test only), all attached to `parkshield_pro`; package **Lifetime**
   (`$rc_lifetime`) in the `default` offering, above Yearly.

**EAS builds (2026-11-27, from `main`):** iOS `preview` (internal, build `e6527b74`) and Android
`play-internal` (app bundle, versionCode 5, build `002a40e8`) both finished. The Android bundle still
has to be uploaded to the Play internal test track.

**Still to do:** upload the Android bundle to internal testing, App Store review screenshot, a sandbox
purchase on iOS and Android; lawyer (`LEGAL_REVIEW.md` §15).

Not done: upgrading a running yearly plan to lifetime (the paywall stays hidden while a contract is
live); possible follow-up.

## 26. `/favicon.ico` (2026-11-27)

The owner saw the old shield with a check mark next to `test.park-shield.de` in Chrome's address-bar
suggestions. Our icons were already the current mark (`162ec31`), but `/favicon.ico` was a 404, and
browsers ask for that file on their own (history, bookmarks, suggestions) and keep their cached copy
while it fails. `scripts/email-assets.ts` now also writes `apps/web/public/favicon.ico` (16, 32 and 48 px
PNG entries of the same mark); Caddy's public block and `proxy.ts` already let `/favicon.ico` through.
Chrome may still show the cached old icon until it reloads the page's icon (visit the site once, or
clear the browsing data for the site). **Deployed to the test server on 2026-11-27 (`8890db7`)**:
`https://park-shield.de/favicon.ico` answers 200 `image/x-icon`, byte-identical to the repo file.

## 27. NFC stickers: owner decisions and the task prompt (2026-11-27)

The owner reviewed an NFC/inventory prompt of their own; most of it already existed (`qr_tokens` with
`in_stock`/`assigned`/`revoked` and `tag_events`, `token_batches`, `fulfillment.mode = from_stock` with
`FulfilmentService.scanStockSticker`, `docs/nfc-decals.md`). Decisions: the generic NFC sticker replaces
the printed decal (no vehicle name or chosen design; the free PDF keeps both; lawyer accepted), one code
per vehicle, stock produced by us, active at once, old code valid until the new sticker is tested in the
app or 14 days after shipping, inside the glass only, NTAG215, permanent lock after the check. The task is
[`docs/nfc-sticker-prompt.md`](nfc-sticker-prompt.md) (five phases, plan first). Found on the way:
`VehiclesService.claimable/claim` accepts any `in_stock` code of any batch, so in-house stock would be
claimable by customers; the prompt restricts it to partner batches. **Nothing is built yet.**

Phase 0 (same day): the owner answered the five open questions (serial printed, own 80 × 80 mm design,
14 days change-over, delete all test customers on the test server at the deploy, 3 € withdrawal rule
unchanged). Review and plan in [`docs/nfc-sticker-plan.md`](nfc-sticker-plan.md); besides the claim
issue it found that the app's „current code“ is chosen by `created_at` (wrong for stock codes) and that
„Sperren“ stops only one code. **Waiting for the owner's approval before Phase 1.**

**Phase 1 done (2026-11-27, not deployed).** Migration `20261214000000_nfc_stock`: `token_batches.kind`
(`partner` | `inhouse_nfc`) and `chip` (`NTAG215`), `qr_tokens.serial_no` from `qr_tokens_serial_seq`
(shown as `PS-000001`), permission `tokens.export` (admin). API (`FulfilmentService`):
`POST /ops/v1/batches/inhouse` (1–5,000, `tokens.manage`, codes inserted in chunks of 500 by
`TokensService.issueStock`), the print PDF uses the generic design with the serial under the QR code and
the line „Scannen oder Handy anhalten – ohne App“ (`layoutDecal` `serial` / `nfc`; a placeholder until
the owner's own design), `GET /ops/v1/batches/:id/export.csv` (semicolons, UTF-8 BOM; serial, URL, QR
content, NDEF URI, prefix byte, payload hex, batch) and `GET …/qr.zip` (SVG + 1000 px PNG per sticker,
named by serial, at most 2,000 stickers), both `tokens.export` and audited reads. Fixes: in-house stock
can no longer be claimed (`claimable`) and an unpacked in-house sticker shows no set-up offer on the
scanner (`isUnclaimed`): both only for partner batches. Ops: new page **`/lager` „Aufkleber-Lager“**
(batches with serial range, print file, CSV, ZIP, „Als gedruckt markieren“, new batch); `/partner` lists
partner batches only. Tests: API `back-office.test.ts` („in-house NFC stock“), `decal.test.ts`; E2E
`nfc-stock.spec.ts`, `/lager` in the a11y sweep. Next: Phase 2 (programming and checking the chip,
`nfc_tags`, the packing gate) — the Android phone is needed there for Web NFC.

**Phase 2 done (2026-11-27, not deployed).** Migration `20261214000100_nfc_tags`: one row per written
chip (`method` web_nfc | nfc_tools, `uid_bidx` blind index only, `written_at/_by`, `verified_at/_by`,
`locked_at/_by`; a check constraint keeps the order write → check → lock). `StickersService` +
`/ops/v1/stickers` (`tokens.manage`): search by serial (`PS-000123`, `ps123`, `123`) or scanned QR
content, detail, `GET :id/nfc` (URL, NDEF payload, QR SVG — an audited read), `POST :id/nfc/written`,
`:id/nfc/verify` (`nfc_mismatch` is audited; `nfc_other_chip`, `nfc_uid_in_use`), `:id/nfc/locked`
(`confirmIrreversible: true` required, only after a check), `:id/damaged` (revoked, reason `damaged`).
**Packing gate:** `scanStockSticker` takes only in-house stock whose chip is locked (`nfc_not_ready`);
partner decals never go into a customer's order. Batches show `ready`. Ops: `/lager` has „Aufkleber
finden“; `/lager/aufkleber/[id]` writes, checks and locks with Web NFC (Chrome on Android) or guides
through NFC Tools (paste the URL it read). Tests: API „NFC chip of an in-house sticker“, FROM_STOCK
test now packs a locked in-house sticker; E2E with a stand-in `NDEFReader`. Open: the real test with an
NTAG215 on the Android phone (`adb reverse tcp:3001 tcp:3001`, ops at `http://localhost:3001`).

**Phase 3 done (2026-11-27, not deployed).** Migration `20261214000200_change_over`: `qr_tokens.retire_after`
and the ledger kind `stock_sticker`; setting `fulfillment.old_code_grace_days` (14). `ChangeOverService`
(`apps/api/src/vehicles/change-over.service.ts`): packing (`scanStockSticker`) assigns the stock code at
once, copies the vehicle's own design onto it (app and free PDF keep it) and records `stock_sticker`, but
no longer revokes the old code; shipping (`OrdersService.markShipped`) gives the vehicle's other live codes
`retire_after` = now + 14 days; a returned parcel clears it; the owner's test of the new sticker
(„Aufkleber testen“, `ScanService`) revokes older live codes in the same transaction; the worker job
`stickers.change_over` (every 10 min) revokes codes past their deadline (reason `retired_change_over`).
Everything that assumed one live code per vehicle now handles two: the current code is the newest by
`assigned_at` (vehicle list, paid new code design, QR export), „Sperren“ and the ops re-issue stop every
live code, a new subscription issues one fresh code per vehicle, Customer 360 counts vehicles. Stock
stickers never start the 10-day new-code wait and do not count against the „first Sperren“ rule
(`code-rules.ts` ignores `serial_no` codes and `stock_sticker` rows). Tests: API change-over (test ends
it, deadline sweep, returned parcel, „Sperren“ stops both, free new code without the wait). Next: Phase 4
(app card, notices and texts).

**Phase 4 done (2026-11-27, not deployed).** API: `GET /v1/vehicles/:id` → `decal.serial` (`PS-000001` for a
stock sticker) and `decal.changeOver` (`{ oldCodeUntil }` while an older code still works; `null` date until
the sticker ships); `GET /v1/vehicles/:id/print-options` → `shipped.stock` (true with
`fulfillment.mode = from_stock`), and from stock the vehicle name is never checked (`label_invalid` only on
demand). The `decal_shipped` mail says to stick it inside the window, test it with „Aufkleber testen“, and how
long the old code keeps working (`{days}` from the setting). App (`apps/mobile`, needs a new EAS build): the
vehicle screen shows „Ihr Aufkleber“ with the serial and the change-over notice; the print confirmation
shows the generic sticker and the new-code note instead of name, design and preview when `stock` is true.
Texts: home page „Der Aufkleber“ (QR + NFC, neutral, PDF with own design and name), vehicle name hints,
print and welcome texts. **Legal wording** (owner's choice): the „personalised, no withdrawal right
(§ 312g)“ lines in the app paywall, print screen and portal were replaced by „Bei einem Widerruf des Abos
behalten wir den Wert des (bereits) versandten Aufklebers ein.“ — the 3 € rule itself is unchanged; the
AGB/Widerrufsbelehrung (`packages/shared/src/legal-content.ts`) and the contract PDF are **not** changed:
questions in `LEGAL_REVIEW.md` §16. Tests: API (vehicle fields, stock flag, mail), app Jest (sticker card,
change-over notice, stock confirmation; a crash from text outside `<Text>` caught there), web E2E sprint2,
a11y, nfc-stock. Next: Phase 5 (stock overview and low-stock warning).

**Phase 5 done (2026-11-27, not deployed). All five phases are built.** `GET /ops/v1/stickers/stats`
(`tokens.manage`, counts only): ready to pack, chip not written, written but not locked, linked to a
vehicle, of these in change-over, damaged, revoked with a lost batch; `low` below the setting
`stock.low_threshold` (default 50). The ops dashboard shows „Aufkleber bereit zum Verpacken“ and a to-do
when the stock is low (`Overview.stock`, only with `tokens.manage`). `POST /ops/v1/batches/:id/revoke-stock`
(`tokens.export`, admin; `confirm: true` and a note): every sticker of a lost or stolen batch still in stock
is revoked (reason `batch_lost`, audit `batch.revoke_stock`); packed stickers stay active. `/lager` shows the
„Bestand“ card, the warning and „Charge verloren?“ with the confirmation. Note for tests: the ops process
has its own settings cache (`ops.get(SettingsService).invalidate()` after `setSetting`).

**Deploying the NFC stickers (when the owner says so):** migrations `20261214000000`, `…0100`, `…0200`;
then on the test server: delete the test customers and their orders (owner decision, confirm first; staff
stay), create and program a first batch, and only then `fulfillment.mode = from_stock` (until then orders
print on demand). The app part needs a new EAS build. Still open: the real NTAG215 test on phones
(`docs/nfc-decals.md` §10), the lawyer's answers (`LEGAL_REVIEW.md` §16). The owner's sticker design is
in the print file since 2026-11-27 (below).

**Deployed to the test server on 2026-11-27 (`662a338`).** Migrations `20261214000000_nfc_stock`,
`…0100_nfc_tags` and `…0200_change_over` applied; `/v1/ready` 200, `/ops/v1/stickers/stats` answers 401
without a session, logs clean; `park-shield.de` shows the new „Der Aufkleber“ texts. `fulfillment.mode` is
still the default `on_demand` and there is no in-house batch yet, so orders print as before. Not done yet
(each needs the owner): delete the test customers and their orders, create and program the first batch,
then switch to `from_stock`; the EAS build for the app part.

**Test customers deleted (2026-11-27, owner's request and confirmation).** On the test server all 8 customer
accounts were deleted with everything attached (5 vehicles, 7 codes, 13 alerts, 10 subscriptions, 2 orders in
production with their print files, 5 welcome letters, consent records and one Stripe test-mode credit note);
the 3 active Stripe test-mode subscriptions were cancelled first. Kept: the 2 staff accounts, settings and the
audit log. One transaction, in this order (FK traps): `consent_records` (append-only against UPDATE, its
`user_id` would be set to NULL), `decal_order_items` + `decal_orders` (orders only lose their user),
`refunds` (must keep a subscription or an order), then `users`. App Store / Google Play sandbox subscriptions
cannot be cancelled from here; RevenueCat events for the deleted users find no account. The two older print
files of orders deleted on 2026-11-21 (`PRINT-2G7BYV`, `PRINT-QNTMK0`) were deleted too (owner, same day);
`/data/print-outbox` is empty.

**Owner sticker design in the print file (2026-11-27, deployed `7ab12cd` the same day).** The owner's design (picture sent in
chat) is built in code as `apps/api/src/decal/stock-sticker.ts` (`layoutStockSticker`) and used by
`batchPrintFile` for every in-house sticker (`serial_no` set); partner batches keep `layoutDecal`. 80 × 80 mm,
blue frame into the 3 mm bleed, white panel (radius 5.5 mm), the mark + „ParkShield“, „FAHRER
KONTAKTIEREN“, the real per-sticker QR code on the left (black, ECL H, no logo over it, ≥ 4 modules white to
the frame and the divider), the serial `PS-000001` under it, the NFC column on the right (waves, „NFC“,
pill „Handy anhalten“, phone, „Ohne App · anonym“), dark footer with globe + domain and the fixed sentence
(SC-15). Changes against the picture, as advised to the owner: German „Handy anhalten“ instead of „Scan or
Tap“, the serial added, no logo in the QR code, black finder patterns, „Ohne App · anonym“. The removed
`layoutDecal` options `serial` / `nfc` were only used by the old placeholder. For the print shop: reverse
print on clear face-adhesive film (inside the glass), white layer behind, rounded die-cut corners, the
NTAG215 antenna behind the NFC column. Every new batch gets this design; nothing is stored per batch, so
re-downloading the print file of an older batch renders it in this design too.

**Website: QR code and NFC (2026-11-27, deployed `9e984ff` the same day, live on `park-shield.de`).** The home page shows the real printed sticker
(`apps/web/public/images/sticker-nfc.svg`, rendered by `npx tsx scripts/landing-decals.ts` from
`layoutStockSticker`, QR to `/s/BEISPIEL`) in the hero, the demo's scan step and the „Der Aufkleber“ card, and
has a new section `#nfc` after „So funktioniert's“ (`landing.nfc*`: scan the QR code, hold the phone to the NFC
area — iPhone XS and newer, Android with NFC on —, the chip holds only the address and is sealed; heat-reflective
glass may block NFC; the free self-print has the QR code only). Also: eyebrow „Der QR- und NFC-Aufkleber“, steps
1 and 2, demo step 1, FAQ 6 („Wie funktioniert das Handy-Anhalten (NFC)?“). Help centre: new article
`/hilfe/nfc-handy-anhalten` (in the a11y sweep) and NFC lines in „So funktioniert ParkShield“, „Aufkleber
testen“ (old code until the new sticker is tested, at most 14 days after shipping), „Wo klebe ich den Aufkleber
hin?“, „Aufkleber drucken oder zusenden lassen“, „Code sperren und neuen Code erstellen“ (no longer „kostenlos“,
the new-code rules of 2026-11-24 apply) and „Abo und Preis“. Left alone on purpose: „Widerruf und Erstattung“
still says „individuell gestalteter … Aufkleber“ — that wording waits for the lawyer (`LEGAL_REVIEW.md` §16).

## 28. Dark navy website design (owner mockups 2026-11-27)

The owner sent four phone mockups (dark navy, yellow buttons, the real sticker everywhere) and decided:
pricing stays **one card with the Lifetime button** (2026-11-26 decision kept, no second card); the other
pages get a **dark header band with the text on a light background** (legal texts stay easy to read and
print); the home page takes the best of all four mockups; the animations stay; company data stays in the
footer.

**Step 1 done (2026-11-28, deployed `51f1fc2`, live on `park-shield.de`): the home page.** Tokens: class `ps-dark` in
`apps/web/app/globals.css` overrides the `--ps-*` tokens with dark navy values (`@theme inline` makes every
utility follow), so the animated demo and shared parts turn dark without their own code. `PageShell dark`
puts the footer flush under the page. `components/landing.tsx`: hero „Erreichbar bleiben. Privat bleiben.“
(badge „QR + NFC“, price „19,99 € / Jahr“, yellow „Jetzt ParkShield sichern“, „Live-Demo ansehen“ to `#demo`,
the sticker on the windscreen photo with the notification and live status, blue wave), situations as photo
cards, three numbered steps (new icons `sticker`, `nfc`), the live demo with a „Live-Demo“ badge, „Ihr Kontakt –
einfach & sicher“ (QR, NFC, reply, chip safety), privacy and features, owner app and follow-ups, pricing (one
card, yellow border, Lifetime button), FAQ with the first answer open, closing call to action with the price,
the button and the sticker. Corrected against the mockups: the owner does need the app and an account (only
the scanner does not), no vehicle label or serial in the notification, no logo in the QR code, „jederzeit zum
Ende des bezahlten Jahres kündbar“. Tests: E2E heading and button text updated (`sprint2.spec.ts`); a11y sweep
(axe incl. contrast, 320 px, text spacing, keyboard) green.

**Hero on phones (2026-11-28, owner screenshot):** badge, heading and the short line „Kontakt zum Fahrer – ohne
Handynummer.“, then the windscreen photo with the sticker full width (notification inside the photo), then
price, full-width yellow button and the checks. From 1024 px: text and button left, photo right; the longer
`landing.heroDetail` shows there only.

**Step 2 done (2026-11-28, deployed `8527c19`, live on `park-shield.de`): every other page.** `PageShell title={…} intro={…}` renders
`PageTitle` (`components/site-chrome.tsx`): a dark navy band (`ps-dark`, gradient, blue glow, the shared
`Wave`) with the page's only `h1` and an optional intro; the content stays on the light background below. Moved
into it: the legal pages (`LegalPage`), help index (with its intro), help articles (summary as intro), contact
form, `/app`, `/app/anmelden`, `/app/aktivieren`, `/auth/open`, `/kuendigen` (+ received), `/kuendigen/zuruecknehmen`,
`/widerrufen` (+ received), `/v/<token>`, `/datenschutz-anfrage`, `/konto-loeschen-abbrechen`, 404. New pages:
pass `title` to `PageShell` instead of an own `Heading level={1}`.

CI fixes found on the way (red since `9e984ff`): the CSP test searched the help for „iPhone“, which the NFC
article now also mentions (search term now „Fokus-Modus“); the app's icon copy lacked the new `nfc` and
`sticker` icons (`apps/mobile/src/components/icons.tsx`, the app test compares them with the website).

## 29. App paywall: both buttons in the plan card (2026-11-28)

Owner request (screenshots): on the iPhone the yearly „Zahlungspflichtig bestellen – 19,99 € / Jahr“ and the
yellow Lifetime box sat three screens down, after the contract summary, the consent and the sticker note. Now
`/tarif` is **one plan card like the website's pricing card** (`CheckoutForm` in
`apps/mobile/src/components/subscription.tsx`, the screen `src/app/tarif.tsx` only adds title and intro):
„ParkShield“, „Alles inklusive, für ein Fahrzeug“ (`landing.planFor`), the price large with „/ Jahr inkl.
19 % MwSt.“ (`landing.priceInclVat`, the store's price string when the store sells it), the feature list,
then — still directly above the buttons, as `LEGAL_REVIEW.md` §8 requires — term and renewal rule, the
sticker value line (small type), the immediate-start declaration (§ 356 Abs. 4 BGB, never pre-ticked) and the
sticker notice (§ 312g), then the **yellow** „Zahlungspflichtig bestellen – 19,99 € / Jahr“ (new `Button`
variant `accent`), „oder“ and the **outlined** Lifetime button (`components/lifetime-offer.tsx`: small yellow
„NUR 10 € MEHR – DAFÜR FÜR IMMER“ over „Zahlungspflichtig bestellen – 29,99 € einmalig“ with the short shine,
under it „Ab dem 2. Jahr günstiger · kein Abo, nichts zu kündigen“, new key `lifetimeLine`; the old
`lifetimeTitle` / `lifetimeSave` with „in 5 Jahren … gespart“ are gone, which also drops that UWG question in
`LEGAL_REVIEW.md` §15 item 3 for the app). Under the card: the Apple/Google account line, AGB · Datenschutz,
„Käufe wiederherstellen“ and the folded „Vertrag, Verlängerung und Widerruf“ (withdrawal notice, voucher).
Tests: `portal-screens.test.tsx` checks that facts, declaration and both buttons are inside the card and in
that order; app 194/194, typecheck green. **Needs a new EAS build** to reach testers.

**Tested on the owner's Android (Galaxy S25, Expo Go against the local stack, 2026-11-28):** new account
through all five sign-up steps, the card shows name, „Alles inklusive“, price, features, facts, declaration and
both buttons; both buttons stay disabled until the declaration is ticked; the yearly button opened the
(fake) checkout, the payment went through and the app showed „Willkommen bei ParkShield! Ihr Abo läuft.“;
the contract confirmation with its PDF was sent. Fixed on the device: the price and „/ Jahr inkl. 19 % MwSt.“
are now two elements side by side (with large phone fonts the small text broke under the big line height).
Local quirk, not an app bug: `/dev/checkout` and its return use `WEB_BASE_URL` (the PC's LAN address), which
the phone could not reach over Wi-Fi; the test used `adb reverse` and `localhost` instead.

## 30. Website hero: the Lifetime price under the yearly price (2026-11-28)

Owner request: the hero showed only „19,99 € / Jahr inkl. 19 % MwSt.“, the Lifetime price only in the pricing
card further down. Now a second line sits directly under the hero price: „oder Lifetime: **29,99 €** einmalig ·
kein Abo“ (en „or Lifetime: €29.99 once · no subscription“), new key `landing.heroLifetime`, component
`HeroLifetime` in `apps/web/components/landing.tsx`, price from `LIFETIME_PRICE_CENTS`. It links to `#preise`
(the pricing card with both buttons). Checked at 375 px and 1280 px, no horizontal scroll. Deployed 2026-11-28 (`11a941e`), live on test.park-shield.de and park-shield.de.

## 31. Favicon on test.park-shield.de (2026-11-28)

The owner still saw the old shield next to `test.park-shield.de` in Chrome's address-bar suggestions after
§26. Cause: on the test domain every icon file sat behind the test site's basic auth
(`/favicon.ico`, `/icons/*`, `/manifest.webmanifest` answered 401), and Chrome fetches icons for history and
suggestions without those credentials, so it kept its cached old icon. `park-shield.de` was fine (200). The
Caddyfile's `@scanner_web` matcher now lets these three public static paths through without basic auth.
Chrome may need one visit (or clearing the site's browsing data) to replace its cached icon.
