# 00 — Overview

## 1. What ParkShield is

ParkShield replaces the phone number drivers leave behind the windscreen with a QR decal. Anyone who scans it can alert the owner within seconds: the car is blocking an exit, the lights are on, a window is open, or there is damage. The scanner needs no app and no account, and neither side ever sees the other's phone number. If the owner does not respond, the alert escalates automatically to an emergency contact who has explicitly agreed to receive it.

**Problem.** Many German drivers leave their number behind the windscreen. This exposes them to spam and fraud and clashes with Germany's strong privacy culture. The person who is blocked in has no way to reach the driver except calling the police or a towing company, which is costly for both sides.

**Solution.** A personal QR decal opens a fast web page (PWA) in the scanner's language. The scanner picks the problem with one tap. The owner receives Web Push, WhatsApp or e-mail with an "Ich komme" button and quick replies. The scanner sees the alert status live. Escalation kicks in when the owner does not respond.

## 2. Key decisions (V3)

| Decision | Detail |
|---|---|
| Everything paid, low price | No free tier, no trial. **Plus €10/year**, **Premium €15/year**, VAT included. **Business: "coming soon"** (Bald verfügbar). Annual billing only. |
| Phased launch | Plus at launch (Tue 3 Aug 2027). Premium in Phase 2 (9 Nov 2027). Business only after decision gate G3 passes. |
| Differentiator | Acknowledge + escalation with live status for the scanner, now with quick replies and follow-up after acknowledgement. This is the marketing hook. |
| Activation before growth | A customer who never tested the decal or enabled a second channel will not renew. "Protection completeness" is a core metric with automatic reminders. |
| Privacy by design | No device fingerprinting. Daily-rotating pseudonymous reference. Field-level encryption. Explicit consent from emergency contacts and co-drivers. Retention schedule per data type. Erasure at every processor. |
| Lean operations | Because prices are low: buy instead of build where possible, founders handle support at first, fixed costs ~€5,100/month after launch. |
| Infrastructure | Hetzner Cloud in Germany; EU vendors where possible (Brevo, seven.io, Friendly Captcha, Mistral). |
| Budget | Investment to launch €140k (nearshore team) to €242k (German agency). Total funding to break-even ~€275–290k in scenario A, including Premium development. |
| Break-even | Lean-stage break-even at ~7,900 (year-2+ margin) to ~12,500 (year-1 margin) customers, around Q1–Q2 2028. Company break-even at growth-stage costs (~33–35k customers) expected **Q4 2028**. This date is used consistently everywhere. See `05-business.md` §4. |
| Timeline | Phase 0: Dec 2026–Jan 2027. Build: Feb–Jun 2027. Paid beta: Jul 2027. Launch: 3 Aug 2027. Premium: 9 Nov 2027. Austria: from Apr 2028. |

> **Important — pricing impact.** Cutting prices from €29/€59 to €10/€15 makes the product easier to sell but sharply raises the number of customers needed to break even. With V2's fixed costs, break-even rises from ~6,500 to ~15,000 customers. With V3's lean cost model it is ~7,900 customers (year-2+ margin) for the lean stage; growing beyond that stage raises fixed costs and the target again. See `05-business.md` §3–4. All calculations assume prices are **per year**.

## 3. What changed from V2

