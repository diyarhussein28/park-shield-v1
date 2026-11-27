# ParkShield — handover guide for developers and AI coding agents

Read this first. It explains what ParkShield is, how the code is organised, how to run, test and
build it, the rules the code must follow, the traps we already fell into, and what is left to do.
Product specs live in [`docs/`](docs/README.md); this file is the practical map.

**The current go-live state, decisions, test-only relaxations and team rules are in
[`docs/status.md`](docs/status.md).** Read it too, and update it when you finish a step.

_Last updated: 25 November 2026 (price 19,99 € everywhere, Stripe and stores alike). Before: 24 November 2026 (app first: the website lost sign-in, portal and checkout, §3). Before: 21 November 2026 (single plan 20 €, app-only alerts with 10-min reminder and one SMS after 30 min, trusted contacts removed, Sperren without reissue, 3 € print; progress in `docs/handover.md`)._

---

## 1. What ParkShield is

A QR decal for cars. Anyone who sees a problem with a parked car (it blocks an exit, the lights are
on, a window is open, it is about to be towed, there is damage) scans the decal with their phone
camera, picks the problem on a web page and taps send. **No app, no account, and nobody sees the
owner's phone number, name or licence plate.** The owner is notified in the ParkShield app (push only; no alert e-mail); without a reaction a reminder push follows after 10 minutes and one SMS to the owner's verified mobile number after 30 minutes
and replies with one tap ("Ich komme", "In ca. 30 Min", "Bin nicht in der Nähe"); the person at
the car sees the reply live. Trusted/emergency contacts were removed on 2026-11-21: only the owner is escalated to.

- Market: Germany first (German is the source language, English is the second UI language).
- Model: one paid yearly plan **„ParkShield“, 19,99 € / year incl. 19 % MwSt., one vehicle** (20 € until 2026-11-25), everything
  included (owner decision 2026-11-21; Plus/Premium and Business were dropped).
- **Lifetime** (owner decision 2026-11-26): the same plan paid **once, 29,99 €** (no renewal, nothing to
  cancel): `subscriptions.interval = 'lifetime'`, Stripe one-time Checkout or a store non-consumable.
  One button under the yearly pay button (`docs/handover.md` §25).
- Privacy is the product: servers in Germany/EU, no ads, no tracking, data minimisation by design.

The full specification (requirements with IDs such as `SC-`, `OW-`, `NT-`, `AD-`, `US-`) is in
[`docs/`](docs/README.md). `docs/03-user-stories.md` has the sprint plan and acceptance criteria.

## 2. Status

**Phase 1 (MVP, user stories US-01 … US-45) is complete in this repository**, including the
hardening story US-45 (security pass, load test, accessibility audit, runbooks, chaos drills,
monitoring as code, permission review). CI on GitHub is green.

| Milestone                                                        | Commit                |
| ---------------------------------------------------------------- | --------------------- |
| Sprint 1–10 (US-01 … US-44)                                      | `dcd171b` … `b568eff` |
| US-45 security pass                                              | `66dc8e2`             |
| US-45 load, chaos, a11y, runbooks, monitoring, permission review | `9eb00ac`             |
| Public website redesign (photos, animated demo, header/footer)   | `42aff8f`             |
| Vercel website preview, CI fixes for GitHub                      | `41232e1` … `b70bf94` |

What is **not** done is mostly outside the code (accounts, keys, hosting, legal). See §11.

## 3. Repository layout

npm workspaces + Turborepo. Node.js 24+, TypeScript everywhere.

| Path                       | What it is                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                 | Next.js 16 public website (:3000): landing page, `/app` (account → app), legal pages, help centre, and the **scanner page `/s/[code]`** (no sign-in since 2026-11-24) |
| `apps/ops`                 | Next.js 16 back-office app for staff (:3001), VPN-only in production                                                                                                  |
| `apps/api`                 | NestJS 12 on Fastify. One codebase, **three processes**: `main.ts` public API (:4000), `main-ops.ts` ops API (:4001), `worker.ts` background worker (outbox, jobs)    |
| `packages/i18n`            | All UI texts, German (`de.ts`, source) and English (`en.ts`); ICU message format; a parity test enforces identical keys                                               |
| `packages/ui`              | Shared React components and design tokens (`theme.css`, Tailwind v4); a test checks WCAG contrast of every token pair                                                 |
| `packages/shared`          | Shared constants and types (plans, prices, alert types, decal products)                                                                                               |
| `db/migrations`            | SQL migrations (dbmate). `20261109000000_schema_v3.sql` is the base schema                                                                                            |
| `e2e`                      | Playwright end-to-end tests (desktop + mobile Chrome) incl. accessibility sweep                                                                                       |
| `scripts`                  | Dev tooling: `dev.ts` (starts everything), DB helpers, load seed/report, chaos drill, ops invite                                                                      |
| `load`                     | k6 load test (`load/k6/peak.js`) and results (`load/README.md`)                                                                                                       |
| `infra/terraform`          | Hetzner servers, network, firewall (Terraform)                                                                                                                        |
| `infra/ansible`            | Server configuration and deploys (PostgreSQL + pgBackRest, Caddy, Docker, WireGuard, monitoring)                                                                      |
| `infra/monitoring`         | Better Stack monitors, heartbeat and public status page (Terraform)                                                                                                   |
| `docs/runbooks`            | On-call, provider outage, DB outage, abuse wave, fake decals, incident communication, chaos and restore drills, back office                                           |
| `docs/security`            | OWASP ASVS L2 self-assessment and pentest scope                                                                                                                       |
| `.github/workflows/ci.yml` | CI: format, lint, typecheck, schema check, unit tests, build, E2E, Semgrep, OSV, npm audit, Terraform/Ansible checks, staging deploy                                  |

### Inside `apps/api/src`

One folder per domain module: `auth` (magic link + passkeys), `billing` (Stripe, invoices, refunds,
credit notes), `channels` (push, SMS, e-mail set-up), `app` (native app API: sign-in, devices, alerts, photos), `chat` (Socket.io gateway and live chat),
`decal` (layout, SVG and print PDF of the decal), `scan` (scanner page API, alert creation),
`notifications` (dispatch, replies, escalation, follow-ups), `moderation` (text filter, word lists),
`preferences` (quiet hours, channel order, vehicle modes), `history`, `orders` (decal print orders),
`privacy` (GDPR export/deletion/requests), `support` (Zammad), `waitlist` (Business), `vehicles`,
`letters` (welcome letter PDF, decal QR export, company data on letters),
`ops` (back-office APIs, staff, permissions, audit), `providers` (real + fake adapters for every
external service), `worker` (outbox and scheduled jobs), `core` (crypto, HTTP hardening, DB pool,
logger), `security` (route registry and authorisation tests), `dev` (test-only helpers), `test`
(test harness).

