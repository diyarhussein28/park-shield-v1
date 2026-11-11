# Back-office tools: metrics, audit stream, Zammad (Sprint 10)

## Metabase (US-43, AD-18)

- Metabase runs in the tools stack (`infra/ansible/roles/tools`) and reads the **read replica**.
- Connection: database `parkshield`, user `metabase_ro` (password `postgres_metabase_password` in
  the SOPS secrets), schema **`metrics`** only. The role has no privilege on any table, so it cannot
  read encrypted columns or any personal data; `back-office.test.ts` checks this for every table.
- Views (one question each, then one dashboard "Founders"):

| View | Metric |
| --- | --- |
| `metrics.revenue_by_plan` | live subscriptions, ARR and MRR (gross, after the first-year promo) |
| `metrics.churn_monthly` | active at month start, churned, churn rate |
| `metrics.delivery_daily` | alerts, reached ≥ 1 channel, acknowledged; target ≥ 99 % delivery |
| `metrics.message_cost_daily` | deliveries, failures and cost per channel |
| `metrics.activation_funnel` | paid → shipped → tested → second channel → emergency contact, by cohort |
| `metrics.ios_push` | iOS users and the share with working Push |
| `metrics.protection_score_distribution` | customers per protection score (0–100) |
| `metrics.refunds_monthly` | refunds per month and kind (gate G2: < 3 %) |

- Alert in Metabase: `delivery_daily.delivery_rate < 0.98` for yesterday → team channel.
- New metric = new view in a migration (`GRANT SELECT` to `metabase_ro`), never a grant on a table.

## Audit stream (US-42, AD-17)

- `audit_logs` rejects UPDATE, DELETE of rows younger than 12 months and TRUNCATE, for every role.
- The worker job `audit.stream` (every 5 s) copies rows that are at least 10 s old to the Object Lock
  bucket (`AUDIT_BUCKET`, COMPLIANCE mode, Terraform `storage.tf`). Each object
  `audit/YYYY/MM/DD/<first>-<last>.jsonl` starts with a header holding the previous object's SHA-256,
  so the objects form a chain. `run_retention()` only deletes audit rows that were already copied.
- Check: ops app → Audit-Log → "Kette prüfen" (POST `/ops/v1/audit/verify`). It walks the whole
  chain and compares every copied row still in the database. Run it monthly and after any incident.
- "Einträge warten auf die Kopie" for more than a minute: check the worker logs (`audit.stream`) and
  the S3 credentials; nothing is lost, the cursor continues where it stopped.

## Zammad (US-44, AD-20)

- The contact form (`/hilfe/kontakt`) creates tickets through the API (`ZAMMAD_TOKEN` of a technical
  agent). Tags: `topic_*`, `lang_*`, `signed_in`, the plan and `reply_48h` for Plus customers; set
  the 48-hour SLA in Zammad on the tag `plus`.
- Sidebar: in Zammad, add a ticket object attribute of type *URL* with the link template
  `https://<ops-domain>/zammad?email=#{ticket.customer.email}`. Agents open it from the ticket
  sidebar; the ops app shows the masked summary (logged as a read) and links to Customer 360.

## Kill switch during a provider outage (AD-15)

1. Ops app → Anbieter shows the failing provider; the team also gets an e-mail.
2. Einstellungen → Kill Switches → switch the channel off with a reason. All processes apply it
   within seconds (settings broadcast; 30 s cache as a fallback). Alerts go to the other channels,
   each skipped attempt is recorded as `suppressed` / `kill_switch`.
3. Switch it on again when the provider has recovered; both changes are in the audit log.
