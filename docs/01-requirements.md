# 01 — Requirements

Every requirement has an ID, a MoSCoW priority and the phase in which it is delivered. The MVP contains every **Must** in **Phase 1**. "New" / "Changed" mark differences from V2.

## 1. Scanner app (PWA) — no install, no account

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| SC-01 | Decal URL format `https://pkshd.de/s/K7QX4M2R9T`; code is 10 chars Crockford Base32 (50 bits random). Only its SHA-256 is stored. | Must | 1 |
| SC-02 | Language from `Accept-Language`: German by default, DE/EN toggle. Translations extensible (TR, AR, PL, FR, NL). | Must | 1 |
| SC-03 | Seven alert types with large buttons: Ausfahrt versperrt, Licht an, Fenster offen, Schaden, Alarm, Abschleppen droht, Eigene Nachricht. | Must | 1 |
| SC-04 | Free-text message up to 280 chars, filtered for insults, threats, links, phone numbers and e-mail addresses. | Must | 1 |
| SC-05 | Invisible Friendly Captcha (proof of work) before sending; no cookies. | Must | 1 |
| SC-06 | Live status: Gesendet → Zugestellt → Bestätigt / Eskaliert / Abgelaufen. Polled every 3 s (or SSE) for up to 2 h. *Changed:* also shows the owner's quick reply (e.g. "in ca. 30 Min"). | Must | 1 |
| SC-07 | "Decal inactive" page when the subscription ended or the code was revoked. Reveals nothing. | Must | 1 |
| SC-08 | Legal guidance for "Abschleppen droht" and emergencies (110/112). | Should | 1 |
| SC-09 | Two-way anonymous chat after an alert (Premium). Messages filtered; deleted after 7 days. | Should | 2 |
| SC-10 | Masked call for urgent cases (Premium). | Could | 2 |
| SC-11 | NFC: same URL on an NTAG215 chip inside the decal. | Could | 2 |
| SC-12 | WCAG 2.2 AA: contrast, screen reader, touch targets ≥ 48 px, load < 1.5 s on 4G. | Must | 1 |
| SC-13 *(new)* | Guidance after expiry or unresolved escalation: link to find the local Ordnungsamt, and emergency numbers by the **scanner's country** (from IP at country precision only, deleted after 24 h), not by browser language. | Must | 1 |
| SC-14 *(new)* | "Ich warte noch" button appears 15 min after acknowledgement (configurable), usable once. Sends one reminder to the owner (NT-09). If the alert type escalates and a confirmed emergency contact exists, the alert escalates 5 min later (configurable) unless the owner replies to the reminder. | Must | 1 |
| SC-15 *(new)* | Anti-quishing trust cues. A fake QR never leads to our page, so the main cue is on the decal: the domain `pkshd.de` is printed next to the QR code, and the help pages tell scanners to check that the camera's link preview shows `pkshd.de`. On the page: the domain, vehicle nickname and colour for matching, the fixed sentence "ParkShield verlangt nie eine Zahlung" (same wording on page and decal), and a "Aufkleber sieht verdächtig aus" report link. | Must | 1 |
| SC-16 *(new)* | If the owner set "short stop", the page shows above the buttons: "Fahrer ist gegen 14:30 zurück". Sending stays available. | Should | 1 |
| SC-17 *(new)* | Optional photo from scanner with server-side automatic blurring of faces and plates; deleted after 30 days unless the owner saves it (damage/towing cases). | Should | 2 |

**Alert types** (seeded in `alert_types`; activation, severity and escalation are editable in ops, AD-14):

| Type | Severity | Escalates |
|---|---|---|
| Ausfahrt versperrt | urgent | yes |
| Licht an | normal | no |
| Fenster offen | normal | yes |
| Schaden | urgent | yes |
| Alarm | normal | no |
| Abschleppen droht | urgent | yes |
| Eigene Nachricht | normal | no |

Urgent alerts go to all enabled channels at once and bypass quiet hours by default (NT-01, OW-06). "Escalates" means the alert can reach the emergency contact (NT-03).

