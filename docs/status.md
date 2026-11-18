# ParkShield — project status and team notes

The living status of the go-live: what is done, what is next, the decisions taken and the
test-only relaxations that must be undone before launch. It replaces notes that used to live only
on one laptop, so **everyone (and every AI agent) on every machine reads the same state**.

**Keep it current.** Whoever finishes a step updates this file in the same commit and pushes to
`main`. Dates are absolute (YYYY-MM-DD).

> The repository is **public**. Never write secrets, keys, passwords, customer data, phone numbers
> or e-mail addresses of real customers here. Names of env vars are fine; their values are not.

_Last updated: 2026-11-18._

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
  and `/v1/webhooks/*` are exempt. `park-shield.de` itself is still the Vercel website preview.
- **Ops app (back office):** not public. Services `ops` (:3001) and `ops-api` (:4001) listen on
  127.0.0.1 only; public `/ops/*` answers 404. Open it through an SSH tunnel:

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
| Stripe           | **test mode** keys, yearly price IDs, webhook → `https://test.park-shield.de/v1/webhooks/stripe` (5 events), signed delivery verified |
| E-mail           | **Mailjet** (`MAIL_PROVIDER=mailjet`), tracking off per message, SPF + DKIM green        |
| SMS              | Twilio, sender ID `ParkShield`, Trust Hub business profile approved, delivery verified |
| WhatsApp         | **Twilio** (`WHATSAPP_PROVIDER=twilio`, 2026-11-18): Meta business verified, sender `ParkShield` online, all 8 content templates approved (`ps_test` uses the `ps_test_v2_*` SIDs), sender webhook → `https://test.park-shield.de/v1/webhooks/twilio/whatsapp`. End-to-end test passed (link number, alert, reply button). Profile: logo, description, park-shield.de, contact e-mail. Photo alerts use `ps_alert_photos_test_*` (URL button to the test domain; submitted 2026-11-18). The chat header shows the number, not the name, until Meta grants an official business account (needs a messaging limit above 250) |
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

- **E-mail → Mailjet (2026-11-15).** SendGrid has no free plan; Brevo rewrites links and adds an
  open pixel and turns that off only for Enterprise. Our privacy policy promises no tracking and
  magic links must not pass through a tracking redirect.
- **Support desk (2026-11-16).** Contact form by e-mail until shortly before the paid beta, then
  Zammad Cloud Starter (1 agent, German data centre). No ticket system of our own (it is on the
  "will not build" list; it would need an ADR).
- **Ops app (2026-11-16).** Always German, dashboard with counts per permission
  (`GET /ops/v1/overview`, audited). The owner's staff account holds superadmin + admin +
  abuse_moderator (all 15 permissions; since 2026-11-18 admin also has the 2 letter permissions).
- **Welcome letter (2026-11-18).** Printed letter for every new customer (paid + first vehicle),
  downloaded in ops and posted. Staff who print letters and QR codes see full name, address,
  plate and code: new permission `letters.print` (admin, fulfillment; not support), every
  preview and download audited. Address = decal-order shipping address, else Stripe billing
  address (stored only in the encrypted letter snapshot). PDF via pdfkit (no Puppeteer/Chromium).
  Open: lawyer check of letter content and footer (`LEGAL_REVIEW.md` §6); deploy to the test
  server (migration `20261130000000_welcome_letters`).

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
   (`LEGAL_REVIEW.md` §5), then Premium only (`DELETE FROM app_settings WHERE key = 'photos.plans';`).
4. Impressum and legal pages reviewed by the lawyer; then remove `SITE_NOINDEX` on Vercel too.
5. **WhatsApp photo template** points to `test.park-shield.de`: before photos go live, create
   `ps_alert_photos_*` with `https://park-shield.de/v/{{6}}`, get it approved and replace
   `TWILIO_CONTENT_PS_ALERT_PHOTOS_*` in `server.env`.

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
  used, e.g. `STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= FRIENDLY_CAPTCHA_SITEKEY= FRIENDLY_CAPTCHA_API_KEY= NEXT_PUBLIC_FRIENDLY_CAPTCHA_SITEKEY= TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= npm run dev`.
- **AI agents:** read `AGENTS.md` and this file first, verify facts on the server instead of
  trusting notes blindly, and update this file when a step is done. The owner wants answers in
  Arabic, one step at a time, asking before the next step.
