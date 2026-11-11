// Chaos drill (US-45): while alerts keep coming in, the worker is killed and restarted, Valkey drops
// every connection and stalls, and PostgreSQL refuses connections for 15 s. Afterwards every alert the
// API accepted must have reached its owner, and no owner may be notified twice on the same channel.
//   npm run load:seed -- --vehicles 500 && npm run chaos:drill
// Local defaults (Windows dev stack); on staging set the commands, e.g.
//   CHAOS_WORKER_STOP="ssh worker docker compose kill worker"
//   CHAOS_WORKER_START="ssh worker docker compose start worker"
//   CHAOS_DB_ADMIN_URL=postgres://postgres:…@db:5432/parkshield   (needs superuser for ALLOW_CONNECTIONS)
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Redis } from 'ioredis';
import pg from 'pg';
import { ensureLocalEnv } from './lib/env.ts';
import { ROOT } from './lib/paths.ts';

ensureLocalEnv();
const { values } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.CHAOS_API ?? 'http://127.0.0.1:4000' },
    rate: { type: 'string', default: '20' },
    captcha: { type: 'string', default: process.env.CHAOS_CAPTCHA ?? 'dev-captcha-ok' },
  },
});
if (process.env.APP_ENV === 'production') {
  console.error('refusing to run a chaos drill against production');
  process.exit(2);
}

const codes = JSON.parse(
  readFileSync(join(ROOT, '.local', 'load', 'codes.json'), 'utf8'),
) as string[];
const adminUrl = process.env.CHAOS_DB_ADMIN_URL ?? process.env.DATABASE_URL!;
const dbName = new URL(adminUrl).pathname.slice(1);
const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);

// ------------------------------------------------------------------------------------- traffic
const accepted: string[] = [];
const statuses = new Map<string, number>();
let n = 0;
const fire = async () => {
  // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_insecure_random_generator -- chaos drill picks a random decal
  const code = codes[Math.floor(Math.random() * codes.length)];
  try {
    const res = await fetch(`${values.api}/v1/scan/${code}/alerts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': `Mozilla/5.0 (Linux; Android 15; chaos-${n++}) Mobile Safari/537.36`,
      },
      body: JSON.stringify({ type: 'lights_on', captcha: values.captcha, lang: 'de' }),
      signal: AbortSignal.timeout(20_000),
    });
    statuses.set(String(res.status), (statuses.get(String(res.status)) ?? 0) + 1);
    if (res.status === 201) accepted.push(((await res.json()) as { alertId: string }).alertId);
  } catch {
    statuses.set('network', (statuses.get('network') ?? 0) + 1);
  }
};
const traffic = setInterval(() => void fire(), 1000 / Number(values.rate));

// ------------------------------------------------------------------------------------- faults
const sleep = (s: number) => new Promise((ok) => setTimeout(ok, s * 1000));

function stopWorker() {
  if (process.env.CHAOS_WORKER_STOP)
    return void execSync(process.env.CHAOS_WORKER_STOP, { stdio: 'inherit' });
  // Local: every node process running the API worker (the dev stack's and earlier drill workers).
  const out = execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'dist[/\\\\]worker\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }"`,
    { encoding: 'utf8' },
  );
  log(`worker killed (pid ${out.trim().split(/\s+/).join(', ') || 'none found'})`);
}

function startWorker() {
  if (process.env.CHAOS_WORKER_START)
    return void execSync(process.env.CHAOS_WORKER_START, { stdio: 'inherit' });
  const child = spawn(process.execPath, ['--enable-source-maps', 'dist/worker.js'], {
    cwd: join(ROOT, 'apps', 'api'),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  writeFileSync(join(ROOT, '.local', 'load', 'drill-worker.pid'), String(child.pid));
  log(`worker started again (pid ${child.pid}; stop it before restarting npm run dev)`);
}

async function valkeyOutage() {
  const v = new Redis(process.env.VALKEY_URL!, { maxRetriesPerRequest: null });
  const killed = await v.client('KILL', 'TYPE', 'normal').catch(() => 0);
  log(`valkey: dropped ${killed} client connections, pausing all clients for 10 s`);
  await v.call('CLIENT', 'PAUSE', '10000', 'ALL').catch(() => undefined);
  v.disconnect();
}

async function postgresOutage(seconds: number) {
  // From the maintenance database: PostgreSQL cannot lock out the database it is connected to.
  const maintenance = new URL(adminUrl);
  maintenance.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  await admin.connect();
  await admin.query(`ALTER DATABASE "${dbName}" WITH ALLOW_CONNECTIONS false`);
  const r = await admin.query(
    `SELECT count(pg_terminate_backend(pid))::int AS n FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [dbName],
  );
  log(`postgres: refusing connections for ${seconds} s, cut ${r.rows[0].n} open connections`);
  await sleep(seconds);
  await admin.query(`ALTER DATABASE "${dbName}" WITH ALLOW_CONNECTIONS true`);
  await admin.end();
  log('postgres: accepting connections again');
}

// ------------------------------------------------------------------------------------- run
log(`traffic: ${values.rate} alerts/s against ${values.api}`);
try {
  await sleep(10);
  stopWorker();
  await sleep(15);
  startWorker();
  await sleep(15);
  await valkeyOutage();
  await sleep(20);
  await postgresOutage(15);
  await sleep(20);
} finally {
  clearInterval(traffic);
}
await sleep(3); // in-flight requests
log(`traffic stopped: ${[...statuses].map(([s, c]) => `${s}×${c}`).join(', ')}`);

// ------------------------------------------------------------------------------------- verdict
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const deadline = Date.now() + 180_000;
let missing = accepted.length;
while (Date.now() < deadline) {
  const r = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM unnest($1::uuid[]) AS a(id)
      WHERE NOT EXISTS (SELECT 1 FROM alert_deliveries d WHERE d.alert_id = a.id
                          AND d.status IN ('sent', 'delivered', 'read'))`,
    [accepted],
  );
  missing = r.rows[0]!.n;
  if (!missing) break;
  await sleep(3);
}
const dup = await db.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM (
     SELECT alert_id FROM alert_deliveries
      WHERE alert_id = ANY($1::uuid[]) AND status IN ('sent', 'delivered', 'read')
      GROUP BY alert_id, channel, recipient, emergency_contact_id, provider_message_id
     HAVING count(*) > 1) x`,
  [accepted],
);
await db.end();

const duplicates = dup.rows[0]!.n;
console.log('');
console.log(`accepted alerts           ${accepted.length}`);
console.log(`not delivered after 3 min ${missing}`);
console.log(`notified twice            ${duplicates}`);
console.log(missing === 0 && duplicates === 0 ? 'PASS: nothing lost, nothing doubled' : 'FAIL');
process.exit(missing === 0 && duplicates === 0 ? 0 : 1);
