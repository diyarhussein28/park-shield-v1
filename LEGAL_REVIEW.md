# Legal review: texts and rules marked `TODO [LEGAL REVIEW]`

Nothing here is final. Every text is a draft for the IT-law firm. Short legal texts live versioned in
the table `legal_texts` (change = new version, no deploy); the legal pages are in
`packages/shared/src/legal-content.ts`.

## 1. Renewal for consumers (§ 309 Nr. 9 BGB) — decide first

> **Approved 2026-11-21:** the owner reports that the lawyer approved the yearly renewal
> (`RENEWAL_MODE_B2C = ANNUAL`: year by year unless cancelled before the end of the term). All
> existing subscriptions were moved to `annual` (migration `20261206000000_single_plan`). Keep the
> written approval with the contract documents.

- Setting `renewal.mode_b2c`: **`annual` (default, owner decision 2026-11-18)** or
  `monthly_after_first_term`. `annual` renews by 12 months and is charged once a year; a cancellation
  takes effect at the end of the running 12-month period, with no refund of the rest. **Risk:** for
  consumer contracts since 1 March 2022 § 309 Nr. 9 BGB allows a tacit extension only for an indefinite
  term with at most one month's notice, so this clause is likely invalid in AGB (Abmahnung risk). The
  lawyer must decide; if they object, switch the setting back.
- Fallback `monthly_after_first_term`: after the first 12 months the contract continues monthly at
  annual price / 12 (needs `STRIPE_PRICE_*_MONTHLY`, not created in Stripe yet). Compliant middle way
  if needed: keep the yearly charge but let consumers cancel with one month's notice after the first
  term and refund the unused months (the `proration` refund already exists; the end date in
  `computeCancellationEnd` would need a third mode). Each contract keeps the mode it was concluded
  under (`subscriptions.renewal_mode`).
- Text: `renewalRule()` in `legal-content.ts`, AGB § 4, checkout summary, e-mails.

## 2. Texts

| Where                                                                                                   | Key / file                                           |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Immediate-start consent (checkout)                                                                      | `legal_texts` `checkout.immediate_start` v1 (de, en) |
| AGB / privacy acknowledgement                                                                           | `legal_texts` `checkout.terms_ack` v1                |
| AGB § 3, § 4; Widerrufsbelehrung incl. § 356a online withdrawal, no § 312g deduction                    | `legal-content.ts`                                   |
| Contract confirmation (§ 312f), withdrawal receipt, cancellation confirmation, revoke, renewal reminder | `apps/api/src/mail/templates.ts`                     |
| Withdrawal page, cancellation page                                                                      | `apps/web/app/widerrufen`, `apps/web/app/kuendigen`  |

## 3. Rules

- Wertersatz: paid × started days / period days (`computeWithdrawalRefund`, `legal/rules.ts`).
- No § 312g deduction for the sticker (`refunds.custom_decal_cost_cents` = 0); no return required.
- Withdrawal period from contract conclusion, timely if received before the end.
- Cancellation ends with the paid period that includes the requested date (`computeCancellationEnd`).
- Past-due grace for the scanner: `scanner.past_due_grace_days` (21).
- Retention of `withdrawal_requests`, `cancellation_requests`, `consent_records` is not yet in `run_retention()`.

## 4. Abuse protection (rate limits, blocking, Protected Mode, phone bans)

Code: `apps/api/src/abuse/`, `apps/api/src/scan/`, `apps/api/src/history/`, scanner page
`apps/web/lib/scanner/`, migration `db/migrations/20261127000000_abuse_protection.sql`.

### 1. `scanner_ref` design (§ 25 TDDDG, Art. 6(1)(f) DSGVO)

- Computed on the server only: `scanner_ref = HMAC-SHA256(daily_salt, ip_prefix | user_agent)` with
  `ip_prefix` = IPv4 /24 or IPv6 /64. Nothing is read from or written to the scanner's device: no
  cookies, no Web Storage, no IndexedDB (an E2E test checks this, `e2e/tests/abuse-protection.spec.ts`).
  The status of the scanner's own alert survives a reload through the URL fragment, which is never
  sent to a server.
- `daily_salt` is **random** per UTC day and lives only in Valkey (TTL 26 h), never in PostgreSQL or
  backups. This is stricter than a salt derived from a master secret: even with every server secret,
  two days cannot be linked. Only while Valkey does not answer is the salt derived from
  `SESSION_SECRET` and the date (fail-open, so alerts never stop); those references differ from the
  normal ones and expire the same way.
- `scanner_ref` is nulled on the alert after 24 h (`run_retention`); Valkey counters expire with their
  window (max. 24 h).
- `block_ref = HMAC(block_key, ip_prefix | user_agent | qr_token_id)` (per vehicle, 30 days) stays as
  decided for OW-08: an owner's block lasts **30 days** for that one vehicle (the owner chose 30 days
  over 24 h on 17 Nov 2026). It cannot link a scanner across vehicles.
- **Question:** is the 30-day per-vehicle pseudonym still covered by Art. 6(1)(f) with the balancing
  test in `docs/04-legal-privacy.md`? Is IP /64 + User-Agent acceptable as input?

### 2. What a blocked sender sees

"Ihre Nachricht konnte nicht zugestellt werden." (HTTP 403). No hint at the owner or a block. Chosen
over a silent ("shadow") block so that a person in real danger looks for other help.

