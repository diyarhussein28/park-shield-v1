# 03 — User Stories (MVP) and Sprint Plan

Stories are listed in actual build order; each depends on the ones before it. Points use the Fibonacci scale. Expected velocity: 24–30 points per two-week sprint. **Total: 255 points in 10 sprints, plus 13 points of hardening = 268.**

## 1. Stories

### E0 — Technical foundation

| # | Story | Acceptance criteria | Pts | Sprint |
|---|---|---|---|---|
| US-01 | As a developer, I want a local environment and CI/CD that deploys to staging safely | Whole environment starts with one command. CI runs lint, typecheck, tests, E2E and **schema migrations on PostgreSQL 18**. Merge to `main` deploys to staging. | 8 | 1 |
| US-02 | As an operator, I want Hetzner infrastructure as code with monitoring and backups | Terraform builds the environment from scratch. Alert on downtime. Documented successful restore drill. Object Lock bucket for the audit stream. | 8 | 1 |
| US-03 | As a developer, I want a German/English design system | Base components with AA contrast. ICU message files. Language switch without reload. | 5 | 1 |

### E1 — Account and subscription

| # | Story | Acceptance criteria | Pts | Sprint |
|---|---|---|---|---|
| US-04 *(changed)* | As a visitor, I want a landing page explaining the service, prices and legal pages | Impressum, Datenschutz, AGB, Widerruf, Barrierefreiheit. Plus €10 and Premium €15 incl. VAT; Business "Bald verfügbar" with waitlist form (double opt-in). Lighthouse ≥ 90. | 5 | 2 |
| US-05 | As a new customer, I want to sign up with my e-mail and no password | Link valid 15 min, single use, used up only by tapping "Anmelden" (safe against mail scanners opening it). Offer to add a passkey after login. E-mail on new-device login. | 8 | 2 |
| US-06 *(changed)* | As a customer, I want to pay for Plus annually | Stripe Checkout (card, SEPA, PayPal, Apple Pay). Annual only. Promo-code field. "Immediate start" checkbox and withdrawal notice. PDF invoice. No feature access before successful payment. | 8 | 2 |
| US-07 | As a customer, I want to cancel easily | "Verträge hier kündigen" always visible. Confirmation page. Confirmation e-mail with end date. Also works without login. | 5 | 2 |
| US-08 | As the system, I want subscription state synced from Stripe | Signed, idempotent webhooks. On failed payment: `past_due`, 3 retries, reminder. On expiry: decal becomes inactive. | 5 | 3 |

### E2 — Vehicles and decals

| # | Story | Acceptance criteria | Pts | Sprint |
|---|---|---|---|---|
| US-09 | As an owner, I want to add a vehicle with a nickname and plate | Plate encrypted, never shown to scanners. Count per plan, with upgrade prompt at the limit. | 3 | 3 |
| US-10 | As an owner, I want to design and preview my decal | 6 templates, CTA header, live SVG preview, print-ready PDF (CMYK, 3 mm bleed). Decal carries the line "ParkShield verlangt nie eine Zahlung" and the domain `pkshd.de` printed next to the QR code (SC-15). | 8 | 3 |
| US-11 *(changed)* | As an owner, I want to order my included decal and track it | One included decal at first subscription only. Shipping address encrypted. Order sent to printer automatically (API or daily SFTP). Tracking number by e-mail. Instant PDF. | 8 | 3 |
| US-12 | As an owner, I want to activate my decal by test-scanning it | In the portal I tap "Aufkleber testen", which opens a 10-minute test window for that code (`qr_tokens.test_window_until`; server-side, so the cookie-free scanner page on `pkshd.de` needs no login). The next scan in the window shows "Testmodus", sends a test alert on all channels, activates the code and updates `last_test_at`. Scans outside the window behave normally. | 3 | 4 |
| US-13 | As an owner, I want to revoke a leaked code and get a replacement | Immediate revocation; old code shows "inactive". Replacement €5.90 or free PDF. | 3 | 4 |

### E3 — Scanner

| # | Story | Acceptance criteria | Pts | Sprint |
|---|---|---|---|---|
| US-14 | As a scanner, I want the page in my language and to send an alert with one tap | Load < 1.5 s. 7 large buttons. Invisible captcha. No cookies. Visual confirmation after sending. | 8 | 4 |
| US-15 | As a scanner, I want to write a short message | Max 280 chars. Clear rejection message for insults, links, numbers. Rejected messages are never sent and enter the review sample. | 5 | 4 |
| US-16 | As a scanner, I want to see my alert's status until the owner responds | Gesendet, Zugestellt, Bestätigt (with time and quick reply), Eskaliert, Abgelaufen. Update within 3 s. Survives page reload in the same session. | 5 | 4 |
| US-17 | As the system, I want to prevent flooding and abuse | 3 rate limits tested (unit + E2E). 429 with wait time in a friendly message. No full IP stored. | 5 | 5 |
| US-18 *(new)* | As a scanner, I want guidance after expiry and a "still waiting" button | Country-specific guidance (DE, AT, NL, BE, CH, FR, IT, PL; others default to 112). Button after 15 min, usable once. Owner gets one reminder; escalation 5 min later where it applies (SC-14). | 5 | 5 |
| US-19 *(new)* | As a scanner, I want to know the decal is genuine | Domain, nickname and colour visible; fixed sentence; report link reaches the abuse centre. | 2 | 5 |

