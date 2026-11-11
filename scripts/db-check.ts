// Schema check used locally and in CI: migrate a fresh database up, run run_retention(), roll back, migrate again.
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import pg from 'pg';
import { ROOT } from './lib/paths.ts';

config({ path: `${ROOT}/.env`, quiet: true });
const base = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!);
const dbName = `schema_check_${Date.now()}`;

const admin = new pg.Client({ connectionString: new URL('/postgres', base).toString() });
await admin.connect();
await admin.query(`CREATE DATABASE ${dbName}`);

const url = new URL(base);
url.pathname = `/${dbName}`;
const dbmate = (cmd: string) => {
  const r = spawnSync(`npx dbmate --migrations-dir db/migrations --no-dump-schema ${cmd}`, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
  if (r.status !== 0) throw new Error(`dbmate ${cmd} failed`);
};

let ok = false;
try {
  dbmate('up');
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*) AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'`,
  );
  await c.query('SELECT run_retention()');
  await c.end();
  console.log(`[db-check] ${rows[0]?.n} tables created; run_retention() ok`);
  dbmate('rollback');
  dbmate('up');
  ok = true;
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
}
if (!ok) process.exit(1);
console.log('[db-check] schema ok');