## 2. Owner portal

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| OW-01 | Passwordless login: magic link (valid 15 min, single use), passkeys (WebAuthn) as preferred option. The link opens a page with a "Anmelden" button and the token is used up only by that tap (POST), never by opening the link, because e-mail security scanners open links automatically. | Must | 1 |
| OW-02 | Vehicle management: nickname, plate (encrypted), make/model, colour. Count limited by plan. | Must | 1 |
| OW-03 | Decal designer: live preview, CTA header (suggestions or filtered free text), 6 templates; A6 dashboard card or 8×8 cm UV-resistant vinyl sticker. | Must | 1 |
| OW-04 *(changed)* | Decal orders: **one decal included at first subscription only**. Extra and replacement decals are paid. Home-print PDF free at any time. Shipment tracking. | Must | 1 |
| OW-05 | Notification channels: Web Push (multiple devices), e-mail, WhatsApp (after OTP + opt-in). Priority order editable. | Must | 1 |
| OW-06 | Quiet hours per weekday; urgent alerts bypass by default (can be disabled). | Must | 1 |
| OW-07 | Emergency contacts: 1 on Plus, 3 on Premium; mandatory consent by the contact; escalation delay 3–30 min (default 7). | Must | 1 |
| OW-08 | Alert history for 90 days with "report abuse" button that blocks that scanner for this vehicle for 30 days (via the per-vehicle `block_ref`, `02-architecture.md` §5). Reports on alerts older than 30 days go to the abuse centre only. | Must | 1 |
| OW-09 | "Send test alert" button that runs the full delivery path. "Aufkleber testen" opens a 10-min test window so the next real scan of the decal is a test that also activates it (US-12). | Must | 1 |
| OW-10 | Revoke a code and issue a new one (leaked decal photo, car sold). | Must | 1 |
| OW-11 *(changed)* | Billing: **annual only**, PDF invoices, change payment method, "Verträge hier kündigen" always visible. Upgrade to Premium follows with Premium (OW-22). | Must | 1 |
| OW-12 | Privacy: download all data (PDF + JSON), delete account (24 h grace), manage consents. | Must | 1 |
| OW-13 | Apple Wallet / Google Wallet pass showing the QR code. | Could | 2 |
| OW-14 *(new)* | Protection score + setup checklist, 4 steps of 25% each: (1) e-mail verified (done at sign-up, so the score starts at 25%); (2) a second working channel: Push on at least one device or WhatsApp (on iOS, Push counts only when installed via the home screen); (3) emergency contact confirmed; (4) decal applied and tested. "Protection incomplete" badge until 100%. | Must | 1 |
| OW-15 *(new)* | Activation reminders 3, 7 and 14 days after delivery if the decal was not tested (max 3). "Decal health" reminder if not scanned for 11 months: suggest a test scan to check it hasn't faded. | Must | 1 |
| OW-16 *(new)* | Quick replies in every notification: "Ich komme", "In ca. 30 Min", "Bin nicht in der Nähe" (escalates immediately where escalation applies, NT-10). | Must | 1 |
| OW-17 *(new)* | Temporary modes up to 12 h: "sensitive spot" (urgent only) and "short stop" (return time shown to scanners). | Should | 1 |
| OW-18 *(new)* | Periodic summary e-mail (monthly by default, weekly, or off): number of alerts, decal status, protection score. Service message, not marketing. | Should | 1 |
| OW-19 *(new)* | Co-drivers (Premium, up to 3): e-mail invitation, explicit acceptance, each sets their own channels, can leave any time. | Should | 2 |
| OW-20 *(new)* | Vehicle transfer to a new owner on sale: transfer link valid 14 days; new owner needs their own subscription; old code revoked; alert history not transferred. | Should | 2 |
| OW-21 *(new)* | Light native app (Capacitor) for iOS and Android giving reliable push without "add to home screen". Same UI, no extra features. | Should | 2 |
| OW-22 *(new)* | Upgrade Plus → Premium with proration (moved out of OW-11, since Premium only exists from Phase 2). | Must | 2 |

