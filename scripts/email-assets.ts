// Renders the logo images into apps/web/public: the e-mail logo and line icons (public/email) and the
// favicon and app icons (public/icons).
//   npx tsx scripts/email-assets.ts
// The logo is the official mark from apps/web/lib/brand-mark.ts (shield with the QR finder squares),
// the one definition the website's header and footer use too; the icons are the paths in
// apps/api/src/mail/icons.ts. 2× size for sharp edges on high-density screens.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { MAIL_ICONS } from '../apps/api/src/mail/icons.ts';
import { markSvgBody } from '../apps/web/lib/brand-mark.ts';
import { ROOT } from './lib/paths.ts';

const OUT = join(ROOT, 'apps/web/public/email');
const ICONS = join(ROOT, 'apps/web/public/icons');
mkdirSync(join(OUT, 'icons'), { recursive: true });
mkdirSync(ICONS, { recursive: true });

/** The mark (32 × 32 grid), moved to x/y and scaled by s. */
const mark = (x = 0, y = 0, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})">${markSvgBody('g')}</g>`;
const svg = (body: string, size: number, box = 32) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${size}" height="${size}">${body}</svg>`,
  );

await sharp(svg(mark(), 192)).png().toFile(join(OUT, 'parkshield-logo.png'));
// The old file name, still referenced by e-mails sent before 2026-11-23.
await sharp(svg(mark(), 192)).png().toFile(join(OUT, 'parkshield-shield.png'));
await sharp(svg(`<rect width="32" height="32" rx="8" fill="#fff"/>${mark(4, 4, 0.75)}`, 192))
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

// Favicon and app icons (app/layout.tsx, public/manifest.webmanifest): the same mark. The browser tab
// shows it on transparent; home screens get it on a white tile (iOS fills transparency with black);
// the maskable icon keeps the mark inside the central safe zone (80 %).
await sharp(svg(mark(), 32)).png().toFile(join(ICONS, 'favicon-32.png'));
const tile = `<rect width="32" height="32" fill="#fff"/>${mark(3.5, 3.5, 0.78)}`;
await sharp(svg(tile, 180)).png().toFile(join(ICONS, 'apple-touch-icon.png'));
for (const size of [192, 512]) {
  await sharp(svg(`<rect width="32" height="32" rx="7" fill="#fff"/>${mark(3.5, 3.5, 0.78)}`, size))
    .png()
    .toFile(join(ICONS, `icon-${size}.png`));
}
await sharp(svg(`<rect width="32" height="32" fill="#fff"/>${mark(6.4, 6.4, 0.6)}`, 512))
  .png()
  .toFile(join(ICONS, 'icon-maskable-512.png'));
console.log(`e-mail assets written to ${OUT}, icons to ${ICONS}`);