### Web pages (`apps/web/app`)

**App first (owner decision 2026-11-24):** registration, sign-in, the owner portal and the website
checkout were removed; they live in the app (`apps/mobile`). `/anmelden` and `/konto/*` redirect (308,
`next.config.ts`) to `/app`, which links to the stores (`APP_STORE_URL`, `PLAY_STORE_URL`; empty =
„Die App erscheint in Kürze“) and to cancelling/withdrawing without login. Every API endpoint stays
(the app uses the same owner API). Sign-in e-mails always link to `/app/anmelden` (the app).

Public: `/`, `/app`, `/business`, `/hilfe` (+ articles, contact form), `/impressum`, `/datenschutz`,
`/agb`, `/widerruf`, `/barrierefreiheit`, `/sicherheit`, `/kuendigen` (cancel without login, §312k
BGB), `/widerrufen` (withdraw without login, §356a BGB). Flows: `/app/anmelden` and `/auth/open` (sign-in
links of the app), `/app/zurueck` (Stripe return into the app), `/app/alerts/[id]` (alert deep link,
falls back to `/app`), `/v/[token]` (view link of the escalation SMS), `/datenschutz-anfrage`,
`/konto-loeschen-abbrechen`, `/app/aktivieren` (set-up link of a pre-printed partner decal: opens the
app, the page only offers the app link). Removed on 2026-11-24 (owner decisions): `/aktivieren` (308 to
`/app`; setting up a partner decal is the app screen `apps/mobile/src/app/aktivieren.tsx`, API
`GET /v1/claim/:code` + `POST /v1/vehicles/:id/claim`), `/antwort` (308 to `/app`; the old e-mail reply
page — the reply token `POST /v1/ack` is still used by `/v/<token>`) and the website's passkey UI (the
passkey API stays for the app). A decal's QR code is issued with its
vehicle (`TokensService.issue`, stored in `qr_tokens` as hash + encrypted copy). Scanner: `/s/[code]`.
Dev only: `/dev/postfach` (local inbox), `/dev/checkout` (fake Stripe), `/design` (design system).

### Ops pages (`apps/ops/app`)

`/` dashboard, `/kunden` (Customer 360, refunds), `/warnungen/[id]` (alert trace), `/break-glass`
(four-eyes access to encrypted data), `/datenschutz` (GDPR queue), `/missbrauch` (abuse centre,
review queue, word lists), `/bestellungen` (decal orders, reprints, returns), `/partner`,
`/gutscheine` (promo codes), `/lager` (in-house QR + NFC sticker stock: batches with serial numbers, print
file, production CSV/ZIP; `docs/nfc-sticker-plan.md`), `/einstellungen` (+ `/anbieter` provider health, `/unternehmen`
company data and texts on letters), `/audit`, `/mitarbeitende` (+ `/pruefung` quarterly access
review), `/zammad`, `/willkommensbriefe` (welcome letters: filter, batch PDF, mark sent).

## 4. Running it locally

### Requirements

- Node.js 24+ and npm 11.
- A Redis-compatible server (we call it Valkey) on the port in `VALKEY_URL` (default **6380**):
  - Windows: Memurai Developer (`winget install Memurai.MemuraiDeveloper`), configured for 6380.
  - macOS/Linux: `valkey-server --port 6380` (or Redis), or change `VALKEY_URL` in `.env`.
- PostgreSQL 18 is **embedded** (npm package `embedded-postgres`); nothing to install. Data lives in
  `.local/pgdata`.
- For E2E: `npx playwright install chromium` once.

### Start

```bash
npm install
npm run dev
```

`npm run dev` (see `scripts/dev.ts`):

1. creates `.env` from `.env.example` on first run and generates local keys,
2. starts PostgreSQL 18 on :5432 with the `parkshield` and `parkshield_test` databases,
3. applies all migrations to both,
4. starts every app through Turborepo:

| Service                          | URL                                 |
| -------------------------------- | ----------------------------------- |
| Website + scanner + owner portal | http://localhost:3000               |
| Design system                    | http://localhost:3000/design        |
| Local e-mail inbox (fake Brevo)  | http://localhost:3000/dev/postfach  |
| Ops app                          | http://127.0.0.1:3001               |
| Public API                       | http://127.0.0.1:4000/v1/ready      |
| Ops API                          | http://127.0.0.1:4001/ops/v1/health |
| Worker                           | background process (outbox, jobs)   |

### Try the main flow by hand

(The same flow is automated in `ownerWithActiveDecal()` in `e2e/tests/helpers.ts`, through the owner
API exactly as the app calls it.) The website has no sign-in since 2026-11-24, so the owner side is the
app (`apps/mobile`, Expo; see its README) against the local API:

1. In the app: **Registrieren**, enter any e-mail address; the 6-digit code is in
   http://localhost:3000/dev/postfach.
2. Name and address, then a German mobile number (015x–017x); the SMS code is in the same inbox.
3. Paywall → **Testzahlung ausführen** on the fake checkout.
4. Add a vehicle, **Aufkleber testen**, and open the scan URL (`/s/<code>`) in a browser. Pick a
   problem and send; the app push lands in the inbox (App-Push), the reply buttons work, and the scanner
   page updates live.

### First staff account for the ops app

```bash
npm run ops:invite -- --email you@example.com --name "Your Name" --role superadmin
```

It prints a one-time set-up link: open it and register a passkey (Windows Hello, Touch ID or a
security key). Staff sign in with passkeys only; further staff are invited from the ops app.

### Provider keys (`.env`, never commit, never paste into chats)

Every external provider has a **fake adapter** that is used while its key is empty, so the whole
product works offline. Production refuses to start with fakes (unless `APP_ENV=ci`).

