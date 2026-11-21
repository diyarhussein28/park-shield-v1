# Handover — single plan, app-only alerts, escalation, Sperren, UI update

**Read this first if you continue this work.** It is kept current with every commit (owner rule in
`CLAUDE.md`). The full task is [single-plan-update-prompt.md](single-plan-update-prompt.md); the owner's
answers and the design sheets are summarised below.

_Last updated: 2026-11-21 (Stage 1 + 2 API in progress)._

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
- ⬜ Home PDF: 80 × 80 mm with **cut marks** + weatherproof notice; PNG download (`decal.png`) and SVG
  download.
- ⬜ i18n (`packages/i18n` de/en): remove Plus/Premium texts, add single-plan texts.
- ⬜ Web `/konto/*`, pricing on landing page, help articles.
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

### Stage 3 — block sender and chat (⬜ not started)

Existing: `HistoryService` „Absender blockieren“ (`history/history.service.ts` ~line 150, uses
`scanner_blocks` by `block_ref`, phone bans, Protected Mode), `ChatService.senderBlocked`. To do: block
button on alert card / detail / chat (app) + history; on block: close chat (scanner sees „Der Chat wurde
beendet.“), `stopEscalation('blocked')`, existing abuse module only (no new identifiers, no storage).

### Stage 4 — home, vehicle photo, design refresh, scanner UI (⬜ not started)

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

## 5. Next steps (in order)

1. Fix/rewrite the API tests for the new behaviour; add the Stage 1 and 2 tests listed in the prompt.
2. i18n texts; web portal; app screens (Stage 1 + 2 UI).
3. Stage 3, then Stage 4.
4. `LEGAL_REVIEW.md`, `docs/status.md`, `AGENTS.md` (channel matrix, plans, Stripe env) at each stage.
