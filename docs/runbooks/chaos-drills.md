# Chaos drills (US-45)

Goal: while alerts keep coming in, losing the worker, Valkey or PostgreSQL must not lose an alert the
API accepted, and must not notify anyone twice. Run quarterly on staging and after changes to the
worker, the outbox or the database setup.

```bash
npm run load:seed -- --vehicles 500
npm run chaos:drill
```

The drill sends 20 alerts/s for about 90 seconds and, on the way:

| Time | Fault | How (local default) | Staging |
| --- | --- | --- | --- |
| 10 s | Worker killed | `Stop-Process` on `dist/worker.js` | `CHAOS_WORKER_STOP="ssh worker docker compose kill worker"` |
| 25 s | Worker back | starts `node dist/worker.js` | `CHAOS_WORKER_START="ssh worker docker compose start worker"` |
| 40 s | Valkey drops every client and stalls 10 s | `CLIENT KILL TYPE normal`, `CLIENT PAUSE 10000 ALL` | same, against the worker's Valkey |
| 60 s | PostgreSQL refuses connections for 15 s, all open connections cut | `ALLOW_CONNECTIONS false` + `pg_terminate_backend` | `CHAOS_DB_ADMIN_URL` with a superuser |

It passes when every accepted alert (HTTP 201) has a successful delivery within 3 minutes and no
alert has two successful deliveries on the same channel and device.

Locally the drill leaves its own worker running (pid in `.local/load/drill-worker.pid`): stop it and
restart `npm run dev` afterwards.

## What makes it pass

- Outbox leases (`locked_until`, 30 s): events a dead worker held come back by themselves.
- Dispatch is idempotent per alert, channel and device (`alreadySent`), so a retried event does not
  send twice.
- The database pool survives cut connections (`pool.on('error')`; without it the process crashed).
- The outbox `LISTEN` connection reconnects after 5 s; polling covers the gap.
- Valkey commands queue while it is unreachable (`maxRetriesPerRequest: null`).

During the PostgreSQL outage new alerts are refused (HTTP 500 → the scanner page shows "Das hat nicht
geklappt. Bitte versuchen Sie es erneut."). They are not lost silently; the scanner sees the error.

## Log

| Date | Environment | Accepted | Refused during outage | Lost | Doubled | Result | By |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-10 | Local (Windows dev stack, embedded PostgreSQL 18, Memurai) | 1,705 | 26 (PostgreSQL outage) | 0 | 0 | Pass | Claude (US-45) |
