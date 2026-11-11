# 04 — Legal Framework, Privacy and Compliance

> This is a technical and organisational action plan, **not legal advice**. Every item is reviewed with a German lawyer specialised in IT law (IT-Recht) and with the data protection officer during Phase 0, before code is written.

## 1. Applicable law and what it requires

| Law | Requirement | Implementation |
|---|---|---|
| DSGVO / GDPR | Legal basis for every processing, data minimisation, data-subject rights, processor agreements, DPIA, record of processing | §4 and §5 below; DPIA and VVT in Phase 0 |
| BDSG | DPO required at ≥ 20 people regularly processing data; early appointment optional but recommended for a privacy product | External DPO (~€250/month) |
| §25 TDDDG | Reading/storing anything on the user's device needs consent unless strictly necessary | No tracking cookies, no fingerprinting. Status token in `sessionStorage` only. Cookieless analytics (Plausible) |
| §5 DDG | Impressum | Footer of every page, including the scanner page |
| §312k BGB | "Verträge hier kündigen" button with confirmation page | Always available in the portal and footer, even without login (e-mail + contract number) |
| §309 Nr. 9 BGB | After the initial term, consumer contracts renew for an indefinite period and can be cancelled with one month's notice | Annual plan renews. After year one, cancellable any time with one month's notice and pro-rata refund (computed by AD-12) |
| §§355–357a BGB | 14-day right of withdrawal; if the customer asks for immediate start, they pay for days used (Wertersatz) | "I request immediate start" checkbox at checkout. Custom-printed decal excluded (§312g Abs. 2 Nr. 1). *New:* final wording and calculation method set by the lawyer in Phase 0. This is not a free trial |
| PAngV | Consumer prices including VAT | "10 € / Jahr inkl. 19 % MwSt." |
| §7 UWG | No marketing without explicit consent | Alerts and periodic summaries are service messages. Marketing needs separate double opt-in |
| BFSG (since 28 Jun 2025) | Accessibility for consumer e-commerce services (micro-enterprises exempt; we comply anyway) | WCAG 2.2 AA and Barrierefreiheitserklärung |
| VerpackG | LUCID registration for shipped packaging | Registration and dual-system contract before first shipment |
| MarkenG / EUTMR | Name protection | DPMA + EUIPO, classes 9, 38, 42, in Phase 0 |
| UStG / OSS *(new)* | VAT of the consumer's country for EU sales above the threshold | Register for One-Stop-Shop before the Austria launch; Stripe Tax computes rates by country |

## 2. Scanner anonymity

- No account, number, e-mail or cookies.
- IP addresses truncated immediately (/24 IPv4, /48 IPv6). The full address is never stored in any log; the reverse proxy is configured accordingly.
- Pseudonymous `scanner_ref` used only for rate limiting, abuse patterns and same-day blocks; changes daily and is deleted after 24 h.
- *New:* per-vehicle `block_ref`, used only so an owner's abuse report can block that scanner for that one vehicle for 30 days. It cannot link a scanner across vehicles and is deleted after 30 days.
- *New:* scanner country (two-letter code) derived from IP only to show the right emergency numbers; deleted after 24 h. No city, no coordinates.
- The owner sees nothing about the scanner except time, alert type and text (if written).

## 3. Consent-based third parties

### 3.1 Emergency contact

1. The owner enters the contact's name and channel (WhatsApp or e-mail).
2. The contact receives: "Jonas möchte Sie als Notfallkontakt für ParkShield hinterlegen", with confirm and decline links and a short explanation of what data they will receive.
3. Not used before confirmation. Decline or no answer within 14 days deletes the data automatically.
4. Every escalation message contains a "stop sending me alerts" link.

### 3.2 Co-driver *(new, Premium)*

The co-driver needs their own account (no subscription) and must explicitly accept the invitation. They choose their own channels; the owner never sees the co-driver's numbers. They can leave any time, and the owner can remove them. Unaccepted invitations are deleted after 14 days.

## 4. Legal bases