| Provider                       | Env vars                                                                                                                                                                        | Fake behaviour                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Stripe (payments)              | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_YEARLY` (19,99 €), `STRIPE_PRICE_MONTHLY` (fallback)                                                                | `/dev/checkout` simulates payment                      |
| RevenueCat (in-app purchases)  | `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_ENTITLEMENT_ID` (`parkshield_pro`); app: `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | fake store in Valkey (tests); app falls back to Stripe |
| E-mail: Mailjet (default)      | `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, `MAIL_FROM` (tracking off per message)                                                                                                 | `/dev/postfach` inbox                                  |
| E-mail: Brevo (optional)       | `MAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `MAIL_FROM`                                                                                                                             | `/dev/postfach` inbox                                  |
| E-mail: SendGrid (optional)    | `MAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY`, `SENDGRID_REGION` (`global`/`eu`), `MAIL_FROM`                                                                                    | `/dev/postfach` inbox                                  |
| SMS (Twilio)                   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` (sender ID, number or `MG…`)                                                                                       | SMS in `/dev/postfach`                                 |
| Scanner phone check (Twilio)   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` (`VA…`, Fraud Guard on)                                                                                  | code in `/dev/postfach`; prod: off                     |
| App push (Firebase FCM)        | `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` (service account of the Firebase project)                                                                               | pushes in `/dev/postfach` (App-Push)                   |
| App links (website)            | `APP_IOS_TEAM_ID`, `APP_IOS_BUNDLE_ID`, `APP_ANDROID_PACKAGE`, `APP_ANDROID_SHA256` (web app env)                                                                               | empty `/.well-known/*` files                           |
| Friendly Captcha               | `FRIENDLY_CAPTCHA_SITEKEY`, `FRIENDLY_CAPTCHA_API_KEY`, `NEXT_PUBLIC_FRIENDLY_CAPTCHA_SITEKEY`                                                                                  | "Sicherheitsprüfung: lokal simuliert"                  |
| Print partner                  | `PRINT_PARTNER` (`manual` until a partner adapter exists)                                                                                                                       | orders written to `.local/print-outbox`                |
| Audit bucket (S3, Object Lock) | `AUDIT_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                                                                                    | files in `.local/audit-bucket`                         |
| Zammad (support desk)          | `ZAMMAD_URL`, `ZAMMAD_TOKEN`, `ZAMMAD_GROUP`                                                                                                                                    | tickets stored locally                                 |
| Support by e-mail (instead)    | `SUPPORT_PROVIDER=email`, `SUPPORT_EMAIL`                                                                                                                                       | tickets stored locally                                 |
| Better Stack heartbeat         | `HEARTBEAT_URL_WORKER`                                                                                                                                                          | no ping                                                |

WhatsApp and the Business plan were removed (2026-12, migration `20261201000000_app_notifications_chat`).
Production without every provider account: `PRINT_PARTNER=manual` writes print
files and job tickets to `PRINT_OUTBOX_DIR`, and staff mark orders shipped in the ops app;
`SUPPORT_PROVIDER=email` with `SUPPORT_EMAIL` sends each contact-form request as one e-mail
(reply-to = customer) instead of a Zammad ticket. All three count as real providers in production.

Friendly Captcha endpoint: `FRIENDLY_CAPTCHA_ENDPOINT` is `eu` (default) or `global`, read by the API
(siteverify URL) and the web app (widget, scanner page, CSP hosts). The EU endpoint keeps scanner
data in the EU as the privacy policy says, but needs the Friendly Captcha **Advanced** plan and must
be ticked under Applications → Manage → API Endpoint. On smaller plans set `global` locally for
testing; production refuses to start with anything but `eu`. The application must be **Captcha
v2** with `localhost` (and later the real domain) in its domain list. Changing the value needs a
restart of `npm run dev`, because Next.js inlines it at start-up.

Local Stripe webhooks: current Stripe CLI versions require the events to be named; these are the
ones `StripePayments.parseWebhook` handles:

```bash
stripe listen --events checkout.session.completed,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,payment_intent.succeeded,charge.refunded --forward-to localhost:4000/v1/webhooks/stripe
```

Put the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.

Stripe account settings the code relies on (test mode and live, set once per account):

- Use a test key (`sk_test_…`) locally, never a live or restricted live key (`rk_live_…`).
- `STRIPE_PRICE_*` are **price** IDs (`price_…`), not product IDs (`prod_…`): `STRIPE_PRICE_YEARLY` =
  yearly, EUR 19.99, **tax behaviour inclusive** (checkout uses `automatic_tax`); it must match the
  setting `prices.plan_year_cents`. The 3 € print is a one-time payment without a price ID.
- Stripe Tax active with the German head office and a **registration for Germany** (otherwise
  invoices show 0 € VAT instead of the included 19 %).
- Customer portal saved, with payment method, billing details and invoice history on and
  **cancellation and plan changes off**: cancelling goes through the app (`/kuendigen`), which
  computes the §309 BGB end date and sends the `cancel_received` confirmation.
- Payment methods (Settings → Payment methods): card with Apple Pay and Google Pay, SEPA Direct
  Debit, PayPal, Link. Everything else off, including Klarna (no instalments at 10 €/year,
  `docs/02-architecture.md` §2).

SMS (NT-07) go through the same Twilio account: `TWILIO_SMS_FROM` is an alphanumeric sender ID (max.
11 characters, one-way, no registration needed in Germany), a Twilio number or a Messaging Service SID
(`MG…`). The only alert SMS is the escalation SMS (one per alert, after 30 min), one GSM-7 segment (≤ 160 characters) with the view link `/v/<token>`;
each one counts against `sms.monthly_cap` and costs `sms.cost_micros`. Status callbacks arrive
signed at `https://<domain>/v1/webhooks/twilio/sms` (locally only through a tunnel and
`TWILIO_WEBHOOK_BASE_URL`).

App push (Firebase Cloud Messaging HTTP v1): create a Firebase project with an Android and an iOS
app `de.parkshield.app`, upload the APNs key in the Firebase console, put a service account's
project id, client e-mail and private key into `FCM_*` (API) and `google-services.json` /
`GoogleService-Info.plist` into `apps/mobile/firebase/` (app build). Without keys the API uses a fake
that stores the exact FCM request body in the dev inbox.

## 5. Commands

| Command                                            | What it does                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                      | Everything (DB, migrations, all apps)                                                                                  |
| `npm run lint` / `npm run typecheck`               | All workspaces                                                                                                         |
| `npm test`                                         | Unit/integration tests of all workspaces (API tests use `parkshield_test` and Valkey DB 1; run one at a time)          |
| `npm run e2e`                                      | Playwright against the **running** dev stack (~8–12 min, 4 workers)                                                    |
| `npm run format` / `format:check`                  | Prettier                                                                                                               |
| `npm run build`                                    | Production build of all apps                                                                                           |
| `npm run db:migrate` / `db:rollback`               | dbmate on `DATABASE_URL`                                                                                               |
| `npm run db:check`                                 | Schema check on a scratch DB: up, `run_retention()`, rollback, up                                                      |
| `npm run db:types`                                 | Regenerate Kysely types (`apps/api/src/db/types.generated.ts`) — run after every migration; CI fails if they are stale |
| `npm run db:restore-drill`                         | Backup/restore drill                                                                                                   |
| `npm run ops:invite -- …`                          | Invite a staff member                                                                                                  |
| `npm run load:seed -- --vehicles 2000` / `--clean` | Load-test customers and decal codes                                                                                    |
| `npm run load:peak`                                | k6 peak scenario (200 alerts/s + 10,000 scans/min); `npm run load:report` afterwards                                   |
| `npm run chaos:drill`                              | Kills worker / stalls Valkey / locks PostgreSQL under traffic and checks nothing is lost                               |
| `npx tsx scripts/landing-decals.ts`                | Re-render the sample decals used on the landing page                                                                   |