### 3. Optional phone confirmation (Protected Mode)

- Offered only while the vehicle is in Protected Mode. Optional: without it the alert type still goes
  out at once on every channel; only free text (and, later, photos) waits behind "Anzeigen".
- Twilio Lookup (line type intelligence) accepts mobile numbers only; VoIP, landline and unknown are
  refused. Countries: DE + EU (setting `abuse.verify_countries`). Twilio Verify sends the SMS code;
  Twilio's SMS fraud protection (Fraud Guard) must be on for the Verify service.
- Limits against SMS pumping: per `scanner_ref`, per number, per country; captcha before every code.
- Stored: only `phoneHash = HMAC-SHA256(phone_pepper, E.164)` on the alert (deleted with the alert after
  90 days). `phone_pepper` is a long-lived secret (`PHONE_PEPPER`, secrets store; required in
  production). The number itself is never stored or logged by ParkShield.
- The confirmation is a signed token valid for 30 minutes, kept in page memory only.
- **Privacy notice on the scanner page** (`packages/i18n`, `scanner.verifyPrompt` and
  `scanner.verifyPrivacy`), draft:
  > Zweck: Schutz vor Missbrauch (Art. 6 Abs. 1 lit. f DSGVO). Wir speichern nie Ihre Nummer, nur einen
  > nicht umkehrbaren Prüfwert mit Ihrer Warnung (höchstens 90 Tage); sperrt der Halter Sie, bis zu
  > 12 Monate. Die SMS versendet unser Dienstleister Twilio.
- **Questions:** Is Art. 6(1)(f) the right basis, or consent (Art. 6(1)(a)) because the scanner
  actively enters the number? Is a keyed hash of a phone number personal data for ParkShield (yes,
  presumably: pseudonymous) and is the wording "nicht umkehrbar" accurate enough? Does the privacy
  policy need a new section (Datenschutzerklärung: scanner, Protected Mode, Twilio Verify/Lookup)?

### 4. Phone bans (12 months)

- An owner's block of a sender with a confirmed number bans that number **for this vehicle** for
  12 months (setting `abuse.phone_ban_months`). A banned number can neither confirm again nor send to
  that vehicle; it gets the neutral answer from §2.
- **Global ban:** if owners of 3 different vehicles ban the same number within 90 days, staff see a
  review candidate (hash prefix and counts only). Only a staff member can confirm a global ban
  (12 months); every decision is in the audit log. No automatic global ban.
- **Questions:** Is 12 months proportionate? Does the banned person need a way to object, and how
  would they, given that ParkShield cannot contact them (no number stored)?

### 5. Twilio as processor (Lookup, Verify)

- Twilio Ireland Limited, Dublin; transfers to the US under the EU-US Data Privacy Framework and SCCs.
- Twilio Verify keeps verification records (number, status, timestamps) per its DPA and retention
  policy; Lookup requests are logged by Twilio. **To do:** confirm the retention periods in Twilio's
  current DPA, list Lookup/Verify in the record of processing and the Datenschutzerklärung, and check
  whether a TIA is needed beyond the DPF.

### 6. Protected Mode for owners

- Automatic: 2 blocks within 30 days for one vehicle → 30 days (extended by further blocks). Manual on
  or off at any time in the vehicle page. Applies to everyone who scans that vehicle, because the
  harasser cannot be identified reliably; this is why it hides only content and never blocks.
- Notifications (app push, browser push, SMS, e-mail) carry no free text of an unconfirmed sender, only
  "Nachricht von nicht bestätigtem Absender – ansehen in ParkShield".

## 5. Alert photos (Phase 2, behind `ALERT_PHOTOS_ENABLED`)

Code: `apps/api/src/alert-media/`, scanner page `apps/web/lib/scanner/`, view page `apps/web/app/v/`,
migration `db/migrations/20261128000000_alert_photos.sql`. Off by default; which plans get it is the
setting `photos.plans` (default Plus and Premium since migration `20261203000000_photos_all_plans`,
owner decision 2026-11-20). **Go-live blocker:** everything in this section, and the
privacy-notice anchor `/datenschutz#warnfotos` that the scanner page links to (it does not exist yet).

### What the feature does (facts for the review)

- A scanner may attach up to 2 photos to an alert. Before the camera opens they must tap „Verstanden“
  on the camera notice below. Live camera (`getUserMedia`) is the preferred path; if it is unavailable
  or refused, the normal file picker opens (`capture="environment"` is only a hint, so a stored photo
  can be chosen; a browser cannot prove a photo is live).
- Phone side: re-encoded via canvas to JPEG ≤ 1600 px, < 300 KB (drops EXIF on the device). Server
  side: magic bytes (JPEG/WebP only), decoded and re-encoded with sharp without any metadata (EXIF,
  GPS, XMP, IPTC, ICC removed; covered by a test with a GPS-tagged image).
- Stored on our own server (Germany), outside every web root, each file encrypted with its own
  AES-256-GCM key; the key is stored wrapped with the application key in PostgreSQL. Files are not in
  any backup. Deleting the key makes every copy unreadable (crypto-shredding).
- The owner gets **one link** (`/v/<token>`, 256-bit token, only its hash stored) in every channel. No
  photo is sent to Twilio, the e-mail provider (Mailjet) or a push service (FCM); they only carry the
  link. In the native app the owner loads the photos from our API with the app session.
