// Scan-to-delivery report for a load-test run (US-45): how many alerts the run created, how many reached
// the owner, and how long that took (first successful delivery − alert created).
//   npm run load:report -- --since 2026-11-10T12:00:00Z [--wait 120]
// --wait keeps polling until every alert is delivered or the seconds are up (measures the backlog drain).
import { parseArgs } from 'node:util';
import pg from 'pg';
import { ensureLocalEnv } from './lib/env.ts';

ensureLocalEnv();
const { values } = parseArgs({
  options: { since: { type: 'string' }, wait: { type: 'string', default: '0' } },
});
if (!values.since) {
  console.error(
    'usage: npm run load:report -- --since <ISO time of the k6 start> [--wait <seconds>]',
  );
  process.exit(2);
}

interface Row {
  alerts: number;
  delivered: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  first: Date | null;
  last: Date | null;
  pending: number;
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const query = () =>
  db.query<Row>(
    `WITH a AS (
       SELECT a.id, a.created_at FROM alerts a
         JOIN vehicles v ON v.id = a.vehicle_id JOIN users u ON u.id = v.owner_user_id
        WHERE u.email LIKE 'load+%@example.test' AND a.created_at >= $1 AND NOT a.is_test),
     d AS (
       SELECT a.id, a.created_at, min(d.sent_at) AS first_sent FROM a
         LEFT JOIN alert_deliveries d ON d.alert_id = a.id AND d.status IN ('sent', 'delivered', 'read')
        GROUP BY a.id, a.created_at)
     SELECT count(*)::int AS alerts, count(first_sent)::int AS delivered,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY extract(epoch FROM first_sent - created_at)) AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM first_sent - created_at)) AS p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch FROM first_sent - created_at)) AS p99,
            max(extract(epoch FROM first_sent - created_at)) AS max,
            min(created_at) AS first, max(created_at) AS last,
            (SELECT count(*)::int FROM outbox_events
              WHERE topic = 'alert.dispatch' AND processed_at IS NULL) AS pending
       FROM d`,
    [values.since],
  );

const deadline = Date.now() + Number(values.wait) * 1000;
let r = (await query()).rows[0]!;
while (r.delivered < r.alerts && Date.now() < deadline) {
  await new Promise((ok) => setTimeout(ok, 2000));
  r = (await query()).rows[0]!;
}
await db.end();

const s = (v: number | null) => (v === null ? '–' : `${Number(v).toFixed(2)} s`);
const span = r.first && r.last ? (r.last.getTime() - r.first.getTime()) / 1000 : 0;
console.log(
  `alerts created        ${r.alerts}${span ? ` over ${span.toFixed(0)} s (${(r.alerts / span).toFixed(1)}/s)` : ''}`,
);
console.log(
  `reached the owner     ${r.delivered} (${r.alerts ? ((100 * r.delivered) / r.alerts).toFixed(2) : 0} %)`,
);
console.log(
  `scan → first delivery p50 ${s(r.p50)} · p95 ${s(r.p95)} · p99 ${s(r.p99)} · max ${s(r.max)}`,
);
console.log(`dispatch backlog      ${r.pending} events`);
process.exit(r.delivered === r.alerts ? 0 : 1);