Single API test file: `cd apps/api && npx vitest run src/scan`. Single E2E file:
`cd e2e && npx playwright test tests/sprint4.spec.ts`.

## 6. How it is built and deployed

- **CI** (`.github/workflows/ci.yml`) runs on every push to `main`: format, lint, typecheck,
  PostgreSQL 18 schema check, migrations, generated-types check, unit tests, production build, E2E
  on the built apps (`NODE_ENV=production`, `APP_ENV=ci`, fake providers), npm audit, OSV scanner,
  Semgrep, `security.txt` expiry, Terraform fmt/validate, ansible-lint. All actions are pinned to
  commit SHAs (Renovate keeps them current).
- **Staging deploy** job runs after CI but skips until the GitHub secret `STAGING_SSH_KEY` exists.
- **Production target:** Hetzner (Germany). Root `Dockerfile` with three targets: `api` (public
  API, ops API and worker share it), `web` and `ops` (Next `output: 'standalone'`); configured by
  Ansible, Caddy in front, PostgreSQL 18 with LUKS disk
  encryption and pgBackRest backups to S3, WireGuard VPN for the ops app and ops API. Not yet
  provisioned.
- **Single-server test stack (temporary):** `infra/single/` runs the website, API, worker,
  PostgreSQL and Valkey on one Hetzner VM with Docker Compose and Caddy, to test real providers
  (Twilio webhooks first) on a public domain. `APP_ENV=ci` with fakes for missing keys, so the
  whole site is behind basic auth except `/v1/webhooks/*`. Not production; see its README.
- **Public website on `park-shield.de` (until go-live):** Vercel was dropped on 2026-11-24. The
  test server serves only the public pages on the real domain (Caddyfile block `{$PUBLIC_DOMAIN}`,
  `noindex`): landing page, help centre, legal pages, `/email/*` (e-mail images, Webmail signatures)
  and `/.well-known/*`; everything else redirects home. Switch-over steps in `infra/single/README.md`
  („Public website on park-shield.de“).

## 7. Architecture essentials

- **Three API processes from one codebase.** The public API never registers ops routes. The ops
  API is a separate process on a VPN-only port.
- **Outbox pattern.** Every side effect (notification, mail, print order, audit stream) is written
  to the `outbox_events` table in the same transaction as the change. The worker leases batches
  (`locked_until`, 30 s, batch 50, 8 in parallel), wakes on `LISTEN outbox_new` and polls every
  second as fallback. Delivery is at-least-once, so **every handler must be idempotent**.
- **Settings in the database.** Limits, kill switches, timeouts, escalation delays and feature
  toggles live in `app_settings` (registry: `apps/api/src/ops/settings-registry.ts`), editable in
  ops with versions. Never hard-code them.
- **Encryption.** Sensitive columns (`*_enc`) use AES-256-GCM at application level
  (`apps/api/src/core/crypto.ts`, key versions `DATA_KEY_V<n>`); lookups use HMAC blind indexes
  (`*_bidx`). Tokens and links are stored as SHA-256 hashes only. Reply tokens are HMAC-derived
  from `SESSION_SECRET`, not stored.
- **Unified billing** (2026-11-22, `docs/billing-unified.md`): our `subscriptions` table is the
  entitlement hub for Stripe (web) and RevenueCat (App Store / Google Play, `billing/store-sync.service.ts`).
  Webhook event ids are stored once in `billing_webhook_events`; RevenueCat events are synced in the
  worker (outbox `store.sync`) from the REST subscriber. The printed sticker is personalised (vehicle
  label on every design, `design_snapshot` frozen at the confirmation step) and its value
  (`prices.sticker_value_cents`) is kept on a Stripe withdrawal after personalisation
  (`computeWithdrawalRefund` in `legal/rules.ts`).
- **Internal mails** (2026-11-22): the contact form mails `SUPPORT_EMAIL` (default
  `support@park-shield.de`, reply-to = customer, `support_request`) and the customer gets
  `support_received`. Every new subscription, renewal and paid 3 € print queues one
  `payment_notifications` row per Stripe event (`billing/payment-notify.queue.ts`); the worker's
  `PaymentNotifyService` mails `PAYMENT_NOTIFY_EMAIL` only, with the customer's letter PDF from the
  same generator as the admin download; when it cannot attach, it says „Anhang fehlgeschlagen“ and the
  letter follows (outbox retry, and again when the welcome letter is created). LEGAL_REVIEW.md §11.
- **E-mail blocks and the contract PDF** (2026-11-23): templates may add a success `badge` and `blocks`
  (details table with icon rows, info cards) rendered by the shared layout; rows and cards that format
  to an empty string are dropped. Icons: `mail/icons.ts` (also drawn in the PDF), hosted PNGs rendered
  by `node --import tsx scripts/email-assets.ts`. The contract PDF uses Plus Jakarta Sans from
  `apps/api/assets/fonts` (Dockerfile copies it; Helvetica fallback when missing).
- **E-mails** (2026-11-22): every e-mail is rendered by `mail/templates.ts` into the one layout
  `mail/layout.ts` (blue header, headline, at most one primary button, optional highlighted box such as
  the sign-in code, „Hilfe benötigt?“, footer with company data from `company_profiles`, „do not reply“
  line), HTML + plain text, own hosted logo only (`apps/web/public/email/`), no tracking. Attachments go
  through `OutgoingMail.attachments` (Mailjet/Brevo/SendGrid; the dev inbox keeps them base64). The
  contract confirmation attaches the PDF „Vertragsbestätigung“ (`billing/contract-confirmation.ts`) and
  records the sent versions in `contract_confirmations`.
- **Welcome letter and QR export** (`apps/api/src/letters/`). Outbox topic `welcome_letter.check`
  is queued at checkout and at the first vehicle; the handler creates version 1 once both hold
  (idempotent, advisory lock). The letter is a frozen snapshot (customer number `users.customer_no`,
  contract number, plate, plan lines from `landing.<plan>F*`, company data version), encrypted as a
  whole in `welcome_letters.snapshot_enc`; the PDF (pdfkit, built-in Helvetica, DIN 5008 Form B for
  a DL window envelope) is rendered on demand and never stored. Address: latest decal-order
  shipping address, else the Stripe billing address. Company data is versioned in
  `company_profiles` (ops → Einstellungen → Unternehmen). QR files (SVG/PNG/PDF, ECL Q, ZIP for
  several vehicles) encode `SCANNER_BASE_URL/s/<code>`. Permission `letters.print` (admin,
  fulfillment) shows names, addresses, plates and codes — a deliberate, audited exception to the
  masked back office; `letters.manage` (admin) re-creates letters and edits company data. Setting
  `welcome_letter.in_portal` (default off) offers the letter under „Dokumente“ (was `/konto/daten`; the portal is in the app since 2026-11-24).
