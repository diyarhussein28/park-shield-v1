// Copies the Friendly Captcha SDK into public/ so the scanner page loads it from our own origin
// (no third-party script host; CSP stays 'self').
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'public', 'scanner-assets');
mkdirSync(target, { recursive: true });
// The scanner page imports it as an ES module (FRC_GLUE_JS), so take the package's "import" entry
// (sdk.js). require.resolve would pick the CommonJS build (sdk.cjs), which has no ES exports.
copyFileSync(
  fileURLToPath(import.meta.resolve('@friendlycaptcha/sdk')),
  join(target, 'frc-sdk.js'),
);
// The Socket.io browser client for the live chat on the scanner page (same origin, CSP 'self').
const ioEntry = fileURLToPath(import.meta.resolve('socket.io-client'));
const ioRoot = ioEntry.slice(
  0,
  ioEntry.lastIndexOf('socket.io-client') + 'socket.io-client'.length,
);
copyFileSync(join(ioRoot, 'dist', 'socket.io.min.js'), join(target, 'socket.io.min.js'));
