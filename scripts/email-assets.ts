// Renders the images of the e-mails (logo and line icons) into apps/web/public/email.
//   npx tsx scripts/email-assets.ts
// The logo is the app's mark (`LogoMark`, shield with the QR finder pattern); the icons are the paths
// in apps/api/src/mail/icons.ts. 2× size for sharp edges on high-density screens.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { MAIL_ICONS } from '../apps/api/src/mail/icons.ts';
import { ROOT } from './lib/paths.ts';

const OUT = join(ROOT, 'apps/web/public/email');
mkdirSync(join(OUT, 'icons'), { recursive: true });

const defs = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#1d4ed8"/></linearGradient></defs>`;
const mark = (x = 0, y = 0, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z" fill="url(#g)"/><rect x="10" y="10" width="5" height="5" rx="1" fill="#fff"/><rect x="17" y="10" width="5" height="5" rx="1" fill="#facc15"/><rect x="10" y="17" width="5" height="5" rx="1" fill="#fff"/><rect x="17.5" y="17.5" width="2" height="2" fill="#fff"/><rect x="20.5" y="20.5" width="2" height="2" fill="#fff"/></g>`;
const svg = (body: string, size: number, box = 32) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${size}" height="${size}">${body}</svg>`,
  );

await sharp(svg(defs + mark(), 192))
  .png()
  .toFile(join(OUT, 'parkshield-logo.png'));
// The old file name, still referenced by e-mails sent before 2026-11-23.
await sharp(svg(defs + mark(), 192))
  .png()
  .toFile(join(OUT, 'parkshield-shield.png'));
await sharp(svg(`${defs}<rect width="32" height="32" rx="8" fill="#fff"/>${mark(4, 4, 0.75)}`, 192))
  .png()
  .toFile(join(OUT, 'parkshield-logo-tile.png'));

const stroke = (d: string, color: string) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
for (const [name, d] of Object.entries(MAIL_ICONS)) {
  await sharp(svg(stroke(d, '#1d4ed8'), 48, 24))
    .png()
    .toFile(join(OUT, 'icons', `${name}.png`));
}
// The success badge: a green disc with a white check.
await sharp(
  svg(
    `<circle cx="12" cy="12" r="12" fill="#16a34a"/>${stroke('M7 12.5 10.5 16 17 8.5', '#fff')}`,
    64,
    24,
  ),
)
  .png()
  .toFile(join(OUT, 'icons', 'success.png'));
console.log(`e-mail assets written to ${OUT}`);