| Area | Change | Type |
|---|---|---|
| Prices | Plus €10/yr (was €29), Premium €15/yr (was €59), incl. 19% VAT | Changed |
| Business | Shown as "coming soon" with a company waitlist. No price, no development before gate G3 | Changed |
| Monthly billing | Removed. Stripe's fixed fee (~€0.25) would eat ~30% of a sub-€1 monthly charge | Removed |
| Included decal | One decal at first subscription only (not yearly). Extras paid; home-print PDF always free | Changed |
| Economics | Margin split into year 1 vs year 2+; break-even for three cost stages; three price scenarios compared | Changed |
| Fixed costs | Lean model after launch: ~€5,100/month instead of €9,557 | Changed |
| Ops/admin panel | Full rebuild: separate app behind VPN, fine-grained permissions, Customer 360 with delivery trace, four-eyes break-glass decryption, erasure at all processors, refund/withdrawal tool, promo codes, settings without deploys, channel kill switches, provider health, read events in audit log | New |
| Off-the-shelf tools | Metabase (metrics), Unleash (feature flags), Zammad sidebar widget instead of a ticket UI; ticket tables removed from DB | Changed |
| Scanner UX | Country-aware guidance after expiry, "Ich warte noch" button, anti-quishing trust cues, owner's "back at" notice | New |
| Owner UX | Protection score, activation reminders, quick replies, temporary modes, periodic summary, co-drivers (Premium), vehicle transfer on sale | New |
| Notifications | Follow-up after acknowledgement, instant escalation on "not nearby", limits editable from ops, automatic fallback when a channel is switched off | New |
| Parking assistant | Moved from MVP to Phase 2 (saves 60 h) | Changed |
| Light native app | Capacitor app in Phase 2 instead of "later if needed", due to iOS Web Push limits | Changed |
| Legal | Identity verification for GDPR requests, erasure at every processor, co-driver consent, OSS for EU sales before expansion | New |
| Security | Fake-decal threat, staff account compromise, private bug bounty after launch, monthly Valkey chaos drill | New |
| Database | 18 new tables, 2 removed, 12 modified. Total 46 | Changed |
| User stories | 45 stories (44 + hardening), 268 points, 10 sprints + hardening | Changed |
| Timeline | Launch 3 Aug 2027 (was 6 Jul). Premium 9 Nov 2027. Business only after G3 | Changed |
| Consistency | Single break-even date, conservative revenue scenario, removed "schema tested" claim until it runs in CI | Changed |
| Scope | New "What we will not build" section | New |

## 4. Review findings and resolutions

### 4.1 V1 issues (resolved in V2, kept in V3)

| # | Issue in V1 | Severity | Resolution |
|---|---|---|---|
| 1 | Device fingerprint and IP despite "no scanner data" claim (§25 TDDDG) | Critical | Server-side pseudonymous ref: HMAC with daily salt that is never stored; deleted after 24 h |
| 2 | Emergency contact stored without their consent | Critical | Invitation with confirmation link; auto-delete after 14 days without reply |
| 3 | OpenAI API transfers data outside the EU | Critical | Mistral (France); assistant never sees alert data |
| 4 | "Automated Towing Relay" without legal basis | Critical | Removed. Legal guidance for scanner and "Abschleppen droht" alert type |
| 5 | Licence plate not encrypted | High | AES-256-GCM field encryption with blind index |
| 6 | "All tables encrypted" is inaccurate | Medium | Two layers: LUKS disk encryption + app-level field encryption with key rotation |
| 7 | No retention for alerts; backups excluded from deletion | High | Detailed retention schedule; backups expire after 35 days |
| 8 | Rate limiting easy to bypass | High | Three limit layers, captcha, report + block |
| 9 | Redis single point of failure for escalation | High | DB is source of truth, sweeper worker, atomic state update |
| 10 | Redis Enterprise is expensive | Low | Self-hosted Valkey 8 |
| 11 | Incomplete data model | High | Full model (46 tables in V3) |
| 12 | WhatsApp requirements unclear | Medium | Utility templates, opt-in, monthly cap, cost tracking |
| 13 | Mandatory German legal requirements missing | Critical | `04-legal-privacy.md` |
| 14 | MVP scope too large | High | Clear phases; MVP sells Plus only |
| 15 | No measurable NFRs | Medium | `01-requirements.md` §7 |
| 16 | No failure cases | Medium | Fallback chain, "expired" state, weak-network handling |
| 17 | No costs or pricing | High | `05-business.md` |
| 18 | Roadmap truncated | Medium | Roadmap with decision gates |
| 19 | ™ used without trademark check | Medium | DPMA + EUIPO filing in Phase 0 |
| 20 | Cold-start problem | Medium | Useful to the owner from day one; partner distribution |

