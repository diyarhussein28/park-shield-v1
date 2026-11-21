# ParkShield – Prompt: Single Plan, App-Only Alerts, Escalation, Sperren & UI Update

Act as a Senior Full-Stack, Expo/React Native and Mobile UI/UX Engineer with solid knowledge of DSGVO and § 25 TDDDG.

We are updating **ParkShield** (park-shield.de): a German vehicle emergency QR-code SaaS. Scanners use a mobile web page without app or account; vehicle owners use the ParkShield Expo/React Native app.

**Use this project's actual stack and conventions, not generic ones:** dbmate SQL migrations + Kysely (no Prisma), PostgreSQL 18, Valkey + the existing job queue, NestJS, Mailjet (transactional e-mail only, open/click tracking disabled), Twilio SMS, FCM push, Next.js web, Expo/React Native app. The domain is **park-shield.de** everywhere (also in the scanner authenticity notice).

**Reference UI sheets are attached** (owner app screens and scanner web screens). Match their visual language: light background, white cards with soft borders, blue primary CTAs, line illustrations, DE/EN toggle on scanner pages, 4-tab bottom navigation (`Home`, `Alerts`, `Vehicles`, `Account`). Where the sheets show old content (Plus/Premium, e-mail channels, upgrade prompts), keep the design but use the rules below.

All user-facing text in German and English. All durations, prices and limits configurable. Mark legal texts with `// TODO [LEGAL REVIEW]`.

**Work in 4 stages.** Finish and report each stage (changed files, migrations, test results) and wait for my OK before starting the next one.

---

## Stage 1 – Single plan, contract screen, Sperren & €3 print

### 1.1 Single plan: €20 per year
- Replace `PLUS` / `PREMIUM` with **one all-inclusive plan: €20/year incl. 19 % MwSt.** Remove plan comparison, upgrade prompts and plan-gating code (feature checks become "subscription active").
- Everything is included: push alerts, reminder, SMS escalation, alert photos, chat, one free welcome print.
- **Renewal: year by year** unless cancelled before the end of the term (`RENEWAL_MODE_B2C = ANNUAL`). Our lawyer has approved this; add a note with the date of approval in `LEGAL_REVIEW.md`.
- Existing test subscriptions: migrate to the single plan with a data migration; no customer is charged differently without notice.

### 1.2 Phone number: mandatory and verified
- The owner's mobile number is **required at sign-up** (used for the SMS escalation). Verify it with an SMS code (Twilio Verify) before the account is active. Mobile numbers only (Twilio Lookup), DE/EU by default.
- Store encrypted; show masked in the app; changing it requires a new verification.
- Privacy notice: purpose = escalation SMS for alerts. `// TODO [LEGAL REVIEW]`

