# ParkShield — project status and team notes

The living status of the go-live: what is done, what is next, the decisions taken and the
test-only relaxations that must be undone before launch. It replaces notes that used to live only
on one laptop, so **everyone (and every AI agent) on every machine reads the same state**.

**Keep it current.** Whoever finishes a step updates this file in the same commit and pushes to
`main`. Dates are absolute (YYYY-MM-DD).

> The repository is **public**. Never write secrets, keys, passwords, customer data, phone numbers
> or e-mail addresses of real customers here. Names of env vars are fine; their values are not.

_Last updated: 2026-11-25 (Android test findings: no subscription was lost — withdrawn, moved and sandbox-expired; the app now says why a plan ended and names store purchase errors; Play's „item could not be found“ is a test set-up issue; `docs/handover.md` §17, not deployed yet). Before: 2026-11-25 (test server runs `162ec31`: one logo source, pages open at the top). Before: 2026-11-25 (QA decisions: the first „Sperren“ is not held by the 10-day wait, paywall, receipt print/PDF, localized page titles, worker warn; `docs/handover.md` §15b). Before: 2026-11-25 (full QA run on web, iOS, Android, e-mails and ops; fixes and open findings in `docs/handover.md` §15). Before: 2026-11-24 (`/aktivieren` → app, `/antwort` removed, first code never waits; `docs/handover.md` §14). Before: 2026-11-24 (app first, all four phases done incl. the app screens). Before: 2026-11-24 (phase 3: paid 3 € new code through Stripe). Before: 2026-11-24 (phase 2: new-code rules in the API). Before: 2026-11-24 (phase 1: the website lost sign-in, portal and checkout). Before: 2026-11-24 (`park-shield.de` DNS now on the server, Vercel no longer serves it). Before: 2026-11-24 (`__Host-` cookies; Vercel dropped, public pages of `park-shield.de` from the server). Before: 2026-11-24 (website e-mail change, trusted-contact clean-up migration, ops subscription source, Google Play pause; `docs/handover.md` §12). Before: 2026-11-22 (unified billing RevenueCat + Stripe and the personalised sticker, see §3)._

---

## 1. Go-live plan

| #   | Step                                                                           | State                                                      |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | Rent the server (Contabo)                                                      | ✅                                                         |
| 2   | Server preparation and first test deploy                                       | ✅                                                         |
| 3a  | Code decisions for production                                                  | ✅                                                         |
| 3b  | Object storage (audit bucket, backups)                                         | ✅                                                         |
| 3c  | Real provider keys on the test server                                          | ✅ except **Friendly Captcha** (decision postponed)        |
| 3d  | Ops app on the server, full end-to-end test                                    | ✅ — production switch itself still open (see §5)          |
| 4   | Real keys for launch (Stripe **live**)                                         | open                                                       |
| 5   | Move `park-shield.de` DNS from Vercel to the server, legal texts, go live      | open                                                       |
| 6   | 100 QR decal designs with different phrases                                    | open                                                       |

## 1a. Single plan on the test server (2026-11-21/22)

Deployed `1e9bc1c` on 2026-11-21 (code = `e19a9e4`); migrations `20261206000000`, `…0100`, `…0200`
applied, all test subscriptions are `standard` / `annual`. All old test customers (7) were deleted on
2026-11-21 with their Stripe test subscriptions; the two staff accounts were kept.

Real run on https://test.park-shield.de (website in Chrome, app in the iOS simulator via Expo Go):

| Step | Result |
| ---- | ------ |
| Home page | only „ParkShield 20 € / Jahr inkl. 19 % MwSt.“, no Plus/Premium |
| Sign-up (website magic link, app 6-digit code) | ✅ |
| Name, address, required mobile number | ✅ landline rejected, real Twilio Verify SMS code accepted |
| Paywall and Stripe test payment (in the app) | ✅ subscription `standard`, `annual`, 365 days |
| Vehicle + QR code | ✅ one vehicle, add form hidden afterwards |
| Print | ✅ self-print free (80 × 80 mm, PDF/PNG/SVG); welcome print ordered free, next one shows 3 € |
| Scan + alert | ✅ „Genuine page: park-shield.de“, 110/112 hint, no alert e-mail |
| Escalation | ✅ reminder stage after 10 min, **one** SMS after 30 min, delivered |
| Block sender | ✅ app „Absender blockiert – Chat beendet“, scanner page „Der Chat wurde beendet“, timers cleared |
| Sperren + new code | ✅ four-fact dialog, old code „nicht aktiv“, „Neuen Code erstellen“ works, same design |

Not verified yet: push on a real device (needs the new EAS build, `docs/handover.md` §6), the 3 € paid
print. Open findings: `docs/handover.md` §6 item 6.

## 2. Test server

- **Contabo Cloud VPS** in Germany, Ubuntu 24.04. Address: the A record of `test.park-shield.de`.
- **Login:** SSH as `root` with a personal key only (passwords are off). ufw allows 22/80/443,
  fail2ban bans IPs after repeated failed logins. Every person uses **their own key**; keys are
  never shared or copied between people.
- **Stack:** `infra/single` (Docker Compose + Caddy) in `/opt/parkshield/src/infra/single`.
  Deploy with `infra/single/deploy.sh root@<server>` (see `infra/single/README.md`).
- **Secrets** live only on the server in `infra/single/server.env` and `.env` (never in git, never
  in chat). They are edited on the server, e.g.
  `ssh -t root@<server> 'nano /opt/parkshield/src/infra/single/server.env'`.
- **Test site:** https://test.park-shield.de, behind basic auth (`APP_ENV=ci`); the scanner flow
  and `/v1/webhooks/*` are exempt. Since 2026-11-24 `park-shield.de` (and `www`, 301 to it) points to
  this server, which shows only the public pages there (Caddyfile `{$PUBLIC_DOMAIN}`, `infra/single/README.md`
  „Public website on park-shield.de“); sign-in, portal, scanner and `/v1` redirect to the home page until
  go-live. The Vercel project is no longer used (delete it, see `docs/handover.md` §13).
- **Ops app (back office):** since 2026-11-18 at **https://ops.test.park-shield.de** (test server
  only): the test site's basic auth first, then your staff passkey. `OPS_BASE_URL` is that URL, so
  passkeys registered for `localhost` no longer work; each person needs a new invite. Undo before
  go-live (§4). Services `ops` (:3001) and `ops-api` (:4001) still listen on 127.0.0.1 only;
  public `/ops/*` on the main site answers 404. The SSH tunnel below was the way in until then:

  ```bash
  while true; do ssh -N -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -L 3001:127.0.0.1:3001 root@<server>; sleep 3; done
  ```

  then http://localhost:3001. Stop a local `npm run dev` first (it uses port 3001 too). Each staff
  member gets their own invite (`bash infra/single/ops-invite.sh <email> "<name>" <role…>` on the
  server) and registers their own passkey. Shared staff accounts are not allowed (audit log).
