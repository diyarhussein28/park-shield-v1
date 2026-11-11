# ParkShield

QR decal that lets anyone alert a car owner without seeing their phone number. Specs: [`docs/`](docs/README.md).

**New here (human or AI agent)? Start with [`AGENTS.md`](AGENTS.md)**: project overview, layout, how
to run/test/build/deploy, hard rules, known traps and the open to-do list.

## Local development (Windows, macOS, Linux)

Requirements: Node.js 24+, and a Redis-compatible server on `VALKEY_URL` (Windows: Memurai Developer on port 6380; macOS/Linux: `valkey-server`). PostgreSQL 18 runs embedded from npm, with no install.

```bash
npm install
npm run dev
```

`npm run dev` creates `.env` from `.env.example` on first run (generating local keys), starts PostgreSQL 18 in `.local/pgdata`, applies migrations to the dev and test databases, and starts:

| Service                          | URL                                 |
| -------------------------------- | ----------------------------------- |
| Web (landing, scanner, portal)   | http://localhost:3000               |
| Design system                    | http://localhost:3000/design        |
| Ops app                          | http://127.0.0.1:3001               |
| Public API                       | http://127.0.0.1:4000/v1/ready      |
| api-ops (VPN-only in production) | http://127.0.0.1:4001/ops/v1/health |
| Worker                           | background process                  |

Provider sandbox keys (Stripe test mode, Brevo, 360dialog, Friendly Captcha) go into `.env`. While a key is empty, that provider uses a local fake adapter (never allowed in production):

| Fake                       | Where to see it                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| E-mail (Brevo)             | http://localhost:3000/dev/postfach — local inbox with magic links, receipts, confirmations         |
| Payments (Stripe)          | Checkout redirects to http://localhost:3000/dev/checkout, which simulates payment and PDF invoices |
| Captcha (Friendly Captcha) | Forms show "Sicherheitsprüfung: lokal simuliert"                                                   |

For the real Friendly Captcha widget, also set `NEXT_PUBLIC_FRIENDLY_CAPTCHA_SITEKEY` for the web app. Stripe webhooks locally: `stripe listen --forward-to localhost:4000/v1/webhooks/stripe` and put the printed secret into `STRIPE_WEBHOOK_SECRET`.

## Commands

| Command                               | What it does                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run lint` / `typecheck` / `test` | All workspaces (tests use the `parkshield_test` database and Valkey DB 1)     |
| `npm run e2e`                         | Playwright against the running stack (`npx playwright install chromium` once) |
| `npm run db:migrate`                  | Apply `db/migrations` (dbmate)                                                |
| `npm run db:check`                    | Schema check: up, `run_retention()`, rollback, up on a scratch database       |
| `npm run db:types`                    | Regenerate Kysely types from the live schema                                  |
| `npm run db:restore-drill`            | Local backup/restore drill ([runbook](docs/runbooks/restore-drill.md))        |
| `npm run db:start`                    | Only PostgreSQL                                                               |

## Layout

See [`docs/02-architecture.md` §6](docs/02-architecture.md). Infrastructure: `infra/terraform` (Hetzner), `infra/ansible` (configuration, deploys), `.github/workflows/ci.yml`.