### 1.3 Contract screen („Tarif und Rechnungen")
- Keep the **„Kündigen"** card with the button **„Vertrag hier kündigen"** (existing § 312k flow).
- Remove the separate **„Widerrufsrecht"** card. **But the withdrawal button must stay available during the withdrawal period** (§ 356a BGB: during the withdrawal period it must be permanently available, prominently placed and easy to reach on the interface where the contract was concluded; without it the withdrawal period extends to 12 months + 14 days). So:
  - Merge both into **one card „Vertrag"**.
  - **During the withdrawal period** the card shows: „Sie können bis {Datum} ohne Angabe von Gründen widerrufen." + button **„Vertrag widerrufen"** (clearly visible, same style as „Vertrag hier kündigen"), and below it the cancel text + button.
  - **After the withdrawal period** the withdrawal part disappears automatically; only „Kündigen" remains.
  - The public web withdrawal page and footer link stay unchanged.

### 1.4 Code „Sperren" and printing
- **Sperren deactivates the code immediately and does not create a replacement.** The vehicle then shows a clear warning state everywhere (Home, Vehicles): „Kein aktiver Code – Ihr Fahrzeug ist nicht geschützt" with the button „Neuen Code erstellen".
- Confirmation dialog before Sperren explains exactly what happens: old sticker stops working at once, no new code is created automatically, creating a new code is free, printing and shipping costs €3, self-printing is free.
- **Creating a new code is free** and an explicit action.
- **Print options** (one clear screen, price shown on each option before confirming):
  1. **„Selbst drucken – kostenlos"**: download PDF (sticker 80 × 80 mm with cut marks) and PNG/SVG. Show a notice: „Normales Papier hält Sonne, Regen und Waschanlage nicht lange stand. Wir empfehlen wetterfeste Polyester-Etiketten für Laserdrucker." Always free, any time.
  2. **„Drucken und zusenden lassen"**: **free once** (the welcome print included in the first year's subscription), afterwards **€3 one-time** (incl. MwSt., Stripe one-time payment, invoice like other payments).
- Track entitlements: `free_welcome_print_used`, print orders with price, payment status, and fulfillment status (existing fulfillment/print queue).
- `// TODO [LEGAL REVIEW]`: withdrawal right for the €3 print order (personalised code).

---

## Stage 2 – App-only alerts and escalation

### 2.1 No alert e-mails
- New alerts (`POST /v1/scan/:code/alerts`) trigger **FCM push only**. **No e-mail for alerts**, ever. Mailjet stays only for account and contract e-mails (sign-in code, invoices, cancellation/withdrawal confirmations, welcome).
- Push payload: generic text + `alertId` only (no scanner message, photos, plate or names). Details load in the app.
- Notification settings screen: only push status (on/off, permission check with a button to open system settings), the verified phone number for SMS escalation, and quiet hours if they exist. Remove all e-mail/WhatsApp alert toggles.
- If push is disabled or no device is registered: persistent warning in the app: „Mitteilungen sind aus. Sie erfahren von Warnungen erst nach 30 Minuten per SMS."

### 2.2 Escalation: 10-minute push reminder → 30-minute single SMS
- **Stop condition:** cancel all scheduled escalation jobs as soon as the owner **acknowledges** („Ich komme"), **replies**, **opens the chat**, **blocks the sender**, or **marks the alert resolved**. Merely viewing the alert does not stop escalation.
- If none of these happened:
  1. **After 10 minutes:** reminder push (`escalation_stage = REMINDER_SENT`).
  2. **After 30 minutes in total:** **one single SMS** to the owner's verified number (`escalation_stage = SMS_SENT`, `sms_sent_at`). Never more than one SMS per alert.
- SMS: GSM-7 only, ≤ 160 characters, link to the view page on park-shield.de.
- Monthly SMS safety cap per account (config, default 20); when reached, log it and inform the owner in the app.
- Reliability: keep the existing pattern (due-time columns in the database as source of truth, delayed jobs, 1-minute sweeper, atomic status update, no double SMS).

---

## Stage 3 – Block sender and chat

- **„Absender blockieren"** directly on the alert card (Alerts tab), in the alert detail screen and in the live chat. Keep it in History too.
- On block:
  1. lock the live chat immediately: scanner sees „Der Chat wurde beendet." and cannot send anything more;
  2. cancel pending escalation jobs (reminder + SMS) for this alert;
  3. block further alerts from this sender **using the existing abuse module and its current settings** (server-side `scanner_ref`, phone-ban for verified senders, Protected Mode). **Do not add any device fingerprinting, cookies or client-side storage** (§ 25 TDDDG). Where the module only allows a shorter block (e.g. `scanner_ref` lifetime), keep that; do not invent a 30-day identifier.
- Scanner pages: no cookies, no analytics, no localStorage/sessionStorage/IndexedDB.

---

## Stage 4 – Home screen, vehicle photo, design refresh, scanner UI

### 4.1 Home tab
- Remove the „OFFENE WARNUNGEN" cards from Home. Alerts live only in the `Alerts` tab, with an unread/open badge on the tab icon.
- Header: ParkShield brand + „Hallo {Vorname}" / „Welcome back, {first name}" + protection status (active / no active code / subscription ending).
- Vehicle card with key info and a compact preview of the current QR sticker design (style, headline, status) with quick actions (view/test, edit design).

### 4.2 Vehicle photo (on device only)
- Default: the blue car illustration.
- Tap the car → pick a photo (Expo image picker) → copy it into persistent app storage (document directory), not a temporary cache URI. **Never upload it to the server.**
- Fallback to the illustration if removed or missing; cache-busting key so changes show immediately.
- Small note in the picker screen: „Das Foto bleibt nur auf diesem Gerät. Bei einem neuen Handy oder nach Neuinstallation müssen Sie es erneut auswählen."

### 4.3 Design refresh bug
- After „Design speichern", Home and Vehicles must show the new design, headline, format and preview immediately (invalidate state/query cache, `useFocusEffect`, cache-busting keys/URIs). No tab switch needed.

### 4.4 Scanner web screens
- Align `/scan/:code` (problem selection, optional note and photos) and `/scan/:code/status` (progress `Gesendet → Zugestellt → Bestätigt`, chat with the owner, chat rules, 110/112 emergency note, authenticity notice „Nur echt auf **park-shield.de**") with the attached scanner sheets.
- Show the blocked/closed chat state clearly.

---

## Tests (per stage)
- Stage 1: single plan everywhere (no Plus/Premium left), annual renewal end dates, phone verification required, contract card shows withdrawal only during the withdrawal period, Sperren creates no new code, first shipped print free then €3, self-print always free.
- Stage 2: no alert e-mail sent in any case; push payload has no personal data; reminder at 10 min; exactly one SMS at 30 min; every stop condition cancels jobs; viewing alone does not; sweeper recovers missed jobs; SMS cap.
- Stage 3: block locks chat instantly, cancels escalation, uses the abuse module; scanner pages touch no storage APIs (E2E).
- Stage 4: Home has no alert cards; badge on Alerts tab; vehicle photo persists across app restarts and is never sent to the API; design change visible immediately after saving.

Update `LEGAL_REVIEW.md` and `docs/status.md` at the end of each stage.