- Deleted automatically **30 days** after the alert (file, key, link), or **at once** when the owner
  taps „Missbrauch melden“ (view page, portal history, e-mail link, app alert screen and app
  history). The report also deletes the alert
  text, blocks the sender for this vehicle (30 days, `photos.abuse_block_days`), stops photo uploads to
  this vehicle for 24 h (`photos.abuse_upload_block_hours`) and creates a review entry in ops. The
  report itself stores no photo and no free text.
- In Protected Mode (§4.6) photos of an unconfirmed sender are shown only after „Anzeigen“.

### Camera notice (scanner page, `packages/i18n` `scanner.photoNotice`)

> „Bitte fotografieren Sie nur das betroffene Fahrzeug – keine Personen oder fremden Kennzeichen.“

Plus the link „Datenschutzhinweise“ → `https://park-shield.de/datenschutz#warnfotos`.
**Question:** is this notice sufficient as information at the time of collection (Art. 13 DSGVO) for the
scanner, or does the scanner page need the short privacy text inline?

### Privacy notice section „Fotos bei Warnungen“ — DRAFT, to be written by the lawyer

Points the section has to cover (no wording proposed here on purpose):

- **Controller and purpose:** documenting the reported problem for the vehicle owner (e.g. blocked
  exit, damage) so they can react; abuse prevention.
- **Legal basis:** to be decided. Candidates: Art. 6(1)(f) (legitimate interest of the owner and of
  the scanner) for scanner data and for third parties who may appear in a photo; Art. 6(1)(b) towards
  the owner (paid feature). **Question:** which basis for bystanders and other number plates that end
  up in a photo despite the notice?
- **Categories:** image content (vehicle, surroundings, possibly people or plates), time of the alert;
  no metadata (removed), no location.
- **Recipients:** only the vehicle owner (via the view link) and ParkShield staff in the abuse review
  (staff do not see photos; a report deletes them). Hosting: our own server in Germany. No transfer of
  the images to Twilio, the e-mail provider (Mailjet) or the push service (FCM).
- **Retention:** 30 days, earlier on an abuse report; not in backups.
- **Rights:** how a scanner (no account) can exercise access/erasure — they cannot be identified by us.
  **Question:** is pointing to the abuse/erasure path of the owner and a contact address enough?

### DPIA (Datenschutz-Folgenabschätzung, Art. 35 DSGVO)

**Open — needs a decision before go-live.** Arguments for a DPIA: images of public space taken by
strangers that may show uninvolved people or plates; new technology use on a consumer platform;
possibly systematic in aggregate. Arguments against: no automated processing of the images, no
recognition, short retention, single recipient. Also check the DSK „Muss-Liste“. Recommendation for
the engineering side: do the DPIA (or a documented threshold assessment) anyway; the facts above are its
input.

### Twilio (SMS)

- SMS carry only the alert type, the vehicle nickname and the view link, never a photo, in one GSM-7
  segment (`smsLinkText` in `apps/api/src/notifications/sms-texts.ts`).
- **Twilio:** DPA with Twilio Ireland Limited; transfers to the US under the EU-US Data Privacy
  Framework and SCCs. **To do:** confirm the DPA covers SMS content incl. the view link, and Twilio's
  message-body retention.
- WhatsApp was removed completely (no Meta dependency, see §7).

## 6. Welcome letter (posted to every new customer)

Code: `apps/api/src/letters/` (texts in `company.ts`, layout in `letter.ts`). Points to check:

- **Business-letter details** (footer, `TODO [LEGAL REVIEW]` in `company.ts`): for an
  Einzelunternehmen without register entry we print name, address, owner and USt-IdNr.; register
  court/number, tax number and bank details are switchable in ops → Einstellungen → Unternehmen.
- **Contract summary** (price, 12-month first term, renewal rule from `renewalRule()`): must match
  the AGB version the contract was concluded under.
- **Retention:** the letter snapshot (name, postal address, plate) is deleted with the customer
  account. Copies of sent business letters may have to be kept 6 years (§ 257 HGB) — decide
  whether a deleted account must keep its letter.
- **Address source:** the Stripe billing address entered at checkout is reused for posting the
  welcome letter. Mention this purpose in the Datenschutzerklärung.

## 7. Native app, tiered notifications, trusted contacts and live chat (2026-12)

Code: `apps/mobile` (Expo app), `apps/api/src/{app,chat,contacts,notifications}`, migration
`db/migrations/20261201000000_app_notifications_chat.sql`. Every point below is marked
`TODO [LEGAL REVIEW]` in code or texts.

### App privacy notice (new section, to be written by the lawyer)

- **Push via Firebase Cloud Messaging (Google):** the app registers an FCM token (no device fingerprint,
  no advertising ID; Android blocks `AD_ID`). iOS pushes travel Google → Apple (APNs). The push
  payload contains only a generic text („Neuer Alarm für Ihr Fahrzeug: Ausfahrt blockiert“) and ids
  (`alertId`, `type`, `kind`): no scanner message, no photo, no licence plate, no nickname, no name
  (test: `apps/api/src/notifications/sms-templates.test.ts`, `replies.test.ts`). **To do:** DPA with
  Google (Firebase), transfer basis (EU-US DPF / SCCs), Art. 13 wording, and whether the alert _type_
  in the push text is acceptable or should become fully generic.