## 3. Notification, acknowledgement and escalation engine

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| NT-01 | Channels from cheapest to most expensive: Push → e-mail → WhatsApp → SMS. Normal alerts stop at the first success; urgent alerts go to all enabled channels at once. | Must | 1 |
| NT-02 | Every notification carries a single-use acknowledgement link (256 bits, valid 2 h). In WhatsApp as Quick-Reply buttons. Links open a page with the reply buttons; a reply is recorded only on a tap (POST), never by opening the link, so mail scanners that open links cannot acknowledge an alert and cancel its escalation. | Must | 1 |
| NT-03 | Escalation only for alert types marked "escalates" (§1: Ausfahrt versperrt, Fenster offen, Schaden, Abschleppen droht), only if a confirmed emergency contact exists, and at most once per alert. | Must | 1 |
| NT-04 | Track every message status (queued/sent/delivered/read/failed/suppressed) and cost in EUR via provider webhooks. | Must | 1 |
| NT-05 | Monthly fair-use limits per plan. When exceeded, fall back to free Push and e-mail and notify the owner. | Must | 1 |
| NT-06 | Push subscription removed after HTTP 410 or 5 consecutive errors; owner notified by e-mail to re-enable. | Must | 1 |
| NT-07 | SMS as fallback (Premium). | Should | 2 |
| NT-08 | Route to on-duty driver by schedule (Business). | Coming soon | after G3 |
| NT-09 *(new)* | Follow-up after acknowledgement: on "Ich warte noch", send one reminder to the owner on the fastest channel, with fresh reply buttons. Never repeated. Escalation afterwards as in SC-14. | Must | 1 |
| NT-10 *(new)* | Quick-reply handling: "In ca. 30 Min" postpones escalation by 30 min and shows that to the scanner; "Bin nicht in der Nähe" escalates immediately if escalation applies (NT-03), otherwise the scanner sees "Fahrer ist nicht in der Nähe" and the SC-13 guidance. Atomic state update, same as acknowledgement. Rules in `02-architecture.md` §3–4. | Must | 1 |
| NT-11 *(new)* | Limits, channel order, the "Ich warte noch" delay and the escalation delay after the reminder are read from settings editable in the ops app (cached ≤ 1 min). | Must | 1 |
| NT-12 *(new)* | Per-channel kill switch: e.g. when WhatsApp is switched off, all alerts go immediately to other channels; the attempt is recorded as `suppressed` with reason `kill_switch`. | Must | 1 |
| NT-13 *(new)* | Co-driver alerts: urgent alerts go to owner and co-drivers together; the first to acknowledge closes the alert. | Should | 2 |

## 4. Parking assistant (Parkuhr) — moved to Phase 2

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| PA-01 | Parking-meter timer with reminders 10 and 5 min before expiry via Push or WhatsApp. | Should | 2 |
| PA-02 | Save parking location with one tap plus navigation link; deleted 24 h after session end. | Should | 2 |
| PA-03 | Explainer cards for Parkscheibe, Anwohnerparken, Halteverbot (static content edited by ops). | Could | 2 |

Reason for moving: nice to have but does not sell the subscription; the new prices require the smallest possible MVP.

## 5. Support

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| SP-01 | Help centre in German and English (20 articles at launch); contact form opens a ticket in self-hosted Zammad. | Must | 1 |
| SP-02 | AI assistant (Mistral EU) answering from the knowledge base only, with hand-off to a human; no access to user data. | Should | 2 |
| SP-03 | WhatsApp support (Premium) connected to Zammad. | Should | 2 |
| SP-04 | Short how-to videos (applying the decal, testing, setup). | Could | 2 |
| SP-05 *(new)* | Self-service "I didn't get the alert" page in the portal: shows the owner the latest delivery attempts and failure reasons in plain language with suggested fixes. Reduces the most expected ticket type. | Must | 1 |