From V1 §6.2, do **not** carry over: conversion stats from the free tier (no longer exists), device-fingerprint bans (removed), native ticket system (replaced by Zammad).

### 4.2 V2 review findings and V3 resolutions

| # | Finding on V2 | Severity | Resolution in V3 |
|---|---|---|---|
| 21 | Break-even inconsistent: 6,530 customers vs. only 5,500 forecast for end of 2027; different dates (Q2/Q3 vs Q3/Q4 2028); ignored growing fixed costs | High | One calculation, three cost stages, year-1 vs year-2+ margin, one date (Q4 2028) |
| 22 | 2028 forecast optimistic with no alternative | High | Base and conservative (40%) scenarios with funding impact |
| 23 | Included decal with monthly plan: customer may cancel after two months after the decal cost was paid | Medium | Monthly billing removed; one decal at first subscription only |
| 24 | Withdrawal / Wertersatz details presented as settled | Medium | Final wording from lawyer in Phase 0; calculation tool in ops (AD-12) |
| 25 | WhatsApp limits hard-coded while Meta pricing may change | Medium | All limits editable from ops without deploy (AD-14) |
| 26 | VAT for customers outside Germany not covered | Low | OSS registration before expansion |
| 27 | Most users won't add an emergency contact at first, so no escalation happens | High | Protection score, reminders, "not nearby" quick reply |
| 28 | Scanner has nothing to do after an alert expires | Medium | Country-aware guidance (SC-13) |
| 29 | No reminder for owners who never tested the decal | Medium | OW-15 |
| 30 | No support for shared cars or selling the car | Medium | Co-drivers (OW-19), transfer (OW-20), Phase 2 |
| 31 | Owner acknowledges but never arrives; scanner has no option | Medium | "Ich warte noch" + owner follow-up (SC-14, NT-09) |
| 32 | Fake decal (quishing) threat not addressed | High | Trust cues on scanner page + fake-decal report (SC-15) |
| 33 | iOS Web Push limits are the biggest product risk and the fix was postponed | High | Measure from beta day one; light app in Phase 2 |
| 34 | Valkey chaos test only once | Low | Monthly drill |
| 35 | No measurement of false-positive message blocking | Medium | Human review sample (AD-09) |
| 36 | Only one pentest before launch | Low | Private bug bounty after launch |
| 37 | Admin panel incomplete: no delivery diagnosis, no controlled decryption, erasure ignores processors, no refunds/promo codes, coarse roles, admin inside the public app | High | `01-requirements.md` §6 |
| 38 | Ticket tables duplicate Zammad data | Low | Removed; Zammad is source of truth with sidebar widget |
| 39 | Property managers are the best channel but were deferred | Medium | First channel in the beta, with decal bundles and promo codes |
| 40 | No competitor analysis, no alternative price test | Medium | Competitor analysis + three-price test in Phase 0 |
| 41 | "Schema tested on PostgreSQL 16" without evidence in repo | Low | Schema runs in CI on PostgreSQL 18 before approval; not claimed tested before that |

## 5. Users

### 5.1 Roles