- **Object storage:** Contabo (`eu2`): bucket `parkshield-audit` (Object Lock, COMPLIANCE) and
  `parkshield-backups` (nightly encrypted `pg_dump`, 03:15, with a restore check). The backup
  encryption key is on the server and kept offline by the owner.

### Providers on the test server

| Provider         | State                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| Stripe           | **test mode** keys, single yearly price **19,99 €** (`STRIPE_PRICE_YEARLY` = `price_1UfUvLFjhnZQE717fgQNDj4f`, tax-inclusive, set and deployed 2026-11-25 with `674c6e9`; the old 20 € price stays for the 3 existing test subscriptions), webhook → `https://test.park-shield.de/v1/webhooks/stripe` (5 events), signed delivery verified |
| E-mail           | **Mailjet** (`MAIL_PROVIDER=mailjet`), tracking off per message, SPF + DKIM green        |
| SMS              | Twilio, sender ID `ParkShield`, Trust Hub business profile approved, delivery verified; Verify service for owners' and scanners' numbers (`TWILIO_VERIFY_SERVICE_SID`, 2026-11-21) |
| ~~WhatsApp~~     | **Removed 2026-12** (no Meta dependency; was: **Twilio** (`WHATSAPP_PROVIDER=twilio`, 2026-11-18): Meta business verified, sender `ParkShield` online, all 8 content templates approved (`ps_test` uses the `ps_test_v2_*` SIDs), sender webhook → `https://test.park-shield.de/v1/webhooks/twilio/whatsapp`. End-to-end test passed (link number, alert, reply button). Profile: logo, description, park-shield.de, contact e-mail. Photo alerts use `ps_alert_photos_test_*` (URL button to the test domain; submitted 2026-11-18). The chat header shows the number, not the name, until Meta grants an official business account (needs a messaging limit above 250) Before the removal, from 2026-11-18 ~20:15 every WhatsApp alert failed with Twilio 63112 (Meta disabled the WhatsApp Business Account); `eacc3b4` added the fallback to the next channel, which the dispatcher keeps for late SMS failures) |
| RevenueCat       | project „ParkShield“ (entitlement `parkshield_pro`, Test Store product `yearly`), v1 secret key and webhook → `https://test.park-shield.de/v1/webhooks/revenuecat` (Authorization secret in `server.env`), test event received 2026-11-22; App Store / Play apps not connected yet |
| Print            | `PRINT_PARTNER=manual`                                                                  |
| Support          | `SUPPORT_PROVIDER=email` → `contact@park-shield.de`                                      |
| Friendly Captcha | **fake** — decision pending (EU endpoint needs the Advanced plan)                       |