- Device tokens: deleted on sign-out, when FCM reports them invalid, and after 90 days without a sign
  of life (`run_retention`). Erasure requests delete them with the account (processor step
  `firebase`, automated).
- No analytics or advertising SDK. Crash reporting is not included; if added, only self-hosted or
  EU-hosted and documented.
- Session token in iOS Keychain / Android Keystore (`expo-secure-store`, this device only). Photos are
  kept in memory only and saved to the gallery only on an explicit „Speichern“.
- **Store privacy labels** (App Store „App Privacy“, Google Play „Data safety“): contact info (e-mail,
  phone for SMS: app functionality, linked to the user), identifiers (FCM token: app functionality),
  user content (alert photos and chat messages received: app functionality, not stored on the
  device), no tracking, no data sold. To be confirmed before submission.
- Denied notification permission: persistent banner in the app and at most one e-mail hint a day
  (`push_denied`).

### Channel matrix (product decision, for the AGB / Leistungsbeschreibung)

- PLUS: app push + e-mail. PREMIUM: app push + e-mail + SMS (fair use, max. 2 SMS per alert to the
  owner). Escalation to trusted contacts is PREMIUM only. WhatsApp and the Business plan are removed;
  the privacy notice and AGB must no longer mention WhatsApp (`packages/shared/src/legal-content.ts`
  still has WhatsApp in the privacy text and the Leistungsbeschreibung: rewrite).

### Trusted contacts („Vertrauenspersonen“)

- **Consent text** (e-mail `ec_invite`, SMS `smsInviteText`, page `/notfallkontakt`): who asks (the
  owner's first name), what the contact receives (alert type and the vehicle label the owner chose; no
  plate, no scanner text, no photo), by SMS and e-mail, „Ich komme“ and an opt-out link in every
  message. Nothing is sent before consent.
- **Deletion:** no answer or declined → deleted after 14 days. Opt-out from any escalation message
  (`/k/<token>` → „Keine Benachrichtigungen mehr erhalten“) deletes the contact at once and tells the
  owner. Downgrade PREMIUM → PLUS: contacts deactivated at once, deleted after 30 days, owner informed
  (`ec_deactivated`); a re-upgrade within 30 days restores them. Is keeping them 30 days after a
  downgrade covered by the contact's consent?
- Escalation SMS count toward the owner's SMS fair-use limit; at the limit the contact gets e-mail only.
- Legal basis for processing the contact's phone number and e-mail: their consent (Art. 6(1)(a)) —
  confirm, and the information duty towards the contact (Art. 14) via the invitation.

### Live chat (owner-initiated)

- Locked until the owner opens it; text only, 500 characters, 20 messages per side; scanner messages
  pass the existing text filter (links, phone numbers, e-mail addresses, insults); owner messages get a
  warning before personal data but are allowed (the owner decides to share).
- Ends when the owner closes it, after 20 minutes without a message, or 3 hours after opening.
  **Retention:** messages (encrypted at rest) and the chat token hash are deleted 24 h after the chat
  closed; a 7-day backstop deletes messages of a chat that never closed. The app then shows
  „Chatverlauf wurde nach 24 Stunden automatisch gelöscht.“
- **Scanner side (§ 25 TDDDG):** the chat token lives in memory and in the URL fragment only (never
  sent in a URL to a server, only in the Socket.io handshake payload); no cookies, no Web Storage, no
  IndexedDB (e2e test `app-notifications-chat.spec.ts`). Screen Wake Lock while waiting (no data).
  Presence („Absender ist gerade online“) is derived from the open connection and stored only as the
  last-seen time of the session (deleted with it).
- The scanner page needs a privacy notice line on the chat (what is stored, 24 h) — draft text needed.

### Paying inside the app (owner decision 2026-11-19)

- The app contains the whole customer portal, including the checkout: the subscription (Plus/Premium)
  is paid on **Stripe's page inside the app** (in-app browser), the same § 312j flow, texts and consent
  records as on the website. Cancellation (§ 312k button) and withdrawal (§ 356a) work in the app too;
  account deletion in the app is required by Apple (guideline 5.1.1(v)) and Google.
- **Risk:** Apple (guideline 3.1.1) and Google Play (payments policy) require their own in-app purchase
  for digital subscriptions; the app may be rejected at review. Options if that happens: Apple's EU
  „StoreKit External Purchase Link“ entitlement (link to the website checkout, Apple fee), or in-app
  purchase. The printed decal (a physical good) may stay on Stripe either way.
- The Stripe return goes through `/app/zurueck`, which only redirects to the app's own scheme.

## 8. Sign-up with name and address, Face ID app lock (2026-11-20)

Code: `apps/api/src/profile/`, migration `db/migrations/20261205000000_user_profiles.sql`, app screens
`apps/mobile/src/app/{willkommen,registrieren,profil,app-sperre,tarif}.tsx`, web form `ProfileForm` in
`apps/web/app/konto/parts.tsx`. Background: owner decisions in `docs/app-redesign.md` §7.

### New personal data