### E4 — Notifications, acknowledgement and escalation

| # | Story | Acceptance criteria | Pts | Sprint |
|---|---|---|---|---|
| US-20 *(changed)* | As an owner, I want Web Push on my devices | iOS 16.4+ (PWA added to home screen), Android, desktop. Interactive iOS guide. Device list and removal. Platform recorded for the iOS KPI. | 8 | 5 |
| US-21 | As an owner, I want to link WhatsApp | OTP via WhatsApp. Opt-in recorded in `consents`. Test alert. Unlink with one tap. | 8 | 5 |
| US-22 *(changed)* | As an owner, I want alerts on the right channel | Priority order. Urgent on all channels. Every attempt recorded with status and cost. Fallback on failure. **Respects kill switches and limits from settings.** | 13 | 6 |
| US-23 *(changed)* | As an owner, I want "Ich komme" and quick replies | Three buttons in Push, WhatsApp and e-mail. Second use shows "already answered". Scanner sees the reply within 3 s. "Not nearby" escalates immediately where escalation applies; otherwise the scanner sees "Fahrer ist nicht in der Nähe" and guidance (NT-10). | 8 | 6 |
| US-24 | As an owner, I want to add an emergency contact | Invitation with accept/decline. Pending status visible. Auto-delete after 14 days without reply. | 5 | 6 |
| US-25 | As the system, I want to escalate when the owner doesn't respond | Escalation at deadline ±60 s, only for escalating types with a confirmed contact. None after "Ich komme"; "In ca. 30 Min" postpones it by 30 min; "Ich warte noch" escalates 5 min after the reminder. Late replies after escalation still reach the scanner. No double escalation. Works after a Valkey restart (chaos test, added to the monthly drill). | 8 | 7 |
| US-26 *(changed)* | As an owner, I want quiet hours and temporary modes | Per weekday. Urgent bypasses by default. "Sensitive spot" and "short stop" up to 12 h. Muted alerts appear in the history. | 5 | 7 |
| US-27 *(changed)* | As the system, I want fair-use limits enforced | Monthly counter per channel. 80% warning e-mail. 100% falls back to Push and e-mail. Limits read from `app_settings`. | 3 | 7 |

### E5 — Activation and retention *(new)*

| # | Story | Acceptance criteria | Pts | Sprint |
|---|---|---|---|---|
| US-28 | As an owner, I want a protection score and setup checklist | 4 steps as a percentage (OW-14), starting at 25% after e-mail verification. "Protection incomplete" badge. Computed from data, not a stored column. | 5 | 7 |
| US-29 | As an owner, I want activation and decal-health reminders | At 3, 7 and 14 days after delivery (max 3). Reminder after 11 months without a scan. | 3 | 7 |
| US-30 | As an owner, I want a periodic summary | Monthly by default, weekly, or off. Service message. | 3 | 7 |

### E6 — History and privacy

| # | Story | Acceptance criteria | Pts | Sprint |
|---|---|---|---|---|
| US-31 *(changed)* | As an owner, I want my alert history, abuse reporting and an "I didn't get the alert" page | Last 90 days. Report blocks the ref for 30 days and sends it to the abuse centre. Self-service page explains delivery failures (SP-05). | 5 | 8 |
| US-32 *(changed)* | As an owner, I want to download my data and delete my account | JSON + PDF within minutes. Re-authentication before export. Deletion after 24 h and after automated processor steps complete. Codes revoked immediately. Confirmation e-mail. | 8 | 8 |
| US-33 | As the system, I want the retention schedule applied automatically | `run_retention()` hourly, with a test per retention rule. | 3 | 8 |

### E7 — Ops app *(rebuilt)*

| # | Story | Acceptance criteria | Pts | Sprint |
|---|---|---|---|---|
| US-34 *(new)* | As ops, I want a separate app with fine-grained permissions | Separate deploy behind VPN for both the ops frontend and `api-ops`; a test confirms `/ops/*` returns 404 through the public LB. Passkey, 30-min session, permission check on every API endpoint, CI test that fails if an endpoint has no permission. | 8 | 8 |
| US-35 *(new)* | As support, I want Customer 360 and the delivery trace | All of AD-03 and AD-04, masked data, every view logged as a read event. | 8 | 9 |
| US-36 *(new)* | As ops, I want four-eyes break-glass decryption | Reason + ticket number, different approver, 15 min, customer notified, audit-logged. | 5 | 9 |
| US-37 *(new)* | As an admin, I want GDPR queues with identity verification and processor steps | 30-day deadline, alert 7 days before, identity check, one step per processor, cannot close until all are done. | 8 | 9 |
| US-38 *(new)* | As a moderator, I want the abuse centre with patterns and block review | Reports, blocks, pattern alerts, revoke on owner's behalf, review sample, word lists. | 8 | 9 |
| US-39 *(new)* | As fulfillment, I want orders, batches and partners | Order pipeline, returns, reprints, batches linked to partner and promo code. | 5 | 10 |
| US-40 *(new)* | As finance, I want withdrawal/refund handling and promo codes | Automatic calculation, Stripe refund, credit note. Promo codes with price lock. | 5 | 10 |
| US-41 *(new)* | As an admin, I want settings, kill switches and provider health | Change applies within 60 s, every change logged, provider health screen with alerts. | 5 | 10 |
| US-42 *(new)* | As the company, I want an unerasable audit log | Read events, append-only constraint, live copy to locked bucket. | 3 | 10 |
| US-43 *(new)* | As a founder, I want Metabase metrics and the activation funnel | All AD-18 metrics; read-only role cannot see encrypted columns. | 5 | 10 |
| US-44 *(changed)* | As a customer, I want a help centre and contact form | 20 articles DE/EN. Form opens a Zammad ticket. Sidebar widget shows customer summary. Reply within 48 h on Plus. | 3 | 10 |
| US-45 | As the team, I want a safe launch | Pentest with no open critical/high findings, load test 200 alerts/s, WCAG audit, runbooks, status page, permission review. | 13 | H |
| | **Total** | | **268** | 10 + H |