**Verified end to end (2026-11-15):** sign-up, Stripe test payment (Plus active), vehicle, scan,
e-mail and SMS delivery. Urgent alerts and tests go to all channels; normal alerts follow the
owner's channel order and stop at the first success.

### DNS (Strato)

Records in use: `test` A record, Mailjet validation TXT and `mailjet._domainkey`, root SPF TXT
`v=spf1 include:_spf.strato.com include:spf.mailjet.com ~all` (Strato's own SPF rule is switched
off on purpose). **Never touch** the existing DMARC (`p=reject`) and MX (`smtpin.rzone.de`)
records. Old SendGrid and Brevo records stay but are unused.

## 3. Decisions

- **First „Sperren“ without the 10-day wait (2026-11-25).** Owner decision on the QA finding: while a
  vehicle has had only its first code and that code is locked, a new code (free once per subscription
  year, or 3 € with the printed sticker) is possible at once; every later new code waits 10 days as
  before (`docs/handover.md` §15b). Not deployed yet.

- **Price 19,99 € everywhere (2026-11-25).** Owner decision: the plan costs 19,99 € / year incl. 19 % MwSt.
  on the website, in the app (Stripe) and in the stores alike (was 20,00 € on Stripe and 19,99 € in the
  stores). Code default `PLAN_PRICE_CENTS` / setting `prices.plan_year_cents` = 1999; texts, AGB, help and
  tests updated. Test server done 2026-11-25 (new test price, deployed `674c6e9`); open: the same 19,99 € price in **live** mode before go-live;
  lawyer to confirm the AGB change (`LEGAL_REVIEW.md` §14 item 6 resolved: no channel difference any more).

- **App first, paid new code, 10-day cooldown (2026-11-24).** Owner decisions (task in four phases,
  `docs/handover.md` §14): registration, sign-in, the owner portal and billing live in the app; the
  website is the showcase plus scanner, help, legal pages and the flows that need no sign-in
  (`/kuendigen`, `/widerrufen`, `/v/*`, `/app/*`, `/.well-known/*`). Subscription billing is unchanged
  (RevenueCat in the stores, Stripe in the app). „Sperren“ stays free and immediate. A new code: free
  **once per subscription year after a „Sperren“**, otherwise **3 € = new code + printed and shipped
  sticker**, paid **only through Stripe** (physical product, never in-app purchase). At most one new code
  per vehicle every **10 days** (setting). After a payment the code is always issued; a refund never
  revokes it. **All four phases done 2026-11-24** (website; API rules, migration
  `20261211000000_code_issuances`; 3 € Stripe flow, migration `20261211000100_paid_new_code`, Customer
  360; app screens). Same day: `/aktivieren` and `/antwort` removed from the website (partner decals
  are set up in the app), no passkey UI on the website, the first code never waits. Not deployed yet:
  API deploy + new EAS build.
  Lawyer: `LEGAL_REVIEW.md` §14.
- **Vercel dropped, `__Host-` cookies (2026-11-24).** The website moves to our own server: until
  go-live the test server shows only the public pages on `park-shield.de` (Caddyfile `{$PUBLIC_DOMAIN}`);
  steps in `infra/single/README.md`. Session cookies carry the `__Host-` prefix on every https
  production origin (the test server too, after its next deploy: everyone signs in once more).
