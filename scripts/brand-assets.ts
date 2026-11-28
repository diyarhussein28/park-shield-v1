// Renders the ParkShield logo files from the one definition of the mark (apps/web/lib/brand-mark.ts)
// and the website's heading font (Plus Jakarta Sans ExtraBold, OFL), with the wordmark as outlines so
// the SVG and the PDF look the same everywhere without the font installed.
//   npx tsx scripts/brand-assets.ts            → brand/*.svg, *.png and *.pdf (vector)
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {
  MARK_GRADIENT,
  MARK_SHIELD,
  MARK_SQUARES,
  markSvgBody,
} from '../apps/web/lib/brand-mark.ts';
import { ROOT } from './lib/paths.ts';

const OUT = join(ROOT, 'brand');
mkdirSync(OUT, { recursive: true });

const font = fontkit.openSync(
  join(ROOT, 'apps/api/assets/fonts/PlusJakartaSans_800ExtraBold.ttf'),
) as fontkit.Font;

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A glyph outline as SVG path data with only M, L, C and Z: the font's quadratic curves become the exact
 * equivalent cubic curves (control points at 2/3 towards the quadratic one). pdfkit would otherwise write
 * a quadratic curve as the PDF operator `v`, which is not the same curve and makes letters look angular.
 */
function cubicSvg(path: fontkit.Path): string {
  let d = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const { command, args } of path.commands) {
    if (command === 'moveTo') {
      [cx, cy] = args as [number, number];
      [sx, sy] = [cx, cy];
      d += `M${r2(cx)} ${r2(cy)}`;
    } else if (command === 'lineTo') {
      [cx, cy] = args as [number, number];
      d += `L${r2(cx)} ${r2(cy)}`;
    } else if (command === 'quadraticCurveTo') {
      const [qx, qy, x, y] = args as [number, number, number, number];
      const c1 = [cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy)];
      const c2 = [x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y)];
      d += `C${r2(c1[0]!)} ${r2(c1[1]!)} ${r2(c2[0]!)} ${r2(c2[1]!)} ${r2(x)} ${r2(y)}`;
      [cx, cy] = [x, y];
    } else if (command === 'bezierCurveTo') {
      const a = args as [number, number, number, number, number, number];
      d += `C${a.map(r2).join(' ')}`;
      [cx, cy] = [a[4], a[5]];
    } else if (command === 'closePath') {
      d += 'Z';
      [cx, cy] = [sx, sy];
    }
  }
  return d;
}

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
      d += cubicSvg(g.path.scale(scale, -scale).translate(gx, gy));
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
    minX,
    park: { d: w.park, color: park },
    shield: { d: w.shield, color: shield },
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} 0 ${width} ${mark}" width="${width}" height="${mark}" role="img" aria-label="ParkShield">` +
      `<g transform="scale(2)">${markSvgBody(dark ? 'psmd' : 'psml')}</g>` +
      `<path d="${w.park}" fill="${park}"/><path d="${w.shield}" fill="${shield}"/></svg>`,
  };
}

/** The mark alone, cropped to the shield (x 4–28, y 2–30 of the 32-unit grid) with a small margin. */
const markOnly = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="3 1 26 30" width="260" height="300" role="img" aria-label="ParkShield">${markSvgBody('psm')}</svg>`;

/** `#fff` → `#ffffff` (pdfkit wants six digits). */
const hex6 = (c: string) =>
  c.length === 4 ? `#${[...c.slice(1)].map((ch) => ch + ch).join('')}` : c;

/** The mark in a PDF at (x, y), `s` points per unit of its 32-unit grid; the same gradient as the SVG. */
function pdfMark(doc: PDFKit.PDFDocument, x: number, y: number, s: number) {
  doc.save().translate(x, y).scale(s);
  // The SVG gradient runs over the shield's bounding box (x 4–28, y 2–30), top left to bottom right.
  const [from, to] = MARK_GRADIENT;
  const grad = doc.linearGradient(4, 2, 28, 30).stop(0, from).stop(1, to);
  doc.path(MARK_SHIELD).fill(grad);
  for (const [sx, sy, size, r, fill] of MARK_SQUARES) {
    if (r) doc.roundedRect(sx, sy, size, size, r);
    else doc.rect(sx, sy, size, size);
    doc.fill(hex6(fill));
  }
  doc.restore();
}

/** Writes a one-page vector PDF of `width` × `height` points, drawn by `draw`. */
function writePdf(
  name: string,
  width: number,
  height: number,
  draw: (d: PDFKit.PDFDocument) => void,
) {
  const doc = new PDFDocument({
    size: [width, height],
    margin: 0,
    info: { Title: 'ParkShield', Author: 'ParkShield', Creator: 'scripts/brand-assets.ts' },
  });
  const done = new Promise<void>((ok, fail) => {
    const out = createWriteStream(join(OUT, `${name}.pdf`));
    out.on('finish', ok);
    out.on('error', fail);
    doc.pipe(out);
  });
  draw(doc);
  doc.end();
  return done;
}

const files: [string, string, number][] = [];
for (const dark of [false, true]) {
  const l = logo(dark);
  const name = dark ? 'parkshield-logo-white' : 'parkshield-logo';
  writeFileSync(join(OUT, `${name}.svg`), l.svg);
  files.push([name, l.svg, 1200]);
  // Vector PDF, 4 points per SVG pixel (about 9 cm wide): mark, then „Park“ and „Shield“ as paths.
  const k = 4;
  await writePdf(name, l.width * k, l.height * k, (doc) => {
    doc.scale(k).translate(-l.minX, 0);
    pdfMark(doc, 0, 0, 2);
    doc.path(l.park.d).fill(l.park.color);
    doc.path(l.shield.d).fill(l.shield.color);
  });
}
// The mark alone, cropped like its SVG (units 3–29 × 1–31), 10 points per unit.
await writePdf('parkshield-mark', 260, 300, (doc) => pdfMark(doc, -30, -10, 10));
writeFileSync(join(OUT, 'parkshield-mark.svg'), markOnly());
files.push(['parkshield-mark', markOnly(), 1024]);

// PNGs with a transparent background, rendered from the same SVG at a large width.
for (const [name, svg, width] of files)
  await sharp(Buffer.from(svg), { density: 600 })
    .resize({ width })
    .png()
    .toFile(join(OUT, `${name}.png`));

console.log('wrote brand/parkshield-logo(.svg|.png|.pdf), -white, -mark');
