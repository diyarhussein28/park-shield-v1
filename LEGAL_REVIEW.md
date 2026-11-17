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
- Notifications (push, WhatsApp, SMS, e-mail) carry no free text of an unconfirmed sender, only
  "Nachricht von nicht bestätigtem Absender – ansehen in ParkShield".