- **New decal code** (2026-11-24, `vehicles/code-rules.ts`, `docs/handover.md` §14): „Sperren“ is free
  and immediate; a new code at most every `codes.reissue_cooldown_days` (10) per vehicle, counted from
  the newest code (except after the first „Sperren“ of the vehicle's only code, 2026-11-25); free once
  per subscription year after a „Sperren“ (`codes.free_reissues_per_year`),
  else 402 `payment_required` (3 € = new code + printed sticker, Stripe only). Every issued code is a
  row in `code_issuances`; `GET /v1/vehicles/:id/new-code` tells the app what is possible; staff with
  `codes.override_cooldown` use `POST /ops/v1/vehicles/:id/new-code` (audit `qr_code.replaced`).
  The paid one: `POST /v1/vehicles/:id/new-code/order` (Stripe one-time payment, order `new_code`);
  `OrdersService.markPaid` issues the code when the payment arrives (ledger `stripe_ref = order:<id>`);
  `charge.refunded` never revokes it (`code_issuances.refunded_at`, audit `qr_code.payment_refunded`).
  App: `components/new-code.tsx` (free / 3 € / wait date, „höchstens alle 10 Tage“) and the screen
  `app/fahrzeug/neuer-code/[id].tsx` (confirmation, Stripe in the app, then the new QR code and PDF).
- **Alert photos (Phase 2, `ALERT_PHOTOS_ENABLED`, off by default).** `apps/api/src/alert-media/`:
  up to 2 photos per alert (multipart on `POST /v1/scan/:code/alerts`), magic bytes + sharp re-encode
  without metadata, one AES-256-GCM key per file wrapped with the data key, files in `ALERT_MEDIA_DIR`
  (outside web roots, **never backed up**). One view link `/v/<token>` (HMAC token, only its hash
  stored) in every channel, never an attachment. Deleted after 30 days by the retention job (key, file,
  row) or at once by „Missbrauch melden“. Part of the single plan (no plan setting any more). Open items: LEGAL_REVIEW.md §5
  and, for the multi-host Ansible topology, a storage the worker can reach.
- **„Bin gleich zurück“** (2026-11-26, `VEHICLE_STATUS_ENABLED`, `docs/vehicle-status.md`): a temporary
  status message per vehicle (`vehicle_status`, module `apps/api/src/vehicle-status/`), shown first on the
  scan page with „Ich warte“ (alert type `waiting`, never escalated). Delayed outbox events
  (`vehicle_status.prewarn` / `.expire`, deduped by `version`) plus a 5 s sweep; DB triggers delete the
  status on a revoke and at the end of the subscription.
- **Scanner page `/s/[code]`** is a Next.js **route handler returning plain HTML + inline vanilla
  JS** (`apps/web/lib/scanner/*`), not React, to meet the 1.5 s / 90 KB budget on bad mobile
  networks. Keep it that way.
- **Security headers.** Web and ops set a nonce-based CSP in `proxy.ts` (the scanner page has its
  own hash-based CSP). The API adds nosniff, no-store, frame DENY, CORP and a deny-all CSP.
- **Ops authorisation.** Every ops route needs `@OpsPublic`, `@StaffOnly` or
  `@RequirePermission(...)` — the guard fails closed. Permissions, not role names, are checked, and
  every ops action (including reads of personal data) writes an audit log entry.
- **Audit log** is append-only (TRUNCATE is blocked) and streamed to an S3 bucket with Object Lock.

### Abuse protection (Protected Mode, phone check, phone bans)

Module `apps/api/src/abuse/`, spec in `docs/02-architecture.md` §5a, legal questions in
`LEGAL_REVIEW.md`. `PHONE_PEPPER` (32 random bytes, base64) is required in production and must never
change (all phone bans would be lost); `npm run dev` and `infra/single/setup-env.sh` generate it.
Without `TWILIO_VERIFY_SERVICE_SID` production simply offers no phone check (Protected Mode then
hides content of every sender); it never falls back to a fake. The fake treats German 015x–017x as
mobile, 032 as VoIP and other +49 numbers as landline. Free text (and later photos) must never reach
a notification when `alerts.content_hidden` is true. The scanner page must not use cookies, Web
Storage or IndexedDB (E2E `abuse-protection.spec.ts`).

### Notifications, escalation, chat and the app (2026-12)

- **App-only alerts** (owner decision 2026-11-21, `planChannels` in `notifications/dispatch.service.ts`):
  every alert goes to the app by FCM push only. No e-mail for alerts, ever; no browser push for alerts.
  Mailjet is only for account and contract mails.
- **App push payload** is generic: title „ParkShield“, a generic body (not even the alert type) and
  `{ alertId, kind }`. Never the scanner's text, a photo, the plate, the nickname or a name (FCM is
  Google). The app loads the rest from `/v1/app/*` with its bearer session.
- **Escalation** (`notifications/owner-reminder.service.ts`): `remind_at` = +10 min
  (`escalation.reminder_minutes`) → reminder push (`escalation_stage = reminder_sent`); `sms_due_at` =
  +30 min (`escalation.sms_minutes`) → **one** SMS to the verified number (`sms_sent`, `sms_sent_at`).
  The worker sweeps both every 5 s; one statement marks the step and queues its outbox event (no double
  SMS). Never for tests (SMS), never in quiet hours (SMS, even urgent), cap `sms.monthly_cap` (20).
- **Stop conditions** (`stopEscalation()` in `notifications/escalation.ts`): „Ich komme“, any other
  reply, opening the chat, an owner chat message, „Absender blockieren“, „Erledigt“
  (`POST /v1/app/alerts/:id/resolve`) and, since 2026-11-22, **opening the alert** (`POST
/v1/app/alerts/:id/seen` sets `seen_at` and stops the escalation in the same UPDATE; the workers
  drop a reminder or SMS already queued, `escalation_stopped_at`).
- **Badge** (2026-11-22): alerts not opened yet (`seen_at IS NULL`, not acknowledged/resolved, last
  90 days), counted on the server (`notifications/unseen.ts`): `unseenCount` in `GET /v1/app/alerts`,
  `GET /v1/app/alerts/unseen-count`, the answer of `/seen`, and the push payload (iOS `aps.badge`,
  Android `notification_count`). The app sets the icon badge with `setBadgeCountAsync`.
