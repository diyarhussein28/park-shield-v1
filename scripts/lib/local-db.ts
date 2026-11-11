import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { ROOT } from './paths.ts';

export { ROOT };
const DATA_DIR = join(ROOT, '.local', 'pgdata');

export interface LocalDbOptions {
  port: number;
  user: string;
  password: string;
  databases: string[];
}

export function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

export async function startLocalDb(opts: LocalDbOptions): Promise<EmbeddedPostgres> {
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (e) => console.error('[postgres]', String(e).trim()),
  });

  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) {
    console.log('[db] initialising PostgreSQL data directory in .local/pgdata');
    await server.initialise();
  }
  await server.start();

  const client = new pg.Client({
    host: '127.0.0.1',
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: 'postgres',
  });
  await client.connect();
  try {
    for (const db of opts.databases) {
      const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (!rowCount) {
        await client.query(`CREATE DATABASE "${db.replaceAll('"', '')}"`);
        console.log(`[db] created database ${db}`);
      }
    }
    const { rows } = await client.query<{ v: string }>(
      "SELECT current_setting('server_version') AS v",
    );
    console.log(`[db] PostgreSQL ${rows[0]?.v} listening on 127.0.0.1:${opts.port}`);
  } finally {
    await client.end();
  }
  return server;
}