## 6. Ops app (admin panel) — rebuilt

Support quality depends on this app more than on anything else. The most expected ticket: "My neighbour scanned the decal and I got nothing." Design principles: diagnose fast without seeing content; minimum access to personal data with every access logged; build less by using off-the-shelf tools.

### 6.1 Security and permissions

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| AD-01 | Separate app (`apps/ops`) deployed on its own subdomain behind WireGuard/VPN — not a route inside the public app. Its backend is a separate `api-ops` deployment reachable only via the VPN; the public API has no ops routes. Passkey-only login with MFA; session ends after 30 min idle. | Must | 1 |
| AD-02 | Fine-grained permissions (e.g. `pii.decrypt_request`, `billing.refund`) grouped into roles: support, abuse_moderator, finance, fulfillment, analyst, admin, superadmin. Code checks the permission, never the role name. | Must | 1 |
| AD-05 | Data masked by default (phone, plate, address). **No "log in as customer".** Instead a read-only preview of what the customer sees, with masked data. | Must | 1 |
| AD-06 | Four-eyes break-glass decryption: request with written reason and ticket number, approval by a second staff member with approve permission, valid 15 min for the specific field only, audit-logged, customer notified by e-mail by default. | Must | 1 |
| AD-17 | Audit log records actions **and reads** (opening a customer, decrypting, exporting). Append-only enforced in the DB and streamed live to object storage with Object Lock (WORM). Retained 12 months. | Must | 1 |

### 6.2 Customers and diagnosis

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| AD-03 | Customer 360: subscription and history, vehicles, status of each code (last scan, last test), health of each channel (verified? last success? error count), consent status of emergency contacts and co-drivers, protection score, orders and refunds. Search by e-mail or last 4 chars of the code. | Must | 1 |
| AD-04 | Delivery trace per alert: timeline of every attempt (channel, provider, status, error code, timings, cost, suppression reason). **Never the free-text content.** | Must | 1 |
| AD-20 | Zammad sidebar widget showing a masked customer summary and a deep link to Customer 360. No ticket screens in the ops app. | Must | 1 |

### 6.3 Codes, orders and partners

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| AD-07 | Pre-printed code batches linked to a partner and promo code. Order pipeline Generated → Printed → Shipped → Activated, with returned shipments, reprints and address correction (via break-glass). | Must | 1 |
| AD-13 | Promo codes: percent, amount or extra months; synced to Stripe Coupons; max redemptions, expiry, partner attribution. "Price lock" option in months (founding members). | Must | 1 |
| AD-21 | Business waitlist: companies (after double opt-in), fleet size, industry, contact status. Feeds gate G3. | Should | 1 |
| AD-22 | Self-service partner portal (property managers, dealers). | Could | after G3 |

### 6.4 Abuse and moderation

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| AD-08 | Abuse centre: owner reports, temporary blocks, **automatic pattern alerts** (code > 10 alerts/hour — decal photo leaked?; same daily scanner ref alerting ≥ 3 vehicles or reported by ≥ 2 owners in one day; fake-decal reports). Global blocks use the daily scanner ref and therefore last until the end of the day; per-vehicle blocks last 30 days. Action "revoke code on owner's behalf" with notification and a free replacement decal. | Must | 1 |
| AD-09 | False-positive review: random sample (10%, configurable) of blocked messages shown to a moderator with a dedicated permission, within the 7-day text retention. Every access logged. False-positive rate measured weekly. | Should | 1 |
| AD-10 | Manage filter word lists (DE/EN) with versions and rollback. | Must | 1 |

### 6.5 Privacy and finance

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| AD-11 | GDPR request queues with 30-day deadline and alert 7 days before. **Identity verification step** before any export or erasure. **Processor checklist** per request (DB, Zammad, Brevo, Stripe, 360dialog, print partner, Sentry), automated via API where possible; the request cannot close until all steps are done. | Must | 1 |
| AD-12 | Withdrawal and refund tool: computes the amount (paid − value of days used − cost of custom-printed decal), executes the Stripe refund, issues a credit note (Gutschrift). Requires `billing.refund`. | Must | 1 |