- **Unified billing and the personalised sticker (2026-11-22).** Option A: our backend is the
  entitlement hub — RevenueCat (App Store / Google Play) and Stripe webhooks update one `subscriptions`
  record (`provider`, unified status ACTIVE / CANCEL_SCHEDULED / BILLING_ISSUE / EXPIRED / REFUNDED /
  WITHDRAWN); app, website and scanner read only it. Subscriptions in the app via in-app purchase
  (RevenueCat), on the web via Stripe; 3 € prints always Stripe. The printed sticker is personalised
  (vehicle label + design, frozen at a confirmation step) and excluded from withdrawal (§ 312g Abs. 2
  Nr. 1 BGB); its value 3 € (`prices.sticker_value_cents`) is shown in the price and kept on a Stripe
  withdrawal after personalisation (formula in `docs/billing-unified.md` §4). Migration
  `20261208000000_unified_billing`. Open: RevenueCat/App Store/Play accounts and keys
  (`docs/handover.md` §8), lawyer `LEGAL_REVIEW.md` §12.
- **Single plan, app-only alerts, SMS escalation, Sperren, print (2026-11-21).** Task:
  `docs/single-plan-update-prompt.md`; progress and design notes: `docs/handover.md`. One plan
  „ParkShield“ 20 € / year incl. VAT for **one vehicle** (Plus/Premium removed; all test subscriptions
  moved to it and to yearly renewal — lawyer approval of yearly renewal reported 2026-11-21). Mobile
  number **required** and verified (Twilio Lookup + Verify). Alerts reach the owner **by app push only**
  (no alert e-mail); reminder push after 10 min, **one** SMS after 30 min (never in quiet hours, never
  for tests, cap 20 / month). **Trusted contacts removed** with their data. „Sperren“ creates no new
  code; a new code is free; self-print free; printed and shipped decal free once (welcome print), then
  3 €. „Absender blockieren“ ends the chat and the escalation. Scanner authenticity notice
  „Nur echt auf park-shield.de“; production `SCANNER_BASE_URL=https://park-shield.de`.
  Migrations `20261206000000_single_plan`, `20261206000100_owner_escalation`,
  `20261206000200_block_sender`. **Implemented and tested 2026-11-21** (API 505, app 148, E2E 111
  green, real-user run passed); **not deployed yet** — see §4 item 9 and `docs/handover.md` §6.
- **App redesign, sign-up with address, Face ID lock (2026-11-20/21).** Implemented as decided in
  `docs/app-redesign.md` §7 (tabs Start · Warnungen · Fahrzeuge · Konto, onboarding, sign-up before
  payment with name and address, blocking „Konto vervollständigen“ for old accounts, welcome letter
  always to the sign-up address and only automatic for new sign-ups, Face ID lock after
  `app.lock_after_seconds` = 300 s, alerts from notifications open unlocked). Checkout and renewal
  need the profile (API `profile_incomplete`), on the website too. New table `user_profiles`
  (migration `20261205000000_user_profiles`, every field encrypted). QA report:
  `docs/app-redesign-qa.md`; open legal points: `LEGAL_REVIEW.md` §8. **Deployed to the test server
  2026-11-21 (`afaebdb`)**: migration applied, `app.lock_after_seconds` = 300; the app itself needs
  a new build (EAS) to reach testers — Face ID works only in a development or store build.
- **Alert photos in both plans (2026-11-20).** „Fotos bei Warnungen“ is part of Plus and Premium:
  `photos.plans` defaults to `["plus","premium"]` (migration `20261203000000_photos_all_plans`) and
  both plans list it on the pricing page. The feature itself stays behind `ALERT_PHOTOS_ENABLED`
  until the launch checklist (§4a) is done. The owner can also report abuse from the app's alert
  screen; photo uploads are limited per network (`ratelimit.scan.upload_ip`) before the upload is read.
- **Opening the chat stops the owner reminder (2026-11-20).** An owner who opened the live chat had
  clearly seen the alert, yet still got the 3-minute reminder ("You have not responded"). Now
  `ChatService.open` clears `remind_at`. The escalation to trusted contacts is unchanged: the owner
  may write "I can't come", so only „Ich komme" acknowledges the alert and stops the chain.
- **E-mail → Mailjet (2026-11-15).** SendGrid has no free plan; Brevo rewrites links and adds an
  open pixel and turns that off only for Enterprise. Our privacy policy promises no tracking and
  magic links must not pass through a tracking redirect.
