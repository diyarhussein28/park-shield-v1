// Dev runner: one SWC watcher, three Node processes (public API, VPN-only api-ops, worker).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const opts = { stdio: 'inherit', shell: true };
const children = [];
const run = (cmd) => children.push(spawn(cmd, opts));

run('npx swc src -d dist --strip-leading-paths --ignore "**/*.test.ts" -w');
while (!existsSync('dist/main.js') || !existsSync('dist/worker.js')) await sleep(300);

for (const entry of ['main', 'main-ops', 'worker']) {
  run(`node --enable-source-maps --watch-path=dist dist/${entry}.js`);
}

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
