# Database outage (SEV1)

PostgreSQL holds everything that matters (alerts, outbox, subscriptions). While it is unreachable the
scanner page answers "Das hat nicht geklappt. Bitte versuchen Sie es erneut." and no alert is created;
nothing accepted earlier is lost: undelivered alerts sit in the outbox and go out when it is back
(chaos drill, see [chaos-drills](chaos-drills.md)).

## Recognise it

- Better Stack: "API (database and Valkey)" red (`/v1/ready` fails), worker heartbeat missing.
- Logs: `database connection lost`, `ECONNREFUSED`, `too many connections`, `canceling statement`.

## Decide quickly

| Symptom | Likely cause | Go to |
| --- | --- | --- |
| Primary host down / not reachable | Server or volume failure | Failover |
| Primary up, connections refused | `max_connections` reached, PgBouncer/pool exhaustion | Connections |
| Primary up, queries slow | Long query, lock, autovacuum, disk I/O | Slow |
| Disk full | WAL piling up (archive failing), bloat | Disk |

## Failover to the replica

Only if the primary will not be back within ~15 minutes (RTO ≤ 1 h, RPO ≤ 5 min).

1. Make sure the old primary cannot come back by itself: power it off in the Hetzner console.
2. On the replica: `sudo -u postgres pg_ctlcluster 18 main promote` (or `pg_ctl promote`).
3. Point the apps to it: set the db host in the Ansible inventory (`groups['db']` primary entry) and run
   `infra/scripts/deploy.sh <env>`; or, for speed, edit `/opt/parkshield/app.env` on app, worker and
   tools hosts and `docker compose up -d`.
4. Check: `/v1/ready` green, a test scan of the status-check decal delivers, outbox backlog shrinks:
   `SELECT count(*) FROM outbox_events WHERE processed_at IS NULL;`
5. Within a day: build a new replica from the backup (`postgres` role, `db_role: replica`) and run a
   restore drill ([restore-drill](restore-drill.md)).

## Connections

`SELECT state, count(*) FROM pg_stat_activity GROUP BY 1;` If `idle in transaction` dominates, find
the application and restart it (`docker compose restart api` / `worker`). Each process uses at most
10 connections; two app servers + worker + api-ops = 40 of 100.

## Slow

`SELECT pid, now() - query_start AS age, state, left(query, 80) FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC LIMIT 10;`
Cancel a runaway query with `SELECT pg_cancel_backend(<pid>);` (never on `autovacuum` of
`alerts` unless the disk is full).

## Disk

`df -h /var/lib/postgresql`. If WAL fills the disk, the archive to the backup bucket is failing:
check `pgbackrest --stanza=main check` and the S3 credentials. Do not delete WAL files by hand.

## After

- Outbox: `SELECT topic, count(*) FROM outbox_events WHERE processed_at IS NULL GROUP BY 1;` must go to
  zero within minutes. Events parked after 10 attempts (`attempts >= 10`) need a look; reset with
  `UPDATE outbox_events SET attempts = 0, available_at = now() WHERE id = …` once the cause is fixed.
- Audit stream: ops app → Audit-Log shows "Einträge warten" for a moment, then catches up.
