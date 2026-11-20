# Legal review: texts and rules marked `TODO [LEGAL REVIEW]`

Nothing here is final. Every text is a draft for the IT-law firm. Short legal texts live versioned in
the table `legal_texts` (change = new version, no deploy); the legal pages are in
`packages/shared/src/legal-content.ts`.

## 1. Renewal for consumers (§ 309 Nr. 9 BGB) — decide first

- Setting `renewal.mode_b2c`: `monthly_after_first_term` (default, chosen 2026-11-17) or `annual`.
  `annual` (renews by 12 months, no refund of a running period) is likely invalid for consumers in AGB.
- After the first 12 months the contract continues monthly at annual price / 12
  (`STRIPE_PRICE_*_MONTHLY`). Each contract keeps the mode it was concluded under (`subscriptions.renewal_mode`).
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
setting `photos.plans` (default Premium). **Go-live blocker:** everything in this section, and the
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
  photo is sent to Twilio, Meta, the e-mail provider or a push service; they only carry the link.
- Deleted automatically **30 days** after the alert (file, key, link), or **at once** when the owner
  taps „Missbrauch melden“ (view page, portal history, e-mail link). The report also deletes the alert
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
  the images to Twilio, Meta or the e-mail provider.
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