## 2. Sprint plan (Phase 1, 2027)

| Sprint | Dates | Stories | Pts | Demo goal |
|---|---|---|---|---|
| S1 | 1–12 Feb | US-01 – US-03 | 21 | Empty app on staging with monitoring and backups; schema tested in CI |
| S2 | 15–26 Feb | US-04 – US-07 | 26 | Visitor sees new prices, signs up, pays €10 in Stripe sandbox with a promo code, cancels |
| S3 | 1–12 Mar | US-08 – US-11 | 24 | Adds a car, designs a decal, orders it; order reaches the printer (sandbox) |
| S4 | 15–26 Mar | US-12 – US-16 | 24 | Scanner sends an alert from a real phone; filter works |
| S5 | 29 Mar – 9 Apr | US-17 – US-21 | 28 | Push and WhatsApp arrive; trust cues and post-expiry guidance |
| S6 | 12–23 Apr | US-22 – US-24 | 26 | Channel routing, quick replies, emergency contact |
| S7 | 26 Apr – 7 May | US-25 – US-30 | 27 | End-to-end escalation with Valkey stopped; protection score and reminders |
| S8 | 10–21 May | US-31 – US-34 | 24 | History, export, deletion; separate ops app |
| S9 | 24 May – 4 Jun | US-35 – US-38 | 29 | Customer 360, break-glass, GDPR requests, abuse centre |
| S10 | 7–18 Jun | US-39 – US-44 | 26 | Orders, refunds, settings, provider health, audit, metrics |
| Hardening | 21 Jun – 2 Jul | US-45 | 13 | Pentest + fixes, load test, WCAG audit, runbooks |
| Paid beta | 5–30 Jul | — | — | Fixes only. 300 founding members in Cologne and Berlin, including two residential complexes via property managers |
| Launch | Tue 3 Aug 2027 | — | — | Public Plus launch in Germany |

## 3. Later phases (summary)

**Phase 2 — Premium (Aug–Nov 2027, launch 9 Nov 2027)**
- Co-drivers and vehicle transfer
- Anonymous chat, SMS fallback, masked calls
- Multi-level escalation up to 3 contacts
- Light Capacitor app
- Parking assistant, Wallet passes, NFC decals
- Scanner photo with blurring
- AI support assistant and WhatsApp support
- EU abuse classifier; service broadcasts
- Plus → Premium upgrade with proration

**Business — coming soon (only after gate G3)**
- Organisations, roles, duty schedules
- B2B billing (VAT ID, invoice, SEPA)
- API, webhooks, CSV reports
- Partner portal
- Before building: manual concierge pilot for 3–5 companies from the waitlist, using Premium accounts and manual invoices

## 4. Definition of Done

- Small PR reviewed by someone else; CI green (lint, typecheck, unit, E2E for affected paths, schema migrations).
- ≥ 80% coverage for core modules: scan, alerts, escalation, billing, gdpr, **ops/permissions**.
- E2E for critical paths: purchase, activation, scan, quick replies, escalation, cancellation, account deletion, **break-glass, refund**.
- Every ops API endpoint checks a specific permission; a CI test fails if any endpoint lacks one.
- All strings in German and English; axe audit clean; dark mode supported.
- Backward-compatible migrations (add first, remove in a later release).
- No personal data in logs. New monitoring added if the feature needs it.
- Deployed to staging and accepted by the product owner.

## 5. Ways of working

- Scrum, 2-week sprints: planning Monday (2 h), 15-min daily, demo on staging second Friday, 45-min retro, backlog refinement mid-sprint.
- Tools: Linear or Jira, GitHub (PRs, Actions), Figma, Slack, `/docs` for ADRs.
- Contract: time & material with a cap per phase, paid per sprint after the demo. Repository in the company's GitHub account from day one; full transfer of usage rights. AVV with the agency. Only the tech lead has production access; no external team member can approve break-glass requests. Definition of Done attached to the contract. Knowledge-transfer clause with 30 days' notice.
