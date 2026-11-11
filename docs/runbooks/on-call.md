# On-call (US-45)

## Rota and paging

- One person on call per week (Monday 09:00 to Monday 09:00, Europe/Berlin), one backup. The rota lives
  in Better Stack (`infra/monitoring`, policy "ParkShield on-call"): push and phone call to whoever is on
  call; after 10 minutes without acknowledgement, everyone on the team.
- Pages come from: Better Stack monitors (scanner page, API ready, portal, TLS) and the worker
  heartbeat; Prometheus/Alertmanager (error budgets, backups, disk, hosts) in the team Telegram channel;
  provider health e-mails from the ops app (`ops.alert_email`).
- Before your week: VPN works, you can sign in to the ops app with your passkey, you can SSH to the
  tools server, and you have read this page and the runbooks below.

## Severity

| Level | Examples | Response | Update cadence |
| --- | --- | --- | --- |
| SEV1 | Scanner page or alert delivery down for everyone; data leak suspected | Acknowledge in 5 min, work immediately, incident channel | Status page every 30 min |
| SEV2 | One channel down (WhatsApp, e-mail, push), degraded latency, abuse wave | Acknowledge in 15 min | Status page every 60 min |
| SEV3 | Portal or ops app partly broken, backup warning, single-customer issue | Next working hours | As needed |

Error budget (01-requirements §8): scanner path 99.9 % (43 min/month), portal 99.5 % (3.6 h/month),
ops app 99 %. A fast-burn alert means the month's budget is gone in a day at that rate: treat as SEV1.

## First 10 minutes

1. Acknowledge the page. Open the incident in the team channel: what, since when, who leads.
2. Check, in this order: Better Stack (which monitors are red), ops app → **Anbieter** (provider
   health), Grafana (app logs in Loki: `job=api|worker`), `docker compose ps` on app and worker hosts.
3. Pick the runbook:
   - WhatsApp, e-mail or push failing → [provider-outage](provider-outage.md)
   - Database unreachable, slow or full → [database-outage](database-outage.md)
   - Many alerts on one code, harassment, reports → [abuse-wave](abuse-wave.md)
   - Decals that are not ours → [fake-decals](fake-decals.md)
4. SEV1/SEV2: post on the status page within 15 minutes ([incident-communication](incident-communication.md)).
5. Write down every action with the time; it becomes the incident report.

## After the incident

Within 5 working days: short report (timeline, impact in alerts/customers, cause, what changes), no
blame. If personal data may have been exposed: tell the privacy lead at once; the 72-hour notification
deadline (Art. 33 GDPR) starts when we become aware.
