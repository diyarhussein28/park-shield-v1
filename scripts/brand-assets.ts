// Renders the ParkShield logo files from the one definition of the mark (apps/web/lib/brand-mark.ts)
// and the website's heading font (Plus Jakarta Sans ExtraBold, OFL), with the wordmark as outlines so
// the SVG looks the same everywhere without the font installed.
//   npx tsx scripts/brand-assets.ts            → brand/*.svg and brand/*.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import sharp from 'sharp';
import { markSvgBody } from '../apps/web/lib/brand-mark.ts';
import { ROOT } from './lib/paths.ts';

const OUT = join(ROOT, 'brand');
mkdirSync(OUT, { recursive: true });

const font = fontkit.openSync(
  join(ROOT, 'apps/api/assets/fonts/PlusJakartaSans_800ExtraBold.ttf'),
) as fontkit.Font;

/** „Park“ and „Shield“ as SVG paths at `size` px, tracking-tight (−0.025 em) like the website. */
function wordmark(size: number, x0: number, baseline: number) {
  const scale = size / font.unitsPerEm;
  const tracking = -0.025 * size;
  let x = x0;
  const part = (text: string) => {
    const run = font.layout(text);
    let d = '';
    run.glyphs.forEach((g, i) => {
      const pos = run.positions[i]!;
      const gx = x + pos.xOffset * scale;
      const gy = baseline - pos.yOffset * scale;
      // Font units are y-up: flip and scale every glyph into place.
      const path = g.path.scale(scale, -scale).translate(gx, gy);
      d += path.toSVG();
      x += pos.xAdvance * scale + tracking;
    });
    return d;
  };
  const park = part('Park');
  const shield = part('Shield');
  return { park, shield, end: x - tracking };
}

/** The full logo: mark + „ParkShield“; `dark` = white „Park“, lighter blue „Shield“ (footer). */
function logo(dark: boolean) {
  const mark = 64; // the mark's 32-unit grid at 2 px per unit
  const size = 40;
  const capHeight = (font.capHeight / font.unitsPerEm) * size;
  const baseline = mark / 2 + capHeight / 2;
  const w = wordmark(size, 56 + 14, baseline);
  const minX = 6;
  const width = Math.ceil(w.end + 4 - minX);
  const park = dark ? '#ffffff' : '#0f172a';
  const shield = dark ? '#3b82f6' : '#1d4ed8';
  return {
    width,
    height: mark,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} 0 ${width} ${mark}" width="${width}" height="${mark}" role="img" aria-label="ParkShield">` +
      `<g transform="scale(2)">${markSvgBody(dark ? 'psmd' : 'psml')}</g>` +
      `<path d="${w.park}" fill="${park}"/><path d="${w.shield}" fill="${shield}"/></svg>`,
  };
}

/** The mark alone, cropped to the shield (x 4–28, y 2–30 of the 32-unit grid) with a small margin. */
const markOnly = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 1 26 30" width="260" height="300" role="img" aria-label="ParkShield">${markSvgBody('psm')}</svg>`;

const files: [string, string, number][] = [];
for (const dark of [false, true]) {
  const l = logo(dark);
  const name = dark ? 'parkshield-logo-white' : 'parkshield-logo';
  writeFileSync(join(OUT, `${name}.svg`), l.svg);
  files.push([name, l.svg, 1200]);
}
writeFileSync(join(OUT, 'parkshield-mark.svg'), markOnly());
files.push(['parkshield-mark', markOnly(), 1024]);

// PNGs with a transparent background, rendered from the same SVG at a large width.
for (const [name, svg, width] of files)
  await sharp(Buffer.from(svg), { density: 600 })
    .resize({ width })
    .png()
    .toFile(join(OUT, `${name}.png`));

console.log('wrote brand/parkshield-logo(.svg|.png), -white, -mark');
