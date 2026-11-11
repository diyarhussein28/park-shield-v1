# Load test (US-45)

Target (01-requirements §8): **200 alerts/s peak and 10,000 scans/min**, scanner page under 1.5 s,
≥ 99 % of alerts reaching at least one channel. Open model (constant arrival rate), rate limits on:
every iteration is a different scanner (own User-Agent), as with many people scanning many cars.

```bash
npm run load:seed -- --vehicles 2000      # paying customers with an active decal (fresh codes each run)
k6 run load/k6/peak.js                    # local: API :4000, web :3000 (use a production build, see below)
npm run load:report -- --since <START time printed by k6> --wait 120
npm run load:seed -- --clean              # remove the load-test customers again
```

Staging: `k6 run -e API=https://staging.parkshield.de -e WEB=https://staging-s.parkshield.de -e CAPTCHA=<test solution> load/k6/peak.js`.
Re-seed before every run: each decal accepts 20 alerts per day (`alert.vehicle`), and a seed issues
new codes. Never run against production.

## Results

Local, 2026-11-10, Windows laptop (embedded PostgreSQL 18, Memurai), API and worker in `npm run dev`,
scanner page from the production build (`next start`, port 3100). Indicative only: the pass/fail run
is on Hetzner staging.

| Run                                    | Alerts                       | Scanner page                          | Scan → first delivery                                   |
| -------------------------------------- | ---------------------------- | ------------------------------------- | ------------------------------------------------------- |
| Baseline (old outbox, `next dev` page) | 200/s, p95 6 ms              | p95 16 s (dev server; not meaningful) | p50 5.5 s, p95 9.2 s, 100 % delivered                   |
| Leased parallel outbox + NOTIFY        | 200/s, p95 6 ms              | 10,000/min, p95 11 ms                 | p50 0.01 s, p95 4.2 s (cold start only)                 |
| + pool warm-up at start                | 200/s, p95 5.4 ms, 0 errors* | 10,000/min, p95 10 ms                 | **p50 0.01 s, p95 0.01 s, max 0.16 s, 100 % delivered** |

\* One 429 out of 12,001: a decal that had collected more than 20 alerts across the day's runs.

## What changed because of it

- **Outbox** (`apps/api/src/worker/outbox.service.ts`): the worker leased 20 events inside one
  transaction and ran them one after another, polling once a second. Now it leases batches of 50
  (`locked_until`, 30 s), runs 8 handlers in parallel without a transaction, and a `NOTIFY` on insert
  wakes it at once. A crashed worker's events are picked up again when the lease runs out
  (at-least-once; see the chaos drills).
- **Pool warm-up**: a freshly started process opened its database connections one by one under the
  burst (about 400 ms each on Windows) and built a 7-second backlog. Processes now open the whole pool
  before taking work.
