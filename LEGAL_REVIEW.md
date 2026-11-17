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
