# Monitoring and status page (US-45)

Two layers:

| Layer | What | Where |
| --- | --- | --- |
| Outside-in | Scanner page of a status-check decal, `/v1/ready`, portal, TLS expiry; worker heartbeat; on-call paging; public status page | Better Stack, `infra/monitoring` (Terraform) |
| Inside | Error-budget burn rates (99.9 % scanner, 99.5 % portal), host down, backups, disk | Prometheus + Alertmanager → team Telegram, `infra/ansible/roles/monitoring` |
| Business | Provider health (WhatsApp quality, failure rates, Stripe webhooks, stuck print jobs) | ops app → Anbieter, mail to `ops.alert_email` |
| Metrics | Delivery rate (< 98 % alert), activation funnel, costs | Metabase on the replica ([back-office](back-office.md)) |

## Set up Better Stack (once per environment)

1. Create the Better Stack team, invite the on-call people, set up the weekly rota.
2. Create the status-check customer in the environment: a paid internal account with one vehicle
   "Status-Check" and an active decal; keep its code in the SOPS secrets (`canary_code`). Its alerts
   go to the team inbox, never to a real person. Quiet hours: never.
3. `cd infra/monitoring && terraform init -backend-config=backend.hcl` (state key
   `monitoring/<env>.tfstate`), then
   `terraform apply -var environment=production -var domain_web=parkshield.de -var domain_scanner=s.parkshield.de -var canary_code=… -var betterstack_api_token=…`
4. Put the output `worker_heartbeat_url` into `app_env.HEARTBEAT_URL_WORKER` and deploy. The worker
   reports every minute while its queue moves; a stuck queue counts as down.
5. DNS: `status.parkshield.de` CNAME to Better Stack (shown in its status page settings).

Staging uses the same module without a status page and with 3-minute checks.

## Alert routing

| Alert | Severity | Goes to |
| --- | --- | --- |
| Scanner page, API ready, worker heartbeat | SEV1 | On-call: push + call (production) |
| Portal, TLS | SEV2 | On-call: push + e-mail |
| ScannerBudgetFastBurn, PortalBudgetFastBurn, BackupStale, HostDown | critical | Telegram (team) |
| *SlowBurn, DiskAlmostFull | warning | Telegram (team) |
| Provider health | per check | E-mail `ops.alert_email` |
