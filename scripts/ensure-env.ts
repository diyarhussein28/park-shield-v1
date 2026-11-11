// Creates .env with generated local secrets (used by CI and first-time setup). Existing env vars win.
import { ensureLocalEnv } from './lib/env.ts';

ensureLocalEnv();