| Data                                             | Required?                      | Purpose                                                                | Stored                                                                                          |
| ------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| First and last name                              | yes, before the first checkout | contract, invoices, welcome letter                                     | `user_profiles`, AES-256-GCM per field                                                          |
| Street and house number, postcode, city, country | yes, before the first checkout | welcome letter (always this address), invoices (prefilled into Stripe) | as above                                                                                        |
| Mobile number                                    | optional                       | SMS alerts (Premium)                                                   | only as the verified SMS channel (`contact_channels`, encrypted), with the existing SMS consent |

- Deleted with the account (`ON DELETE CASCADE`), contained in the data export (JSON and PDF).
- The name and address are sent to Stripe as the customer's name and billing address before
  checkout (`Payments.updateCustomer`); Stripe already received the billing address before (entered
  on its page), so the recipient is not new, but the data now reaches Stripe one step earlier.
- Accounts from before this change must complete name and address on the next app start (blocking)
  or before the next checkout on the website. They get no automatic welcome letter afterwards.

TODO [LEGAL REVIEW]:

- **Legal basis:** Art. 6(1)(b) GDPR (contract: name and address for the contract and the invoices)
  and Art. 6(1)(c) (§ 14 UStG invoice data) — to confirm. The welcome letter by post: part of the
  contract or Art. 6(1)(f)? Is the address of customers who never pay (sign-up without checkout)
  deleted after a period? (Currently only with the account; proposal: delete profiles of accounts
  without any contract after 90 days, like other unused accounts — needs a decision.)
- **Data minimisation:** the product promises minimal data. Making name and address mandatory for
  everyone needs a justification per field in the privacy policy. Draft for `/datenschutz`
  (to be written by the lawyer, not final):
  > _Entwurf:_ „Bei der Registrierung erheben wir Ihren Vor- und Nachnamen und Ihre Anschrift. Wir
  > benötigen sie für den Vertrag, die Rechnungen und den Willkommensbrief, den wir Ihnen per Post
  > schicken. Die Person, die Ihren Aufkleber scannt, sieht diese Angaben nie. Ihre Handynummer ist
  > freiwillig und wird nur für Warnungen per SMS verwendet.“
- **Welcome letter address:** always the sign-up address, even if the decal goes to another address
  (owner decision). Fine under the contract, or does the customer need to be told?
- **Face ID / fingerprint:** biometric data never leaves the device and the app never receives it
  (`expo-local-authentication` only returns success or failure). The `NSFaceIDUsageDescription`
  text is in `apps/mobile/app.config.ts` (German): „ParkShield nutzt Face ID nur, um die App auf
  diesem Gerät zu entsperren. Ihr Gesicht verlässt das Gerät nie.“ — wording to confirm. Art. 9 GDPR
  should not apply (no processing by us), to confirm for the privacy notice.
- **Store privacy labels** (App Store „App Privacy“, Google Play „Data safety“), additions to §7:
  name and physical address (contact info, app functionality, linked to the user, not used for
  tracking); phone number stays optional. Face ID: nothing to declare (on-device only) — to confirm.
- **Checkout presentation (§ 312j BGB):** in the app the price, term and renewal rule and the
  immediate-start declaration stay visible directly above „Zahlungspflichtig bestellen“; only the
  withdrawal notice with its link, the AGB/privacy links and the voucher field are folded under
  „Vertrag, Verlängerung und Widerruf“. Is folding these acceptable?

## 9. Single plan, app-only alerts, SMS escalation, Sperren, print (2026-11-21)

Owner decisions of 2026-11-21 (`docs/handover.md` §1, task `docs/single-plan-update-prompt.md`).

### Single plan (20 € / year incl. 19 % MwSt.)

- One all-inclusive plan instead of Plus (10 €) and Premium (15 €): one vehicle, app push alerts,
  reminder, SMS escalation, alert photos, chat, one free printed decal (welcome print).
- **Price change of existing contracts:** every existing subscription (test subscriptions only, nobody
  was live) was moved to the 20 € plan by the migration. For real customers a price increase needs
  their consent (no unilateral price adjustment clause in the AGB) — do not repeat this after launch.
- Texts: AGB § 1 and § 3, English summary (`packages/shared/src/legal-content.ts`), pricing page,
  checkout, contract confirmation, welcome letter plan lines (`landing.planF1..6`).

### Mobile number required (escalation SMS)

- Required at sign-up, verified with an SMS code (Twilio Verify) and checked to be a mobile number
  (Twilio Lookup), DE + EU by default (`owner_phone.countries`). Stored encrypted, shown masked;
  changing it needs a new code; it cannot be removed while the account exists.
- Legal basis proposed: Art. 6(1)(b) DSGVO (performance of the contract: the SMS escalation is part
  of the service). Privacy policy §3 text drafted in `legal-content.ts` (`TODO [LEGAL REVIEW]`).
- Twilio Lookup/Verify as processor: see §4.5; the owner's number now goes to Lookup and Verify too.

### App-only alerts and the single SMS

- No e-mail for alerts any more (Mailjet only for account and contract mails). App push payload: a
  generic text and `{ alertId, kind }` only (FCM is a Google service).
- Without a reaction: reminder push after 10 min, one SMS after 30 min (GSM-7, ≤ 160 characters, link
  to the view page on park-shield.de). Never during quiet hours (owner decision), never for test
  alerts, at most `sms.monthly_cap` (20) per month.