- **Support desk (2026-11-16).** Contact form by e-mail until shortly before the paid beta, then
  Zammad Cloud Starter (1 agent, German data centre). No ticket system of our own (it is on the
  "will not build" list; it would need an ADR).
- **Ops app (2026-11-16).** Always German, dashboard with counts per permission
  (`GET /ops/v1/overview`, audited). The owner's staff account holds superadmin + admin +
  abuse_moderator (all 15 permissions; since 2026-11-18 admin also has the 2 letter permissions).
- **The app is the whole portal, with Stripe in the app (2026-11-19).** Every `/konto/*` page exists in
  the app with the website's texts; the subscription is paid on Stripe's page inside the app (owner's
  choice, App Store review risk in `LEGAL_REVIEW.md` §7). On the test server, API calls with the app's
  bearer session pass Caddy's basic auth (`infra/single/Caddyfile`).
- **Welcome letter (2026-11-18).** Printed letter for every new customer (paid + first vehicle),
  downloaded in ops and posted. Staff who print letters and QR codes see full name, address,
  plate and code: new permission `letters.print` (admin, fulfillment; not support), every
  preview and download audited. Address = decal-order shipping address, else Stripe billing
  address (stored only in the encrypted letter snapshot). PDF via pdfkit (no Puppeteer/Chromium).
  Live on the test server since 2026-11-18 (`7029997`, migration `20261130000000_welcome_letters`).
  Customers who already had a paid plan and a vehicle get no automatic letter (no event was
  queued for them): use „Neu erstellen“ on their customer page. Open: lawyer check of letter
  content and footer (`LEGAL_REVIEW.md` §6).
- **Renewal for consumers → yearly (2026-11-18).** The owner chose `renewal.mode_b2c = annual`
  (now the code default): 10 € / 15 € charged once a year; a cancellation ends the contract at the
  end of the paid year, nothing is charged after that. Chosen knowing that § 309 Nr. 9 BGB makes a
  12-month tacit extension likely invalid for consumers; the lawyer must confirm
  (`LEGAL_REVIEW.md` §1). Stripe needs no change (yearly prices only, portal cancellation off).
  Existing test subscriptions on the test server keep `monthly_after_first_term`.

## 4. Undo before go-live

Relaxed only for testing on the test server. Restore every item before step 5:

1. **Scanner wait between alerts** is 1 minute for testing (`app_settings` key
   `ratelimit.alert.scanner_vehicle` = `{"max":1,"windowSeconds":60}`). Restore the 15-minute
   default: `DELETE FROM app_settings WHERE key = 'ratelimit.alert.scanner_vehicle';` and restart
   `api` and `worker`.
2. **Test stack mode:** `APP_ENV=ci`, `SITE_NOINDEX=1` and Caddy basic auth. Production needs
   `APP_ENV=production`, no basic auth, a real captcha and Stripe **live** keys.
3. **Alert photos** are switched on for testing: `ALERT_PHOTOS_ENABLED=true` in `server.env` and
   `app_settings` key `photos.plans` = `["plus","premium"]`. For launch: off until the legal review
   (`LEGAL_REVIEW.md` §5) and the launch checklist (§4a), then on for Plus and Premium (the default
   since migration `20261203000000_photos_all_plans`; the setting needs no change).
4. Impressum and legal pages reviewed by the lawyer; then remove `SITE_NOINDEX` and the `X-Robots-Tag`
   line of the Caddyfile's public `park-shield.de` block.
5. **WhatsApp removed** (2026-12): delete `WHATSAPP_PROVIDER`, `TWILIO_WHATSAPP_FROM`,
   `TWILIO_CONTENT_*` and `D360_*` from `server.env`; disconnect the WhatsApp sender in Twilio.
6. **App push**: Firebase project and `FCM_*` in `server.env` (real production refuses to start
   without them); Caddy now also lets `/v1/app/*`, `/v1/socket.io`, `/v1/contacts/*`, `/k/*`, `/app/*`
   and `/.well-known/*` past basic auth (the native app cannot send basic auth).
