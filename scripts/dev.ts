import { spawn, spawnSync } from 'node:child_process';
import { ensureLocalEnv } from './lib/env.ts';
import { parseDbUrl, ROOT, startLocalDb } from './lib/local-db.ts';

ensureLocalEnv();
const main = parseDbUrl(process.env.DATABASE_URL!);
const test = parseDbUrl(process.env.TEST_DATABASE_URL!);

const db = await startLocalDb({
  port: main.port,
  user: main.user,
  password: main.password,
  databases: [main.database, test.database],
});

const run = (cmd: string, env: NodeJS.ProcessEnv = process.env) => {
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true, env });
  if (r.status !== 0) throw new Error(`failed: ${cmd}`);
};

run('npm run db:migrate');
run('npm run db:migrate', { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL });

const apps = spawn('npx turbo run dev --env-mode=loose', {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
});

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  apps.kill();
  await db.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
apps.on('exit', stop);