- Trusted contacts („Vertrauenspersonen“) were removed completely; their data was deleted
  (migration `20261206000100_owner_escalation`). Remove the section from the privacy policy and the
  AGB; §7 „Trusted contacts“ above is obsolete.

### Contract screen: withdrawal button (§ 356a BGB)

- The app's and portal's contract card („Vertrag“) shows „Vertrag widerrufen“ prominently while the
  withdrawal period runs (`withdrawalOpenUntil`), next to „Vertrag hier kündigen“; afterwards only the
  cancellation part. The public `/widerruf` page and the footer link are unchanged. Please confirm this
  meets „ständig verfügbar, hervorgehoben, leicht zugänglich“ for the app as the interface where the
  contract was concluded.

### Sperren and print orders

- „Sperren“ deactivates the code at once and creates no replacement; a new code is free and explicit.
- Self-printing is always free (PDF 80 × 80 mm with cut marks, PNG, SVG).
- „Drucken und zusenden lassen“: free once (welcome print in the first year), then **3 € one-time**
  incl. MwSt. (Stripe, setting `prices.print_shipped_cents`). **Open:** is there a right of withdrawal
  for this order, or does § 312g Abs. 2 Nr. 1 BGB (goods made to the consumer's specifications — the
  decal carries a personal code) exclude it? Until decided the order is treated like any other
  one-time purchase (`TODO [LEGAL REVIEW]` in `apps/api/src/orders/orders.service.ts`).

### Block sender

- „Absender blockieren“ (alert card, detail, chat, history) ends the chat at once, cancels the
  escalation and uses only the existing abuse module (server-side `scanner_ref`/`block_ref`, phone ban
  for confirmed senders, Protected Mode); no fingerprinting, cookies or client-side storage. The
  scanner only sees „Der Chat wurde beendet.“

## 10. Contract confirmation PDF and the unified e-mail layout (2026-11-22)

- **Contract confirmation (§ 312f BGB):** the e-mail `contract_confirmation` now carries the PDF
  „Vertragsbestätigung“ (`apps/api/src/billing/contract-confirmation.ts`): contract data (customer and
  contract number, start, next renewal, 20 € incl. MwSt.), renewal and cancellation rules, the AGB in
  the accepted version, the Widerrufsbelehrung, the Muster-Widerrufsformular, the immediate-start
  declaration with its timestamp, and the included services (push, reminder, SMS escalation, photos,
  chat, one free printed sticker with shipping, free self-printing, 3 € per further shipped print or
  shipped new code after „Sperren“). The full AGB and Widerrufsbelehrung moved from the e-mail body into
  the PDF. Which versions were sent is stored in `contract_confirmations` (doc version, renewal mode,
  consent id, SHA-256 of the PDF; the PDF itself is not stored). To check: is the PDF attachment
  sufficient as the durable medium, the wording of every section, and the English model withdrawal form
  (the English Widerrufsbelehrung has no form of its own yet). `// TODO [LEGAL REVIEW]` in the code.
- **Every e-mail** uses one layout with the footer company name and address from the company settings,
  links to Hilfe-Center, Datenschutz, AGB and Widerrufsbelehrung, and the line „Dies ist eine
  automatische Nachricht … Bitte antworten Sie nicht auf diese E-Mail.“ Two texts that asked the
  customer to reply (new device, break-glass notice) now point to „Hilfe & Kontakt“. Open and click
  tracking stay off; the only image is our own logo (`/email/parkshield-shield.png`).

## 11. Internal routing: support@ and payment@ (2026-11-22)

- **Contact form → `SUPPORT_EMAIL`** (default `support@park-shield.de`): topic, message, the customer's
  e-mail (reply-to), customer and contract number when signed in, app/web version and time; the
  optional name is no longer passed on. The customer gets a short receipt („Wir haben Ihre Nachricht
  erhalten …“). Friendly Captcha, rate limits per IP and per e-mail, max. 5,000 characters.
- **Payment notifications → `PAYMENT_NOTIFY_EMAIL`** (default `payment@park-shield.de`, the only
  recipient the code will use): every new subscription and every completed payment (20 € / year,
  renewals, 3 € print order), once per Stripe event, with the customer's postal letter as a PDF
  attachment (`{Kundennummer}_{Vertragsnummer}_Brief.pdf`, same generator and snapshot as the admin
  download). The PDF contains **name and postal address**. Requirements before go-live:
  - the payment mailbox must be **EU-hosted** (Strato: Germany) and reachable only by the people who
    post the letters;
  - a **deletion rule** in that mailbox, e.g. delete mails 90 days after the letter was posted (the
    data stays in the admin panel and the encrypted letter snapshot);
  - record it in the processing register (Art. 30 DSGVO) as an internal copy for fulfilment.
- The mailboxes `support@` and `payment@park-shield.de` must exist at Strato before the env defaults
  are relied on; the test server still sets `SUPPORT_EMAIL=contact@park-shield.de`.

## 12. Unified billing (RevenueCat + Stripe) and the personalised sticker (2026-11-22)

Task `ParkShield-Billing-and-Sticker-Prompt.md`, design in `docs/billing-unified.md`. Every text below
is marked `// TODO [LEGAL REVIEW]` in the code.

### RevenueCat, Inc. (USA) — new processor

- Purpose: managing in-app subscriptions bought through the App Store / Google Play (entitlement,
  renewals, refunds) for our backend.