7. **Ops app on a public subdomain** (`ops.test.park-shield.de`, 2026-11-18): production keeps the
   back office off the internet (VPN only, AD-01). Remove the `{$OPS_DOMAIN}` block from the
   Caddyfile and `OPS_DOMAIN` from `.env`, point `OPS_BASE_URL` at the VPN-only address, invite
   staff again (passkeys bind to that host) and delete the `ops.test` DNS record
   (`infra/single/README.md`, "Test server: ops app on its own subdomain").

8. **Sign-up with name and address** (live on the test server since 2026-11-21): existing test
   accounts are asked for name and address on the next app start and before any website checkout.
   Before go-live: the privacy policy needs the new section on name/address (`LEGAL_REVIEW.md` §8),
   and the store privacy labels must list name and address.

10. **RevenueCat (2026-11-22):** `REVENUECAT_SECRET_KEY` and `REVENUECAT_WEBHOOK_AUTH` must be set
   (real production refuses to start without them); App Store / Play products live, sandbox off.

9. **Single plan (2026-11-21):** on the test server done 2026-11-21: `STRIPE_PRICE_YEARLY` (20 €, test
   mode) set and the old `STRIPE_PRICE_PLUS_*` / `STRIPE_PRICE_PREMIUM_*` removed, `TWILIO_VERIFY_SERVICE_SID`
   set, new EAS build made. **Before go-live:** a live 19,99 € price, `SCANNER_BASE_URL=https://park-shield.de`
   and, if decals with `pkshd.de` exist, a 301 from `pkshd.de/s/*` to `park-shield.de/s/*`.

## 4a. Launch checklist

Tick each item (with the date) before go-live; alert photos stay off (`ALERT_PHOTOS_ENABLED=false`)
until all three are done.

- [ ] **Real captcha keys on production:** `FRIENDLY_CAPTCHA_SITEKEY`, `FRIENDLY_CAPTCHA_API_KEY`,
      `NEXT_PUBLIC_FRIENDLY_CAPTCHA_SITEKEY` set, endpoint `eu`. No fake captcha in production.
- [ ] **Privacy policy section `/datenschutz#warnfotos` exists** (text comes from the lawyer). The
      scanner page's camera notice already links to it (`LEGAL_REVIEW.md` §5).
- [ ] **DPIA decision documented** (a DPIA or a written threshold assessment, `LEGAL_REVIEW.md` §5).

## 5. Next steps

1. Friendly Captcha decision (Advanced plan for the EU endpoint, or another solution).
2. Production switch on the server (§4) and Stripe live keys.
3. DNS switch of `park-shield.de` to the server.
4. 100 decal designs.

## 6. Working together

- **Before you start:** `git pull`. Push small commits to `main`; pull again before pushing.
  Agree who works on which area so two people do not edit the same files at once.
- **Deploying:** push to `main`, then `infra/single/deploy.sh root@<server>`. It ships exactly
  `origin/main` (never your local files), refuses anything that would roll back what is live, lets
  only one person deploy at a time and logs every deploy on the server (`/opt/parkshield/deploys.log`).
  Details in `infra/single/README.md`. Tell the others when you deploy.
- **Manual test of every feature on the test server:** [`docs/test-guide.md`](test-guide.md).
- **Secrets:** never in git, chat or messengers. Locally each person has their own `.env`
  (`npm run dev` creates it and every provider falls back to a fake). Provider accounts (Stripe,
  Twilio, Mailjet, Contabo, Strato) invite each person as a team member with their own login.
- **Local E2E with real keys in `.env`:** start dev with the provider keys emptied so the fakes are
  used, in Git Bash (PowerShell drops empty variables, and the real keys from `.env` come back):
  `STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= FRIENDLY_CAPTCHA_SITEKEY= FRIENDLY_CAPTCHA_API_KEY= NEXT_PUBLIC_FRIENDLY_CAPTCHA_SITEKEY= TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= MAILJET_API_KEY= MAILJET_SECRET_KEY= ALERT_PHOTOS_ENABLED=true npm run dev`.
  Without the two `MAILJET_*` the test e-mails go out through the real Mailjet; without
  `ALERT_PHOTOS_ENABLED=true` the photo E2E (`e2e/tests/alert-photos.spec.ts`) is skipped.
- **AI agents:** read `AGENTS.md` and this file first, verify facts on the server instead of
  trusting notes blindly, and update this file when a step is done. The owner wants answers in
  Arabic, one step at a time, asking before the next step.
