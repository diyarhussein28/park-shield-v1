// Local restore drill: logical backup of DATABASE_URL (every table to JSON files), restore into a fresh
// database rebuilt from the migrations, then verify every table by row count + content checksum.
// Production uses pgBackRest PITR; see docs/runbooks/restore-drill.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';
import { ROOT } from './lib/paths.ts';

config({ path: join(ROOT, '.env'), quiet: true });

const source = new URL(process.env.DATABASE_URL!);
const target = new URL(source);
const targetDb = `restore_drill_${Date.now()}`;
target.pathname = `/${targetDb}`;
const backupDir = join(ROOT, '.local', 'drill');

async function withClient<T>(url: URL, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const listTables = (c: pg.Client) =>
  c
    .query<{ t: string }>(
      `SELECT tablename AS t FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY 1`,
    )
    .then((r) => r.rows.map((x) => x.t));

async function fingerprint(c: pg.Client): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of await listTables(c)) {
    const { rows } = await c.query<{ n: string; h: string | null }>(
      `SELECT count(*) AS n, md5(string_agg(x::text, '|' ORDER BY x::text)) AS h FROM public."${t}" x`,
    );
    out[t] = `${rows[0]!.n}:${rows[0]!.h ?? '-'}`;
  }
  return out;
}

const started = Date.now();
mkdirSync(backupDir, { recursive: true });
const admin = new pg.Client({ connectionString: new URL('/postgres', source).toString() });
await admin.connect();
let ok = false;
try {
  // 1. Backup
  const before = await withClient(source, async (c) => {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    for (const t of await listTables(c)) {
      const { rows } = await c.query<{ j: string }>(
        `SELECT coalesce(json_agg(x), '[]')::text AS j FROM public."${t}" x`,
      );
      writeFileSync(join(backupDir, `${t}.json`), rows[0]!.j);
    }
    const fp = await fingerprint(c);
    await c.query('COMMIT');
    return fp;
  });

  // 2. Fresh database with the schema from migrations
  await admin.query(`CREATE DATABASE "${targetDb}"`);
  const migrate = spawnSync('npx dbmate --migrations-dir db/migrations --no-dump-schema up', {
    cwd: ROOT,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: target.toString() },
  });
  if (migrate.status !== 0) throw new Error(`migrations failed: ${migrate.stderr}`);

  // 3. Restore data (seed rows from migrations are replaced by the backup; triggers/FKs deferred)
  const after = await withClient(target, async (c) => {
    const tables = await listTables(c);
    await c.query('BEGIN');
    await c.query('SET LOCAL session_replication_role = replica');
    await c.query(`TRUNCATE ${tables.map((t) => `public."${t}"`).join(', ')}`);
    for (const t of tables) {
      const json = readFileSync(join(backupDir, `${t}.json`), 'utf8');
      await c.query(
        `INSERT INTO public."${t}" OVERRIDING SYSTEM VALUE
         SELECT * FROM json_populate_recordset(null::public."${t}", $1)`,
        [json],
      );
    }
    // Identity sequences continue after the restored ids, so the database accepts new rows.
    const { rows: idents } = await c.query<{ t: string; col: string }>(
      `SELECT table_name AS t, column_name AS col FROM information_schema.columns
        WHERE table_schema = 'public' AND is_identity = 'YES'`,
    );
    for (const { t, col } of idents) {
      await c.query(
        `SELECT setval(pg_get_serial_sequence('public."${t}"', '${col}'),
                coalesce((SELECT max("${col}") FROM public."${t}"), 0) + 1, false)`,
      );
    }
    await c.query('COMMIT');
    return fingerprint(c);
  });

  // 4. Verify
  const tables = Object.keys(before);
  const mismatched = tables.filter((t) => before[t] !== after[t]);
  const rows = tables.reduce((sum, t) => sum + Number(before[t]!.split(':')[0]), 0);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[drill] ${tables.length} tables, ${rows} rows backed up, restored and verified in ${seconds}s`,
  );
  if (mismatched.length) console.error(`[drill] MISMATCH in: ${mismatched.join(', ')}`);
  ok = mismatched.length === 0 && Object.keys(after).length === tables.length;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${targetDb}" WITH (FORCE)`);
  await admin.end();
  rmSync(backupDir, { recursive: true, force: true });
}
console.log(ok ? '[drill] PASS' : '[drill] FAIL');
process.exitCode = ok ? 0 : 1;
