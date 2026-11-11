import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { generateVAPIDKeys } from 'web-push';
import { ROOT } from './paths.ts';

const ENV_FILE = join(ROOT, '.env');
const EXAMPLE_FILE = join(ROOT, '.env.example');

const generated: Record<string, () => string> = {
  DATA_KEY_V1: () => randomBytes(32).toString('base64'),
  BIDX_KEY: () => randomBytes(32).toString('base64'),
  BLOCK_KEY_CURRENT: () => randomBytes(32).toString('base64'),
  BLOCK_KEY_PREVIOUS: () => randomBytes(32).toString('base64'),
  SESSION_SECRET: () => randomBytes(32).toString('base64'),
};

/** Creates .env from .env.example on first run and fills locally generated secrets. Never overwrites a value. */
export function ensureLocalEnv(): void {
  if (!existsSync(ENV_FILE)) {
    copyFileSync(EXAMPLE_FILE, ENV_FILE);
    console.log('[env] created .env from .env.example');
  }
  let text = readFileSync(ENV_FILE, 'utf8');
  const filled: string[] = [];
  const setIfEmpty = (key: string, value: string) => {
    const re = new RegExp(`^${key}=(.*)$`, 'm');
    const m = text.match(re);
    if (m && m[1]!.trim() !== '') return;
    text = m ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
    filled.push(key);
  };
  for (const [key, make] of Object.entries(generated)) setIfEmpty(key, make());
  if (!/^VAPID_PUBLIC_KEY=.+$/m.test(text)) {
    const vapid = generateVAPIDKeys();
    setIfEmpty('VAPID_PUBLIC_KEY', vapid.publicKey);
    setIfEmpty('VAPID_PRIVATE_KEY', vapid.privateKey);
  }
  if (filled.length) {
    writeFileSync(ENV_FILE, text);
    console.log(`[env] generated local values for: ${filled.join(', ')}`);
  }
  config({ path: ENV_FILE, quiet: true });
}
