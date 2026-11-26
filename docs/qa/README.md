# External QA — test cases

`ParkShield-Test-Cases.xlsx` is the test case file for an external testing company (2026-11-26):
213 cases in 23 modules (website, flows without sign-in, scanner, Protected Mode, photos, chat, app
onboarding, sign-in, payment, vehicles, decals, Sperren / new code, alerts, escalation, blocking,
notification settings, account, e-mails, back office, security, accessibility, performance,
compatibility). More than half are negative, edge, security, reliability or accessibility cases.

Sheets: „Read me“ (scope, environment, test data, expected test-server differences, reporting rules),
„Test cases“ (status dropdown, actual result, tester, defect ID), „Summary“ (formulas per module and
type), „Devices“ (device matrix), „Defects“ (defect log).

The file contains **no credentials**: basic auth, app build links and staff invites are sent to the
company separately.

To change cases, edit `cases.mjs` and rebuild (exceljs is not a repo dependency):

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null && npm i exceljs@4.4.0 && cp <repo>/docs/qa/*.mjs . && node build.mjs <repo>/docs/qa/ParkShield-Test-Cases.xlsx
```

Keep the cases in line with `AGENTS.md` and `docs/status.md` when features change.

## Results

`ParkShield-QA-Results-2026-11-26.xlsx` is the same file with the first full run filled in (189 Pass,
24 Blocked, 0 Fail, 5 fixed defects; `docs/handover.md` §20). It is generated from
`results-2026-11-26.mjs` by `fill.mjs` (same exceljs set-up as above, then
`node fill.mjs ParkShield-Test-Cases.xlsx ParkShield-QA-Results-2026-11-26.xlsx`).
