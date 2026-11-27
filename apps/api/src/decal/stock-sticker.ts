import type { DecalSpec, Ink, Primitive } from './layout';
import { FIXED_SENTENCE, logoPrimitives, qrModules } from './layout';

/**
 * The in-house NFC stock sticker (owner design 2026-11-27, docs/nfc-sticker-plan.md): 80 × 80 mm,
 * generic (no vehicle label, no design choice), the same for every sticker except its QR code and
 * serial number. Blue frame running into the bleed, the ParkShield mark and name, „FAHRER
 * KONTAKTIEREN“, the QR code on the left (black, no logo over it, wide quiet zone), the NFC tap
 * hint on the right (the chip's antenna sits behind it), and the dark footer with the domain and the
 * fixed trust sentence (SC-15). The print shop reverse-prints it for the inside of the glass.
 */
export interface StockStickerInput {
  code: string;
  scannerBaseUrl: string;
  /** `PS-000001`, printed under the QR code. */
  serial: string;
}

const W = 80;
const H = 80;
const white: Ink = { rgb: '#ffffff', cmyk: [0, 0, 0, 0] };
const navy: Ink = { rgb: '#0f172a', cmyk: [0, 0, 0, 95] };
const blue: Ink = { rgb: '#1d4ed8', cmyk: [87, 64, 0, 15] };
const lightBlue: Ink = { rgb: '#3b82f6', cmyk: [75, 45, 0, 4] };
const footerNavy: Ink = { rgb: '#172554', cmyk: [100, 80, 0, 55] };
const divider: Ink = { rgb: '#cbd5e1', cmyk: [15, 8, 4, 8] };
const paleText: Ink = { rgb: '#bfdbfe', cmyk: [25, 12, 0, 0] };
const qrDark: Ink = { rgb: '#000000', cmyk: [0, 0, 0, 100] };

/** Helvetica-Bold advance widths (em) of the fixed strings, for placing lines and icons beside them. */
const EM = {
  Park: 2.168,
  Shield: 3.001,
  tagline: 12.388, // FAHRER KONTAKTIEREN
} as const;

/** Helvetica-Bold advance widths (1/1000 em) of the characters a domain can have. */
const BOLD: Record<string, number> = {
  ...Object.fromEntries('acesvxy'.split('').map((c) => [c, 556])),
  ...Object.fromEntries('bdghnopqu'.split('').map((c) => [c, 611])),
  ...Object.fromEntries('ijl.'.split('').map((c) => [c, 278])),
  ...Object.fromEntries('ft-'.split('').map((c) => [c, 333])),
  ...Object.fromEntries('0123456789'.split('').map((c) => [c, 556])),
  k: 556,
  m: 889,
  r: 389,
  w: 778,
  z: 500,
};
const boldEm = (s: string) => [...s].reduce((sum, c) => sum + (BOLD[c] ?? 611), 0) / 1000;

/** The frame: content area inside the blue border (mm), corner radius of the white panel. */
const IN = 2.6;
const R = 5.5;
const K = 0.5523; // cubic handle for a quarter circle

/** Wi-Fi-like tap waves on a 24-unit grid: three 90° arcs around (12, 21). */
function waves(): string {
  const s = Math.SQRT1_2;
  return [5, 10, 15]
    .map((r) => {
      const [x0, y0, x3] = [12 - r * s, 21 - r * s, 12 + r * s];
      const h = K * r * s;
      const f = (v: number) => Number(v.toFixed(3));
      return `M${f(x0)} ${f(y0)}C${f(x0 + h)} ${f(y0 - h)} ${f(x3 - h)} ${f(y0 - h)} ${f(x3)} ${f(y0)}`;
    })
    .join('');
}

/** A phone with tap waves, on a 24-unit grid (stroke). */
const PHONE =
  'M8 3H14C15.1 3 16 3.9 16 5V19C16 20.1 15.1 21 14 21H8C6.9 21 6 20.1 6 19V5C6 3.9 6.9 3 8 3Z' +
  'M10 18H12' +
  'M18.5 7C19.6 8.1 19.6 9.9 18.5 11' +
  'M20.8 5C23 7.2 23 10.8 20.8 13';

/** A globe on a 24-unit grid (stroke). */
const GLOBE =
  'M3 12C3 7 7 3 12 3C17 3 21 7 21 12C21 17 17 21 12 21C7 21 3 17 3 12Z' +
  'M3 12H21M4.6 7.5H19.4M4.6 16.5H19.4' +
  'M12 3C9.6 5.6 8.6 8.6 8.6 12C8.6 15.4 9.6 18.4 12 21' +
  'M12 3C14.4 5.6 15.4 8.6 15.4 12C15.4 15.4 14.4 18.4 12 21';

/** The footer: a curved top edge (shifted down by `dy`), the panel's rounded bottom corners. */
function footerPath(dy: number): string {
  const a = H - IN; // bottom of the white panel
  const c = a - R; // where the corners start
  const h = R * K;
  return (
    `M${IN} ${69 + dy}C28 ${66.4 + dy} 52 ${66.2 + dy} ${W - IN} ${67.6 + dy}` +
    `L${W - IN} ${c}C${W - IN} ${c + h} ${W - IN - R + h} ${a} ${W - IN - R} ${a}` +
    `L${IN + R} ${a}C${IN + R - h} ${a} ${IN} ${c + h} ${IN} ${c}Z`
  );
}