- Data sent by us: only the RevenueCat `app_user_id` = our internal user UUID. **No** e-mail, name,
  address, phone, plate or customer attributes; the app collects no IDFA / advertising IDs. RevenueCat
  receives the purchase data (product, transaction ids, dates, store, country/currency) from Apple /
  Google directly.
- Needed: RevenueCat DPA signed, third-country transfer on SCC (and DPF certification if available),
  TIA; entry in the processing register; section in the Datenschutzerklärung (draft added by the web
  change in `packages/shared/src/legal-content.ts`).

### Store purchases (Apple / Google are the seller)

1. **§ 312k BGB (Kündigungsbutton):** for store subscriptions „Vertrag hier kündigen“ opens the
   store's subscription management with a short explanation; our backend cannot cancel Apple
   subscriptions. Is linking to the store enough, given that the contract for the subscription is
   concluded with Apple/Google (they are the merchant of record)?
2. **§ 356a BGB (Widerrufsfunktion):** the „Vertrag widerrufen“ button stays and leads to the store's
   refund route (Apple: reportaproblem.apple.com, Google: Play order history). Enough?
3. **Withdrawal handling:** Apple/Google decide on refunds; we do not compute anything for store
   subscriptions and keep no sticker deduction there. A store refund before personalisation cancels
   the fulfillment order; after personalisation the sticker stays with the customer.
4. **Our contract confirmation** for store subscribers is a „Vertragsbestätigung“, not an invoice, and
   says that Apple/Google issue the receipt. Is our own Widerrufsbelehrung/withdrawal text needed for a
   store purchase at all, or should it say that withdrawal goes through the store only?
5. **Physical goods in an IAP subscription:** the yearly subscription includes a personalised sticker
   incl. shipping (value 3 €). App Store Review Guideline 3.1.1/3.1.3 — is including a physical good in
   an IAP subscription acceptable to Apple? The 3 € extra prints are paid via Stripe (physical goods
   must not use IAP, 3.1.5(a)).
6. **Price (resolved 2026-11-25):** the plan now costs 19,99 € everywhere (web, app/Stripe, stores), so there is no channel difference any more. Old question: Is a 1-cent difference between channels acceptable, and must the app paywall then show 19,99 € in the breakdown (it shows the store price)?
7. **Double subscriptions:** prevented in the app and on the web; if one happens anyway (race, old app),
   the store contract is kept as `incomplete` for ops, who refund one of them.

### Personalised sticker (§ 312g Abs. 2 Nr. 1 BGB)

- The printed sticker is made to the customer's specification: their vehicle label (2–20 characters,
  printed on every design) and the design chosen in „Design ändern“ (style, headline). The licence
  plate is never printed. Is that enough personalisation for the exclusion („nach Kundenspezifikation
  angefertigt“), given the QR code itself is generated by us?
- One confirmation step before the order (preview, address, notice): „Ihr Aufkleber wird nach Ihren
  Angaben individuell gedruckt. Für individuell angefertigte Waren besteht kein Widerrufsrecht.“ The
  order is printed only after this confirmation; a frozen snapshot (`design_snapshot`, `personalized_at`)
  is stored on the order.
- Checkout / paywall info line (no extra checkbox) next to the unchanged immediate-start checkbox:
  „Hinweis: Der personalisierte Aufkleber wird nach Ihren Angaben gefertigt. Für ihn besteht kein
  Widerrufsrecht (§ 312g Abs. 2 Nr. 1 BGB). Ihr Widerrufsrecht für das Abo bleibt bestehen.“
- Price breakdown (web checkout, app paywall, contract e-mail, PDF, Stripe subscription/invoice
  description): „ParkShield Jahresabo: 20,00 € / Jahr, inkl. MwSt. Im Preis enthalten: personalisierter
  Aufkleber inkl. Versand im Wert von 3,00 €.“ Value from the setting `prices.sticker_value_cents` (300),
  stored per subscription (`sticker_value_cents`). Is the 3 € value (incl. shipping) defensible? Is a
  bundled exclusion inside a service subscription valid, or does it need a separate purchase?
- 3 € additional prints: personalised at order time, no right of withdrawal, same notice before payment
  (replaces the earlier open question on the 3 € print order).
- Updated Widerrufsbelehrung (exclusion for the sticker, withdrawal right for the subscription,
  Wertersatz for service days), version bumped to `LEGAL_DOC_VERSION` `2026-11-28`, stored per
  subscription (`withdrawal_notice_version`).

### Refund formula on withdrawal (Stripe subscriptions only)

`computeWithdrawalRefund` in `apps/api/src/legal/rules.ts`, unit-tested:

```
stickerExcluded = sticker_value_cents  if personalised before the withdrawal was received, else 0
serviceBase     = paid − stickerExcluded
usedDays        = whole days from service start to receipt (0 without the immediate-start consent)
serviceValue    = round(serviceBase × usedDays / days in the contract year)
refund          = max(0, paid − stickerExcluded − serviceValue)
```

Example: 2000 − 300 − round(1700 × 10 / 365) = 1653 → „Gezahlt 20,00 € − personalisierter Aufkleber
3,00 € − genutzte Leistung (10 Tage) 0,47 € = Erstattung 16,53 €“ (withdrawal e-mail). Questions:

