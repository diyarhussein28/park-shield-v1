# Handover — single plan, app-only alerts, escalation, Sperren, UI update

**Read this first if you continue this work.** It is kept current with every commit (owner rule in
`CLAUDE.md`). The full task is [single-plan-update-prompt.md](single-plan-update-prompt.md); the owner's
answers and the design sheets are summarised below.

_Last updated: 2026-11-22. **The seven fix prompts of 2026-11-22 are implemented, tested and pushed** (see §7): block state + unblock, Alerts screen design, German default + onboarding + sign-out, badge, website footer, unified e-mail layout + contract PDF, support@/payment@ routing. API 615 tests, app Jest 152, typecheck, lint, prettier, db:check green. Deployed to the test server with this commit; the app changes need a new EAS build._

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
4. Lawyer: `LEGAL_REVIEW.md` §9 (price change, phone purpose, § 356a card, 3 € print withdrawal).
5. Small follow-ups: 110/112 as tappable links on the scanner page; `scanner.escalated` /
   `contactOnTheWay` texts still mention contacts (unused by the flow now); a clean-up migration to drop
   the empty `emergency_contacts` table and the unused escalation columns.
6. Findings of the real run (2026-11-22): the vehicle row „Druck oder Versand“ shows no price after the
   welcome print was used (the print screen itself shows 3 € correctly); ~~the Warnungen tab badge still
   counts an alert whose sender was blocked as open~~ (fixed 2026-11-22: the badge counts unopened
   alerts from the server); text fields are right-aligned when the device
   keyboard/region is RTL (set `textAlign: 'left'` on inputs, the app is DE/EN only); the 3 € paid print
   was not paid in the run.

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