- **Change e-mail / mobile number** (2026-11-24, Konto → „Anmeldung & Kontakt“): e-mail via
  `profile/email-change.service.ts` (code to the new address, replaced only after it, notice to the old
  one, Stripe sync through outbox `billing.customer_email`, audit `user.email_changed`); the number via
  `/v1/channels/phone` (SMS only, replaced in place after the code, audit `user.phone_changed`).
- **Trusted contacts are gone** (2026-11-21): module, pages (`/k/…`, `/notfallkontakt`) and data
  removed; migration `20261210000000_drop_trusted_contacts` dropped the table, the contact columns of
  `alert_deliveries`, `alerts.escalation_step` and the `escalation_enabled` switches (2026-11-24).
- **Google Play „Pause“** (2026-11-24, migration `20261210000100_store_pause`): RevenueCat's
  `auto_resume_date` → `subscriptions.paused_until`; the row is `expired` (no protection) with unified
  status `PAUSED`, `GET /v1/billing/subscription` returns `paused`, checkout and store prepare answer
  409 `subscription_paused`, and Play's resume (RENEWAL) brings the same contract back.
- **Block sender** (`HistoryService.block`, `POST /v1/app/alerts/:id/block`, `POST /v1/alerts/:id/block`):
  chat closed at once (`close_reason = 'blocked'`), escalation stopped, existing abuse module report.
  The block state is computed on the server per alert (`senderBlocked`, `blockedUntil` in
  `/v1/app/alerts`, the detail and `/v1/alerts`; `abuse/sender-block.service.ts`): same `block_ref`
  for the vehicle or same confirmed phone hash, nothing else. „Blockierung aufheben“:
  `POST /v1/app/alerts/:id/unblock-sender` (also `/v1/alerts/:id/unblock-sender`) sets the owner's
  blocks expired and writes the audit entry `sender.unblock`; the chat the block closed stays closed.
- **Live chat**: Socket.io on the public API, namespace `/chat`, path `/v1/socket.io` **without a
  trailing slash** (Next.js would redirect `/v1/socket.io/`). Scanner auth = alert id + chat token
  (URL fragment, handshake payload only); owner auth = app session. Locked until the owner opens it;
  limits and timeouts in `chat.*` settings; PostgreSQL is the source of truth, the Valkey adapter is
  wired for several instances. `CHAT_SWEEP_MS=0` turns the timeout timer off (unit tests).
