// Copies the Friendly Captcha SDK into public/ so the scanner page loads it from our own origin
// (no third-party script host; CSP stays 'self').
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const target = join(here, '..', 'public', 'scanner-assets');
mkdirSync(target, { recursive: true });
copyFileSync(
  createRequire(import.meta.url).resolve('@friendlycaptcha/sdk'),
  join(target, 'frc-sdk.js'),
);
