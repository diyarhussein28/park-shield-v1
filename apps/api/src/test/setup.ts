import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from 'dotenv';

let dir = process.cwd();
while (!existsSync(join(dir, 'turbo.json')) && dir !== dirname(dir)) dir = dirname(dir);
config({ path: join(dir, '.env'), quiet: true });

process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (process.env.VALKEY_URL) {
  const u = new URL(process.env.VALKEY_URL);
  u.pathname = '/1'; // separate logical DB so tests never touch dev data
  process.env.VALKEY_URL = u.toString();
}
