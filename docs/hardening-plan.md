# US-45 hardening plan (safe launch)

Acceptance (03-user-stories): pentest with no open critical/high findings, load test 200 alerts/s,
WCAG audit, runbooks, status page, permission review. Targets from 01-requirements §8: OWASP ASVS L2,
200 alerts/s peak and 10,000 scans/min (k6), availability 99.9 % scanner / 99.5 % portal / 99 % ops
(Better Stack + public status page).

Order: security first (pentest firms need lead time), then load, accessibility, operations.

**Status 2026-11-10: all seven packages are done in the repository.** What remains is outside it:
the external pentest, the pass/fail load run and the chaos drill on Hetzner staging, an independent
accessibility test with screen readers, the Better Stack account and rota, and real staff roles.

| # | Result | Where |
| --- | --- | --- |
| 1 | Done (commit 66dc8e2) | `docs/security/`, `apps/api/src/security/` |
| 2 | Local: 200 alerts/s and 10,000 scans/min, delivery p95 10 ms, 0 lost | `load/README.md` |
| 3 | 0 axe findings on every page (DE 1280 px, EN 320 px), text spacing, reduced motion, keyboard flows | `e2e/tests/a11y.spec.ts`, `/barrierefreiheit` |
| 4 | Seven runbooks | `docs/runbooks/README.md` |
| 5 | Local drill passed: 1,705 accepted, 0 lost, 0 doubled | `docs/runbooks/chaos-drills.md` |
| 6 | Better Stack module validates; burn-rate rules; worker heartbeat | `infra/monitoring`, `docs/runbooks/monitoring.md` |
| 7 | Review page, CSV, expiry job, reminders | ops `/mitarbeitende/pruefung`, `access-review.test.ts` |

| # | Work package | Done here | Needs outside |
| --- | --- | --- | --- |
| 1 | Security pre-pentest | ASVS L2 self-assessment and fixes; route × role authorisation matrix test for api-ops; rate-limit coverage of every public route; security headers and CSP on all three apps; Semgrep + OSV in CI; `security.txt`; pentest scope pack (threat model, accounts, URLs, out of scope) | Book the external pentest (incl. ops app); fix its findings |
| 2 | Load test | k6 scenarios in `load/` (scan page, alerts with dispatch, quick replies, owner portal); seed script for thousands of paid vehicles and codes; scan-to-delivery latency; fix bottlenecks (outbox concurrency, pool sizes, indexes) | Pass/fail run on Hetzner staging (token + cost) — decided 2026-11-10: local now, staging later |
| 3 | WCAG 2.2 AA | axe on every page in DE and EN, keyboard-only main flows, 200 % zoom, 320 px reflow, reduced motion; manual focus-order and label pass; update `/barrierefreiheit` | Optional external BITV test |
| 4 | Runbooks | WhatsApp failure with kill switch, DB outage and failover, abuse wave, fake decals, incident communication, on-call | Real on-call rota |
| 5 | Chaos drills | Scripts that kill worker / Valkey / Postgres during alerts and check that nothing is lost and the outbox catches up | Repeat on staging |
| 6 | Status page and monitoring | Better Stack monitors and status page as Terraform; error-budget alert rules | Better Stack account and API token |
| 7 | Permission review | Quarterly staff/roles/last-sign-in report, automatic expiry of inactive staff, review recorded in the audit log | Assign real staff roles |

Also outside the code before launch: WhatsApp template approval by Meta, the lawyer's sign-off on
withdrawal wording and Wertersatz, real company data for the Impressum and credit notes.