- **App** (`apps/mobile`): Expo SDK 58 + Expo Router, **not an npm workspace** (own lockfile; keeps
  React Native out of the server Docker build). `npm --prefix apps/mobile test`, `… run typecheck`.
  Besides alerts, alert detail and chat, the app has **the whole customer portal**, screen for screen
  like `/konto/*` (overview with set-up guide, vehicles with QR code, design, orders, modes, Protected
  Mode, Sperren / new code, print options; notifications with push status, the verified number and
  quiet hours; history
  with blocking; delivery help; plan with checkout, invoices, cancellation and withdrawal; data export
  and account deletion). It uses the same owner API with a bearer session and **the website's texts**:
  `packages/i18n` and `packages/shared` are shared as source (`metro.config.js`, tsconfig `paths`, Jest
  `moduleNameMapper`; `pt()` in `src/lib/portal-i18n.ts`); app-only texts stay in `src/lib/i18n.ts`.
  **Payments run on Stripe's page inside the app** (owner decision 2026-11-19, App Store risk in
  `LEGAL_REVIEW.md` §7): the app sends `appReturn` (its own `parkshield://zurueck`, Expo Go's `exp://`
  only in test environments), Stripe returns to the website's bounce page `/app/zurueck`, which
  redirects into the app, and the app confirms the checkout at once. The passkey API stays for the app
  (the website's passkey UI was removed with the portal, owner decision 2026-11-24).
  Navigation (redesign 2026-11-20, `docs/app-redesign.md`): four tabs in `src/app/(tabs)` —
  **Start** (`index`, Stage 4 2026-11-21: greeting, protection status, the car with the on-device photo,
  a decal preview with „Ansehen/Testen“ and „Design bearbeiten“; no alert cards), **Warnungen** (`alerts`: list + 90-day history, open-alert badge), **Fahrzeuge**,
  **Konto** (grouped list: plan → `/abo`, notifications, „Ihre Angaben“, Face ID
  switch, delivery help, data, help, sign-out) — with the branded `BrandTabBar`; every other screen is
  pushed above the tabs. The routing rules are the pure `gateTarget()` in `src/app/_layout.tsx`: first
  launch → `/willkommen` (four onboarding slides: what it is, alerts, privacy, the price: 19,99 € / year where the app buys through the stores) → `/registrieren` (e-mail + 6-digit code) →
  `/profil?flow=signup` (name, address, **required** mobile number with SMS code) → `/app-sperre` (Face ID offer) →
  `/tarif` (paywall) → `/erfolg` (success moments) → add the car; accounts without a profile or
  without a verified number get the blocking `/profil?flow=complete` (alerts are never blocked). **Profile gate:** the API answers
  `profile_incomplete` (409) on checkout and renewal until `PUT /v1/me/profile` was done (app and
  the former website `/konto` showed the form); `GET /v1/me/profile` also says `newAccount` (never had a contract).
  **App lock** (`src/lib/lock.tsx`, `expo-local-authentication`): opt-in under Konto, Face ID / Touch ID
  / Android biometrics with the device code as fallback, on cold start and after
  `app.lock_after_seconds` (setting, default 300, from `GET /v1/app/config`) in the background; an
  alert opened from its notification (and its chat) shows without unlocking (`allowedWhileLocked`).
  The session stays `THIS_DEVICE_ONLY`; Face ID does not work in Expo Go (iOS falls back to the
  passcode there), test it in a development build. **Welcome letter:** always the sign-up address;
  automatic letters only for profiles with source `signup` (old accounts that complete later get
  none; ops „Neu erstellen“ works for everyone). Colours, spacing and type come from
  `src/theme/tokens.ts`, a 1:1 copy of `packages/ui/src/theme.css` incl. the yellow `accent*` tokens (a
  test checks values and contrast); headings use Plus Jakarta Sans (`assets/fonts`, OFL), body text
  the system font; illustrations in `src/components/art.tsx`; icons and the logo are the website's SVG
  paths plus a few app-only ones (`src/components/icons.tsx`, via react-native-svg).
  **Language** (2026-11-22): German on a fresh install, before sign-in, without asking; „Sprache“ in
  Konto switches to English and saves it on the device (`ps.lang`, `lib/language.ts`) and in the
  account (`preferredLang`). **Abmelden** removes the push token and revokes the session on the server,
  deletes the session, flags and car photos from the phone (only the language stays), clears the
  in-memory stores and resets navigation to the first onboarding slide.
  Start Metro from `apps/mobile`, never from the repo root.
  Push needs a development or store build with Firebase (Expo Go shows the UI only).

## 8. Hard rules (from `docs/README.md`, apply to humans and AI alike)

1. Never store raw secrets (tokens, links): SHA-256 hashes only. Exception: the decal code is also
   stored encrypted (`code_enc`) so decals can be re-rendered; lookups always use the hash.
2. Never store full scanner IP addresses, device fingerprints or tracking cookies.
3. Sensitive fields are encrypted (`*_enc`) with blind indexes (`*_bidx`) for lookups.
4. No personal data in logs.
5. Every ops endpoint checks a specific permission and writes an audit entry, including reads.
6. Limits, kill switches and timeouts come from `app_settings`, never hard-coded.
7. Anything under "What we will not build" in `docs/00-overview.md` needs a written ADR first.

Also:

- **All UI text goes through `packages/i18n`** (`de.ts` first, then the same key in `en.ts`; the
  parity test fails otherwise). German strings in the specs are used verbatim.
- **Accessibility is a release gate (WCAG 2.2 AA):** contrast-tested tokens, visible focus, 24 px
  targets, no horizontal scroll at 320 px, reduced motion respected, decorative motion stops within
  5 s or can be paused. The E2E a11y sweep enforces it.
- **New public (unauthenticated) API route?** Add it with its abuse control to the registry in
  `apps/api/src/security/routes.test.ts`, or the test fails.
- **Semgrep false positives** are marked inline with `// nosemgrep: <rule-id> -- <reason>`; never
  suppress without a reason.

## 9. Testing conventions

- API tests are integration tests against real PostgreSQL and Valkey (`apps/api/src/test/harness.ts`:
  `createHarness`, `resetState`, `mailbox`, `setSetting`, `verifyPhone`, `registerAppDevice`,
  `escalationDue`, `runEscalation`). Use the helpers instead of raw inserts into `app_settings`.
- `audit_logs` is append-only and **never reset between runs**: filter assertions by this run's
  actor or entity ids. Tests that stream the audit log must reset `audit_stream_state`.
- E2E (`e2e/tests`): use the shared `sql()` helper (never a new pg client per call), `staffBrowser()`
  for ops sessions, `expectAccessible(page)` on every new page. Pages render dynamically, so wait for
  `networkidle` before typing or clicking (hydration). Only toggle `channels.sms.enabled` in E2E —
  settings are global and tests run in parallel. Tests that change global state run on desktop only.
- E2E global setup raises per-IP rate limits in the dev DB (all local traffic is one IP).

## 10. Known traps (save yourself the hours we spent)

- **Windows / PowerShell 5.1:** `Set-Content`/`Get-Content` corrupt UTF-8 (use an editor or
  `[IO.File]` with UTF-8 without BOM); PowerShell mangles double quotes in native-exe arguments —
  pass commit messages with `git commit -F <file>`.
- **Orphaned PostgreSQL:** stopping `npm run dev` can leave an embedded `postgres.exe
--forkchild="io_worker"` holding port 5432; the next `npm run dev` then dies with "undefined".
  Kill that process and restart.
- **Port 5432 already in use (macOS):** a Homebrew or Postgres.app server on 5432 makes
  `npm run dev` die with the same bare "undefined". Leave that server alone and move ParkShield to
  another port by changing it in `DATABASE_URL` and `TEST_DATABASE_URL` in `.env` (e.g. 5433).
  Homebrew Valkey listens on 6379, so set `VALKEY_URL=redis://127.0.0.1:6379/0` there too.
- **New folder under `apps/api/src`:** the SWC watcher on Windows misses it — restart `npm run dev`.
- **`next build` while `next dev` runs** causes an HMR reload loop: build with
  `NEXT_DIST_DIR=.next-prod`. Measure performance (scanner page) on a production build, not dev.
- **Turborepo strict env mode:** a build-time env var read in `next.config.ts` must be listed under
  `build.env` in `turbo.json` (root scripts use `--env-mode=loose`, the Docker build too).
- **CI is a production build with fakes** (`APP_ENV=ci`). Test-only routes (dev mailbox, local push
  receiver) are gated by `isTestEnvironment()` in `apps/api/src/config/env.ts`, not by `NODE_ENV`.
- **Smooth scrolling and Next.js 16:** `scroll-behavior: smooth` on `<html>` needs
  `data-scroll-behavior="smooth"` on `<html>` (`apps/web/app/layout.tsx`), or page changes open
  scrolled down (the home page at the footer). Keep both together.
- **The logo** is defined once in `apps/web/lib/brand-mark.ts`; use `Logo` / `LogoMark` from
  `apps/web/components/brand/logo.tsx` and re-render the images with `npx tsx scripts/email-assets.ts`.
  Never draw another icon (star, check mark) as the logo.
- **Linux fonts are wider than Windows fonts:** reflow at 320 px can fail only in CI. Long e-mail
  addresses, codes and keys need `min-w-0` / `wrap-anywhere`; fieldsets may shrink (theme.css).
- **`next-env.d.ts` is git-ignored**; image import types come from `apps/web/image-types.d.ts`.
- **Windows PostgreSQL connections are slow (~400 ms each):** the API pool keeps connections alive
  and warms up at start; E2E must reuse the shared `sql()` helper.
- **Chaos drill kills the dev worker** — restart `npm run dev` afterwards. Re-seed before each load
  run (20 alerts per decal per day limit).
- **npm overrides:** `minimatch` is forced to ≥ 11.0.1 (advisory GHSA-g3hv-75wg-m249); `npm ls`
  reports `@swc/cli` as "invalid" because it asks for ^9 — expected and harmless.

## 11. To-do list

### A. Needs the project owner (accounts, keys, decisions)

- [x] **Company data** in the Impressum, Datenschutz, Widerruf and credit notes: Diyar Hussein
      Dienstleistungen (Einzelunternehmen, Leverkusen), USt-IdNr. DE454570643.
- [x] **Domain and company mailbox:** `park-shield.de` (Strato, `parkshield.de` belongs to someone
      else), mailbox `contact@park-shield.de`. Used on the legal pages, `security.txt`, the scanner
      footer and as `MAIL_FROM`. Still `@parkshield.de`: the setting `ops.alert_email`
      (`datenschutz@parkshield.de`, change it in ops → Einstellungen) and the infra/runbook examples.
- [ ] Remove `noindex` (`SITE_NOINDEX`, and the `X-Robots-Tag` line of the Caddyfile's public block)
      once the lawyer has reviewed the legal pages.
- [ ] Switch `park-shield.de` from Vercel to the server and delete the Vercel project
      (`infra/single/README.md`, „Public website on park-shield.de“).
- [ ] **Lawyer review:** AGB, Datenschutzerklärung, Widerrufsbelehrung, and the withdrawal formula
      (Wertersatz per started day; printed decal valued via setting
      `refunds.custom_decal_cost_cents`, currently 2.50 €).
- [ ] **Stripe:** live/test keys, the yearly price (19,99 €, tax-inclusive, `STRIPE_PRICE_YEARLY`),
      webhook secret.
- [ ] **Friendly Captcha:** account, sitekey and API key.
- [ ] **Twilio (SMS):** Twilio account, sender ID, status callback URL (needs hosting or a tunnel).
- [ ] **Firebase (app push):** project, APNs key, service account → `FCM_*`; app config files.
- [ ] **App stores:** Apple developer team (→ `APP_IOS_TEAM_ID`), Play Console signing key
      fingerprint (→ `APP_ANDROID_SHA256`), store listings and privacy labels (`LEGAL_REVIEW.md` §7).
- [ ] **Mailjet (e-mail, default):** account (free plan), sender domain park-shield.de verified
      (SPF/DKIM records at Strato), API key + secret → `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`.
      Brevo was tried first but always rewrites links and adds an open pixel (opt-out only for
      Enterprise); its and SendGrid's DNS records stay but are unused.
- [ ] **Twilio SMS:** upgraded Twilio account, Germany enabled under Messaging → Geo permissions,
      `TWILIO_SMS_FROM` (alphanumeric sender ID `ParkShield`, a number or a Messaging Service), status
      callback `https://<domain>/v1/webhooks/twilio/sms`.
- [ ] **Print partner:** choose (Flyeralarm, WIRmachenDRUCK or local) and API vs. SFTP; an adapter
      must then be written (`PRINT_PARTNER`). Until then orders go to `.local/print-outbox`.
- [ ] **Hosting:** Hetzner servers + domain (e.g. parkshield.de), then run Terraform + Ansible, add
      `STAGING_SSH_KEY` to GitHub secrets so the staging deploy job runs.
- [ ] **S3 bucket with Object Lock** (Hetzner Object Storage, `fsn1`) for the audit log and
      pgBackRest backups — before production.
- [ ] **Support desk** (decided 16 Nov 2026): the contact form goes to the support mailbox
      (`SUPPORT_PROVIDER=email`) until shortly before the paid beta. Then **Zammad Cloud Starter**
      (1 agent, German data centre; hosted, not self-run): during the 30-day trial (it runs on
      Professional) check that the API and the Customer 360 link field work on Starter, create the
      `Support` group and an API token, set `SUPPORT_PROVIDER=zammad`, `ZAMMAD_URL`, `ZAMMAD_TOKEN`,
      sign the AV contract and add Zammad to the Datenschutzerklärung. No ticket system of our own
      (`docs/00-overview.md`, "What we will not build"; it would need an ADR).
- [ ] **Better Stack** account + Uptime API token; apply `infra/monitoring`, set
      `HEARTBEAT_URL_WORKER`; set up the on-call rota.
- [ ] **Real staff accounts and roles** in the ops app.
- [ ] **Real photos** of the decal on cars to replace the CC0 stand-ins in
      `apps/web/assets/photos/` (see `CREDITS.md` there).

### B. Engineering, before launch

- [ ] Deploy the backend to Hetzner staging; run the k6 pass/fail load test and the chaos drill
      there (`load/README.md`, `docs/runbooks/chaos-drills.md`).
- [ ] Book the **external pentest** (scope ready in `docs/security/pentest-scope.md`) and fix its
      findings (acceptance: no open critical/high).
- [ ] Manual **screen-reader test** (NVDA, VoiceOver) and optional external BITV test; update
      `/barrierefreiheit`.
- [ ] Write the **print partner adapter** once the partner is chosen.
- [x] `__Host-` cookie prefix (2026-11-24, `apps/api/src/auth/cookies.ts`): automatic on every https
      production origin (`NODE_ENV=production` and an `https://` `WEB_BASE_URL` / `OPS_BASE_URL`),
      plain names on http://localhost. Switching signs everyone out once.
- [ ] Revisit `style-src 'unsafe-inline'` in the CSP.
- [ ] Move the remaining **scanner page texts** (beyond alert-type labels) from code into
      `packages/i18n`.
- [x] Vercel dropped (owner decision 2026-11-24): the website is served from our own server.

### C. Known product gaps (deliberate, Phase 1)

- Android: the „Ich komme“ action button is on the iOS notification (APNs category); on Android a tap
  opens the alert with a large „Ich komme“ button (FCM notification messages carry no action buttons).
- Muted alerts (quiet hours, sensitive spot) are stored as suppressed deliveries and shown in the
  owner's history — keep it that way.
- Account deletion leaves an erasure request "in progress" with manual steps (Zammad, Twilio, print
  partner) that staff tick off in the ops GDPR queue.

### D. Next phases (see `docs/03-user-stories.md` §3)

- **Paid beta** (July 2027, 300 founding members) → **public Plus launch 3 Aug 2027**.
- **Phase 2 — Premium** (launch 9 Nov 2027): co-drivers and vehicle transfer, anonymous chat, SMS
  fallback, masked calls, parking assistant, Wallet
  passes, NFC decals, scanner photo with blurring, AI support assistant, Plus → Premium upgrade with
  proration.
- Done ahead of Phase 2 (2026-12): native app (Expo, `apps/mobile`), tiered notifications,
  owner reminder, sequential escalation to up to 3 trusted contacts, owner-initiated live chat. The
  Business plan was dropped (only PLUS and PREMIUM).

## 12. Where to look for what

| Question                                           | Look at                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| Is feature X in scope? Acceptance criteria?        | `docs/00-overview.md`, `docs/03-user-stories.md`            |
| Exact behaviour of scanner / owner / notifications | `docs/01-requirements.md` (IDs `SC-`, `OW-`, `NT-`)         |
| Data model                                         | `db/migrations/*.sql`, `apps/api/src/db/types.generated.ts` |
| Module design, security, infrastructure            | `docs/02-architecture.md`                                   |
| GDPR, retention, consent, billing law              | `docs/04-legal-privacy.md`                                  |
| Prices, plan limits, costs                         | `docs/05-business.md`, `packages/shared`, `app_settings`    |
| Operating incidents                                | `docs/runbooks/README.md`                                   |
| Security posture                                   | `docs/security/asvs-l2.md`, `apps/api/src/security/`        |
| Load results                                       | `load/README.md`                                            |
| Hardening status                                   | `docs/hardening-plan.md`                                    |