| Role | Who | Wants | Sees |
|---|---|---|---|
| Scanner | Anyone on the street: a blocked neighbour, a passer-by who noticed lights on | Notify the owner fast, without revealing identity or installing anything | Vehicle nickname and colour, alert status, owner's "back at" notice if set. No name, number or plate |
| Owner | Paying subscriber | Be notified instantly and protect their number | Dashboard: vehicles, decals, channels, protection score, alert history (90 days) |
| Co-driver *(new, Premium)* | Partner or family member driving the same car | Receive that car's alerts | Alerts and reply buttons for shared vehicles only, after accepting the invitation |
| Emergency contact | Partner, relative or colleague | Be notified only if the owner does not respond | Incident type and vehicle nickname only |
| Fleet manager | Company with 5+ vehicles | Route alerts to the responsible driver | **Coming soon.** Waitlist only until gate G3 |
| Ops team *(changed)* | Support, abuse moderator, finance, fulfillment, analyst, admin, superadmin | Solve problems fast without seeing unnecessary data | Separate ops app with fine-grained permissions; every access logged |

### 5.2 Personas

- **Jonas, 34, Cologne.** Parks on the street, left his number behind the windscreen and now gets scam messages. Wants something simple and respectful. At €10/year he barely needs to think: less than two coffees, far less than one parking fine.
- **Aylin, 41, Munich.** Mother of two; her driveway is blocked often. Wants alerts to reach her husband too because he drives the same car, and wants to know the other driver is "coming". Premium persona; the co-driver feature is designed for her.
- **Malermeister Schulz GmbH.** Painting company with 12 vans. The manager wants alerts to reach the current driver, not the office. Joins the Business waitlist; may be served manually in a concierge pilot before the plan is built.
- **Scanner: Frau Becker, 67.** Dislikes apps. Needs a German page with large buttons that works in 3 seconds and reassures her the message arrived. If nobody responds, she wants to know what to do next.

### 5.3 Core user journey

1. The owner buys Plus annually (€10), registers the car and designs the decal. It ships in 3–5 business days; a print-at-home PDF is available immediately.
2. A "protection completeness" checklist appears: verified e-mail (already done), a second channel (Push or WhatsApp), a confirmed emergency contact, and a tested decal. The score starts at 25% and reaches 100%.
3. The owner applies the decal, taps "Aufkleber testen" in the portal and scans it; a test alert arrives on all channels. If not tested within 3 days of delivery, a reminder is sent, then at 7 and 14 days.
4. Weeks later a neighbour scans it and chooses "Fahrzeug versperrt Ausfahrt". The page shows the car's nickname and colour so the scanner knows it is the right decal.
5. The owner gets Push and WhatsApp together because the alert is urgent, with three replies: "Ich komme", "In ca. 30 Min", or "Bin nicht in der Nähe".
6. On "Ich komme" the scanner's screen immediately shows "Der Fahrer hat bestätigt und ist unterwegs". On "not nearby" the alert escalates immediately to the emergency contact; without a confirmed contact, the scanner sees the guidance from step 8 right away.
7. With no response within 7 minutes the alert escalates and the scanner sees "Eskaliert an Notfallkontakt".
8. If 15 minutes pass after acknowledgement and the owner has not arrived, the scanner taps "Ich warte noch" and the owner gets one reminder; with no reply within 5 minutes the alert escalates to the emergency contact. If the alert expires unresolved, the scanner sees practical guidance: contact the local Ordnungsamt, or 110/112 in real danger.

## 6. What we will not build

Writing down what we reject protects scope. These are explicitly rejected and are only reconsidered with a written ADR:

- **Automatic data hand-off to towing companies.** No legal basis and liability risk.
- **Device fingerprinting or any scanner tracking** beyond the daily pseudonymous reference.
- **Maps or GPS tracking of owners' cars.** Phase 2 parking location is for the owner only and is deleted after 24 h.
- **A free tier or trial.** The free home-print PDF is for subscribers only.
- **Monthly billing** at current prices.
- **Our own ticket system, metrics dashboard, or feature-flag system.**
- **"Log in as customer" (impersonation)** in the ops app.
- **Full native apps** with their own features. The Phase 2 light app is only a shell around the web app.
- **Business before gate G3.**
- **Marketing messages over alert channels**, or any ads inside the product.
- **Transferring alert history** when a car is sold.
- **An AI assistant that can see user data.**