- **Whole days** (day 0 = nothing) instead of the earlier „per started day“ (min. 1 day) — which one?
- Wertersatz on `paid − sticker` (not on the full price) — correct basis under § 357a Abs. 2 BGB?
- The sticker never has to be returned. Withdrawal before personalisation: no deduction, the
  fulfillment order is cancelled, nothing is shipped.
- Existing customers: stickers printed before this change have no `personalized_at` → no deduction;
  their contracts are not changed (old `sticker_value_cents` = 0).

## 13. Contract confirmation redesign (2026-11-23)

The e-mail and the PDF „Vertragsbestätigung“ were redesigned (`billing/contract-confirmation.ts`,
`mail/templates.ts`). Content that changed or needs a decision:

1. **Model withdrawal form.** Art. 246a § 1 Abs. 2 S. 1 Nr. 1 EGBGB requires the form, and the
   confirmation on a durable medium (§ 312f Abs. 2 BGB) must carry the Art. 246a information; the
   app's „Vertrag widerrufen“ button does not replace it. The PDF now prints the **complete statutory
   wording** (Anlage 2 EGBGB) with our address and the contract number at the end of appendix B, right
   after the Widerrufsbelehrung that refers to it („unten stehende“). The website's `/widerruf` page and
   `packages/shared` still show a **shortened** form (no intro line, no „erhalten am“, no signature line,
   no „(*) Unzutreffendes streichen“): please confirm the full form there too (that changes a legal
   text and its version).
2. **Summaries.** Page 1 (term, cancellation, withdrawal in short) and page 2 („Rechtliche
   Informationen“: term, cancellation, right of withdrawal incl. the sticker exclusion, payment
   provider, contract texts) are additions; the AGB and the Widerrufsbelehrung follow word for word as
   appendices A and B. Please check the summaries for anything that could be read as deviating.
3. **Customer name and address** are now printed in the PDF (from the encrypted profile) and so pass
   through the e-mail provider (Mailjet, EU) as an attachment. Privacy policy wording?
4. **Price in the AGB** (§ 3) says 20 € per year; App Store purchases cost 19,99 € (no 20,00 € price
   point). The confirmation shows the price actually charged; the AGB text needs a sentence for store
   prices.
5. **Dates.** Contract start = first purchase (`original_purchase_at`); renewal / contract end = end of
   the current period as Stripe, Apple or Google report it (never computed). Store sandbox periods last
   minutes or hours, so the dates then carry the time.
6. **Stripe price** on the confirmation is the price setting at the time of sending (with a promo
   code); it is not read back from the Stripe invoice. A resend after a price change would show the new
   price.

## 14. New decal code: free once a year, 3 € with the printed sticker, 10-day wait (2026-11-24)

Owner decision 2026-11-24 (`docs/handover.md` §14). „Sperren“ stays free. After a „Sperren“ the
customer gets one new code free per subscription year; any further new code is sold together with a
printed and shipped sticker for 3 € incl. VAT (`prices.print_shipped_cents`), paid through Stripe only
(never in-app purchase, because it is a physical product). At most one new code per vehicle every 10
days (`codes.reissue_cooldown_days`); support can make an exception (e.g. theft).

1. **Withdrawal for the bundle.** The 3 € buys a digital service (the new code, usable at once) and a
   sticker personalised with the design and the vehicle label (§ 312g Abs. 2 Nr. 1 BGB, as for the 3 €
   print, §12). Is the whole bundle excluded from withdrawal, or does the code part need the § 356
   Abs. 5 BGB consent (immediate start, loss of the right) before payment? The app will show the
   personalisation notice of the 3 € print before the payment page; a § 356 Abs. 5 checkbox can be
   added if needed. TODO [LEGAL REVIEW]
2. **Refund keeps the code.** A refund of the 3 € (Stripe dashboard or ops) never revokes the new code,
   so the car stays protected; the refund is recorded and audited. Any objection?
3. **AGB / price list.** The AGB should name the rule: one free new code per contract year after
   „Sperren“, otherwise 3 € with a printed sticker, at most one new code every 10 days per vehicle.
   TODO [LEGAL REVIEW]
4. **Cooldown and the free code count from the first code** (owner confirmed 2026-11-24: the first
   code is issued at once, the 10 days for later codes count from it). A customer who locks the code within
   the first 10 days waits until day 10 (or asks support for the exception). Consumer-law concern
   about a paid service that cannot be used for up to 10 days after a theft?

## 15. Lifetime plan (2026-11-26)

The plan can also be bought once for 29,99 € (no renewal). Please check:

1. **„Lifetime“ / „dauerhaft“ / „für immer“:** our definition is „as long as ParkShield offers the
   service“ (contract confirmation PDF). Does the AGB need a clause on what happens if the service ends
   (notice period, partial refund)?
2. **Withdrawal (§ 357a Abs. 2 BGB):** Wertersatz is computed per used day against one contract year
   (365 days) of the 29,99 € minus the sticker value. Is that a fair value for a service without a term?
3. **Advertising claims (UWG):** „Nur 10 € mehr – dafür für immer“, „Ab dem 2. Jahr günstiger“, „in
   5 Jahren 69,96 € gespart“ (compared with five yearly payments at today's price). Acceptable?
4. **Vehicle change:** the lifetime plan is for one vehicle; our assumption is that the owner may move
   it to a new car (new code / sticker as usual). Needs a sentence in the AGB.