| Processing | Data | Basis |
|---|---|---|
| Providing the service to the owner | E-mail, channels, vehicle, alerts | Art. 6(1)(b) — contract |
| Receiving a scanner alert | Alert type, free text, scanner country | Art. 6(1)(f) — legitimate interest |
| Abuse protection | `scanner_ref`, `block_ref`, truncated IP | Art. 6(1)(f) |
| WhatsApp and SMS | Phone number | Art. 6(1)(a) — consent (opt-in) |
| Emergency contact and co-driver | Name and channel | Art. 6(1)(a), from the person themselves |
| Billing and invoice retention | Name, address, invoices | Art. 6(1)(c) — §147 AO / §257 HGB |
| Staff decryption *(new)* | Requested field only | Art. 6(1)(b) or (f) depending on the case, logged and notified |
| Business waitlist *(new)* | Company name, e-mail, fleet size | Art. 6(1)(a) with double opt-in |
| Newsletter | E-mail | Art. 6(1)(a) + DOI |

## 5. Retention schedule

| Data | Retention | Deletion mechanism |
|---|---|---|
| `scanner_ref` and scanner country | 24 h | `run_retention()` hourly; Valkey keys expire via TTL |
| `block_ref` (per vehicle) and scanner blocks | 30 days | `run_retention` |
| Free text, chat, blocked messages | 7 days | `run_retention` |
| Moderation review records (no text) | 30 days | `run_retention` |
| Alerts and delivery records | 90 days | `run_retention` (cascading delete) |
| Scanner photos (Phase 2) | 30 days unless saved by the owner | Object Storage lifecycle policy |
| Parking location (Phase 2) | 24 h after session end | `run_retention` |
| Shipping address | 90 days after delivery | `run_retention` (invoices kept in accounting) |
| Unaccepted invitations | 14 days | `run_retention` |
| Sign-ups that never verified their e-mail | 24 h | `run_retention` |
| Temporary modes / transfer requests | 1 day after end / 90 days | `run_retention` |
| Unconfirmed Business waitlist entries | 30 days | `run_retention` |
| Provider health events | 90 days | `run_retention` |
| Invoices and credit notes | 8 years (§147 AO, §14b UStG; reduced from 10 years from 2025 by the Bürokratieentlastungsgesetz IV — confirm with the Steuerberater) | Stripe + accounting system (lexoffice or DATEV) |
| Audit log | 12 months | `run_retention`; locked copy with 12-month expiry policy |
| Server logs | 14 days, no full IP | Loki retention setting |
| Backups | 35 days | pgBackRest retention. Deleted data disappears from backups within 35 days at most; stated in the privacy policy |
| Account after deletion request | 24 h grace period | Hard delete after all processor steps complete; all codes revoked immediately |

## 6. Processors, agreements and erasure steps

| Processor | Role | Location | Erasure step on GDPR request *(new)* |
|---|---|---|---|
| Hetzner Online | Hosting, backups | Germany | Automatic via DB; backups expire within 35 days. AVV from the console |
| Brevo | Transactional e-mail | France / EU | API: delete contact and logs. AVV |
| 360dialog | WhatsApp BSP | Berlin (Meta transfer to US under EU-US DPF; disclosed in privacy policy with opt-in) | Deletion request via API/support; keep the request reference |
| Stripe | Payments, subscriptions | Ireland | API: delete customer; legally required invoice data retained. AVV + SCCs |
| Zammad | Tickets | Self-hosted | API: delete user and tickets |
| Print partner (e.g. Flyeralarm, WIRmachenDRUCK, local printer) | Printing and shipping | Germany | Address deletion request via e-mail/SFTP with confirmation. AVV (receives shipping address) |
| Sentry | Error tracking | EU (Frankfurt) | Usually not applicable (PII scrubbing); recorded as `not_applicable` with reason |
| Friendly Captcha | Captcha | Germany | No personal data linked to the user |
| seven.io / Twilio | SMS and masked calls (Phase 2) | Germany / US (DPF) | Via API depending on chosen vendor; technical spike in Phase 2 |
| Mistral | Support assistant (Phase 2) | France | No personal data in requests |

## 7. Identity verification for GDPR requests *(new)*

Exporting someone's data to an impostor is a real breach. Rules:

- Requests from inside the portal require fresh re-authentication (passkey or new magic link).
- E-mail requests from outside the portal require confirmation via a link sent to the registered address.
- Other cases (e.g. lost access to the e-mail account) are handled manually with admin approval.
- The method is recorded in `data_subject_requests.verification_method`.

## 8. Phase 0 compliance deliverables

- DPIA workshop with the DPO; retention schedule and consent design agreed.
- Staff permission model and break-glass design agreed (new).
- VVT (record of processing) and TOMs documented.
- AGB, privacy policy, withdrawal wording incl. Wertersatz, processor agreements signed.
- Trademark filed; LUCID registered.
- Incident response plan (72-hour notification to the supervisory authority, Art. 33).
