import { ensureLocalEnv } from './lib/env.ts';
import { parseDbUrl, startLocalDb } from './lib/local-db.ts';

ensureLocalEnv();
const main = parseDbUrl(process.env.DATABASE_URL!);
const test = parseDbUrl(process.env.TEST_DATABASE_URL!);

const server = await startLocalDb({
  port: main.port,
  user: main.user,
  password: main.password,
  databases: [main.database, test.database],
});

const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('[db] running - press Ctrl+C to stop');