### 6.6 Settings, operations and metrics

| ID | Requirement | Priority | Phase |
|---|---|---|---|
| AD-14 | Settings without deploys: fair-use limits, default escalation delay, "Ich warte noch" delay and post-reminder escalation delay, alert type activation, severity and escalation flag, scanner page texts. Every change versioned and audited. Feature flags via self-hosted Unleash. | Must | 1 |
| AD-15 | Per-channel kill switches (Push, e-mail, WhatsApp, SMS) with immediate fallback (NT-12). Requires `settings.edit`; logged. | Must | 1 |
| AD-16 | Provider health on one screen: Meta quality rating for the WhatsApp number and template status, Brevo bounce rate, Push failure rate by platform, Stripe webhook failures, print-partner file status. Team alert when thresholds are crossed. | Must | 1 |
| AD-18 | Metrics via Metabase on the read replica (role without access to encrypted columns): MRR/ARR, churn, delivery and acknowledgement rates, message cost, **activation funnel** (paid → shipped → tested → second channel → emergency contact), **share of iOS users with working Push**, protection-score distribution. | Must | 1 |
| AD-19 | Service broadcasts to affected customers during an incident (e.g. WhatsApp outage), from templates. Not marketing. | Should | 2 |

### 6.7 Build less: off-the-shelf tools

| Need | Off-the-shelf | What we build |
|---|---|---|
| Metrics | Self-hosted Metabase on the replica | Queries; read-only role that cannot see encrypted columns |
| Tickets | Zammad (source of truth) | Small sidebar widget only |
| Feature flags | Self-hosted Unleash | Integration |
| Day-to-day billing | Stripe dashboard | Refund/withdrawal tool and promo codes |
| **Custom build** | — | Customer 360 + delivery trace, break-glass, codes and batches, abuse centre, GDPR requests, orders and shipping, settings and kill switches, provider health |

Estimate: 300 h for the ops app (V2: 130 h). An earlier V3 draft said 150 h, but the ops stories are 60 of the MVP's 268 points (22%); at the plan's average of ~5 h per point that is ~300 h. Metrics and tickets are still not built.

## 7. Non-functional requirements

| Area | Measurable target | How measured |
|---|---|---|
| Scanner page speed | LCP < 1.5 s on 4G; JS < 90 KB compressed | Lighthouse CI on every PR; RUM via Sentry |
| Scan → notification | p95 < 5 s for Push, < 10 s for WhatsApp | `alerts.created_at` vs `alert_deliveries.sent_at` |
| Delivery success | ≥ 99% of alerts reach at least one channel | Metabase; team alert below 98% |
| Escalation accuracy | ≤ 60 s deviation; zero double escalations | *Changed:* **monthly** chaos drill stopping Valkey on staging |
| Availability | 99.9% scanner path; 99.5% portal; 99% ops app | Better Stack + public status page |
| Recovery | RPO ≤ 5 min (WAL archiving); RTO ≤ 1 h | Documented monthly restore drill |
| Capacity | 200 alerts/s peak; 10,000 scans/min | k6 before launch and each phase |
| Security | OWASP ASVS L2; zero open critical/high findings at launch | External pentest, SAST, dependency audit; *new:* private bug bounty after launch |
| Ops security *(new)* | 100% of customer views and decryptions logged; no staff member holds both decrypt-request and decrypt-approve for their own request | Automated CI test; quarterly permission review |
| Settings *(new)* | Any change to limits or kill switches takes effect within 60 s without deploy | E2E test |
| Accessibility | WCAG 2.2 AA for public pages and scanner page | axe-core in CI + manual screen-reader review |
| Languages | German and English at launch; add a language without code changes | ICU message files |
| Browsers | Last two versions of iOS Safari, Chrome Android, Samsung Internet, Firefox | Playwright device emulation |