export function layoutStockSticker(input: StockStickerInput): DecalSpec {
  const url = `${input.scannerBaseUrl.replace(/\/$/, '')}/s/${input.code}`;
  const domain = new URL(url).host;
  const p: Primitive[] = [];

  // 1. White panel inside the blue frame (the frame is the page background, into the bleed).
  p.push({ kind: 'rect', x: IN, y: IN, w: W - 2 * IN, h: H - 2 * IN, fill: white, radius: R });

  // 2. Mark and name, centred as a group.
  const mark = 11;
  const size = 8.6;
  const parkW = EM.Park * size;
  const shieldW = EM.Shield * size;
  const left = (W - (mark + 1.8 + parkW + shieldW)) / 2;
  p.push(...logoPrimitives(left, 5.2, mark, blue, white));
  const base = 5.2 + mark / 2 + size * 0.359;
  const tx = left + mark + 1.8;
  p.push({
    kind: 'text',
    x: tx,
    y: base,
    size,
    text: 'Park',
    fill: navy,
    bold: true,
    width: parkW + 0.5,
    align: 'left',
  });
  p.push({
    kind: 'text',
    x: tx + parkW,
    y: base,
    size,
    text: 'Shield',
    fill: blue,
    bold: true,
    width: shieldW + 0.5,
    align: 'left',
  });

  // 3. „FAHRER KONTAKTIEREN“ between two short lines.
  const tag = 3.5;
  const tagBase = 22.2;
  const tagHalf = (EM.tagline * tag) / 2;
  p.push({
    kind: 'text',
    x: IN + 2,
    y: tagBase,
    size: tag,
    text: 'FAHRER KONTAKTIEREN',
    fill: navy,
    bold: true,
    width: W - 2 * IN - 4,
  });
  const lineY = tagBase - tag * 0.36 - 0.3;
  p.push({ kind: 'rect', x: 7.5, y: lineY, w: W / 2 - tagHalf - 2 - 7.5, h: 0.6, fill: blue });
  p.push({
    kind: 'rect',
    x: W / 2 + tagHalf + 2,
    y: lineY,
    w: W / 2 - tagHalf - 2 - 7.5,
    h: 0.6,
    fill: blue,
  });

  // 4. QR code: black on white, no logo over it, ≥ 4 modules of white to the frame and the divider.
  const qx = 7;
  const qy = 26;
  const qs = 34.5;
  p.push({
    kind: 'qr',
    x: qx,
    y: qy,
    size: qs,
    modules: qrModules(url),
    fill: qrDark,
    roundFinders: true,
  });
  p.push({
    kind: 'text',
    x: qx,
    y: 64.6,
    size: 2.4,
    text: input.serial,
    fill: navy,
    bold: false,
    width: qs,
  });

  // 5. Divider and the NFC column (the chip's antenna goes behind it).
  p.push({ kind: 'rect', x: 45, y: 27, w: 0.35, h: 33, fill: divider });
  const colX = 46.5;
  const colW = W - IN - 1.5 - colX;
  const cx = colX + colW / 2;
  p.push({
    kind: 'path',
    x: cx - 6,
    y: 24.5,
    size: 12,
    box: 24,
    d: waves(),
    fill: null,
    stroke: blue,
    strokeWidth: 2.4,
  });
  p.push({
    kind: 'text',
    x: colX,
    y: 42,
    size: 8.5,
    text: 'NFC',
    fill: navy,
    bold: true,
    width: colW,
  });
  p.push({ kind: 'rect', x: cx - 13.2, y: 44.5, w: 26.4, h: 5.8, fill: blue, radius: 2.9 });
  p.push({
    kind: 'text',
    x: cx - 13.2,
    y: 44.5 + 2.9 + 3 * 0.359,
    size: 3,
    text: 'Handy anhalten',
    fill: white,
    bold: true,
    width: 26.4,
  });
  p.push({
    kind: 'path',
    x: cx - 4.75,
    y: 51.5,
    size: 9.5,
    box: 24,
    d: PHONE,
    fill: null,
    stroke: navy,
    strokeWidth: 1.6,
  });
  p.push({
    kind: 'text',
    x: colX,
    y: 64.6,
    size: 2.4,
    text: 'Ohne App · anonym',
    fill: blue,
    bold: true,
    width: colW,
  });

  // 6. Footer: light stripe, dark band, globe + domain, the fixed trust sentence.
  p.push({ kind: 'path', x: 0, y: 0, size: W, box: W, d: footerPath(0), fill: lightBlue });
  p.push({ kind: 'path', x: 0, y: 0, size: W, box: W, d: footerPath(1.4), fill: footerNavy });
  const globe = 4.6;
  // park-shield.de at 4.4 mm; a longer host (the test server) shrinks to fit.
  const dSize = Math.min(4.4, (W - 2 * IN - 8 - globe - 1.5) / boldEm(domain));
  const dW = boldEm(domain) * dSize;
  const gx = (W - (globe + 1.5 + dW)) / 2;
  const dBase = 73.4;
  p.push({
    kind: 'path',
    x: gx,
    y: dBase - dSize * 0.359 - globe / 2,
    size: globe,
    box: 24,
    d: GLOBE,
    fill: null,
    stroke: white,
    strokeWidth: 1.7,
  });
  p.push({
    kind: 'text',
    x: gx + globe + 1.5,
    y: dBase,
    size: dSize,
    text: domain,
    fill: white,
    bold: true,
    width: dW + 0.5,
    align: 'left',
  });
  p.push({
    kind: 'text',
    x: IN + 3,
    y: 76.3,
    size: 1.7,
    text: FIXED_SENTENCE,
    fill: paleText,
    bold: false,
    width: W - 2 * IN - 6,
  });

  return { width: W, height: H, background: blue, primitives: p };
}
