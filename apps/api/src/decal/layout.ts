import type { DecalProduct, DecalTemplate } from '@parkshield/shared';
import QRCode from 'qrcode';

/** RGB for screen previews, CMYK (0–100) for the print shop. */
export interface Ink {
  rgb: string;
  cmyk: [number, number, number, number];
}

interface Palette {
  background: Ink;
  header: Ink;
  headerText: Ink;
  text: Ink;
  border?: Ink;
}

const white: Ink = { rgb: '#ffffff', cmyk: [0, 0, 0, 0] };
const ink: Ink = { rgb: '#0f172a', cmyk: [0, 0, 0, 95] };
const qrDark: Ink = { rgb: '#000000', cmyk: [0, 0, 0, 100] };

export const TEMPLATES: Record<DecalTemplate, Palette> = {
  classic: {
    background: white,
    header: { rgb: '#1d4ed8', cmyk: [87, 64, 0, 15] },
    headerText: white,
    text: ink,
  },
  signal: {
    background: white,
    header: { rgb: '#b91c1c', cmyk: [0, 85, 85, 27] },
    headerText: white,
    text: ink,
  },
  bold: {
    background: { rgb: '#facc15', cmyk: [0, 20, 90, 2] },
    header: ink,
    headerText: { rgb: '#facc15', cmyk: [0, 20, 90, 2] },
    text: ink,
  },
  minimal: { background: white, header: white, headerText: ink, text: ink, border: ink },
  night: {
    background: { rgb: '#0b1220', cmyk: [60, 40, 0, 90] },
    header: { rgb: '#1e293b', cmyk: [55, 35, 0, 75] },
    headerText: white,
    text: white,
  },
  friendly: {
    background: { rgb: '#f0fdf4', cmyk: [5, 0, 8, 0] },
    header: { rgb: '#15803d', cmyk: [85, 10, 100, 10] },
    headerText: white,
    text: { rgb: '#14532d', cmyk: [80, 20, 95, 55] },
  },
};

export type Primitive =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      /** null = outline only */
      fill: Ink | null;
      radius?: number;
      stroke?: Ink;
    }
  | {
      kind: 'text';
      x: number;
      y: number;
      size: number;
      text: string;
      fill: Ink;
      bold: boolean;
      width: number;
    }
  | { kind: 'qr'; x: number; y: number; size: number; modules: boolean[][]; fill: Ink };

export interface DecalSpec {
  width: number;
  height: number;
  background: Ink;
  primitives: Primitive[];
}

export interface DecalInput {
  code: string;
  scannerBaseUrl: string;
  template: DecalTemplate;
  cta: string;
  product: DecalProduct;
}

export const FIXED_SENTENCE = 'ParkShield verlangt nie eine Zahlung';

/** Helvetica averages ~0.55 em per character; shrink long headers to fit the safe area. */
const fit = (text: string, width: number, max: number, bold = true) =>
  Math.min(max, width / (Math.max(text.length, 1) * (bold ? 0.6 : 0.55)));

export function qrModules(url: string): boolean[][] {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => qr.modules.get(r, c) === 1),
  );
}

/** Geometry in millimetres, origin top-left of the trim box. */
export function layoutDecal(input: DecalInput): DecalSpec {
  const p = TEMPLATES[input.template];
  const url = `${input.scannerBaseUrl.replace(/\/$/, '')}/s/${input.code}`;
  const shown = url.replace(/^https?:\/\//, '');
  const modules = qrModules(url);
  const card = input.product === 'a6_dashboard_card';
  const W = card ? 105 : 80;
  const H = card ? 148 : 80;
  const safe = 3; // keep content 3 mm inside the cut line
  const headerH = card ? 24 : 15;
  const panel = card ? 85 : 50;
  const quiet = card ? 5 : 4;
  const panelY = headerH + (card ? 6 : 1.5);
  const prims: Primitive[] = [];

  prims.push({ kind: 'rect', x: 0, y: 0, w: W, h: headerH, fill: p.header });
  prims.push({
    kind: 'text',
    x: safe,
    y: headerH * 0.66,
    size: fit(input.cta, W - 2 * safe, card ? 8 : 5.6),
    text: input.cta,
    fill: p.headerText,
    bold: true,
    width: W - 2 * safe,
  });
  // QR always dark-on-white with a quiet zone, whatever the template, so every phone can read it.
  prims.push({
    kind: 'rect',
    x: (W - panel) / 2,
    y: panelY,
    w: panel,
    h: panel,
    fill: white,
    radius: 2,
  });
  prims.push({
    kind: 'qr',
    x: (W - panel) / 2 + quiet,
    y: panelY + quiet,
    size: panel - 2 * quiet,
    modules,
    fill: qrDark,
  });

  const below = panelY + panel;
  const lines: [string, number, boolean][] = card
    ? [
        [shown, 6.5, true],
        [FIXED_SENTENCE, 4.5, false],
        ['Code scannen, Fahrer benachrichtigen – ohne App.', 4, false],
        ['Scan to notify the driver – no app needed.', 3.6, false],
      ]
    : [
        [shown, 5, true],
        [FIXED_SENTENCE, 4.3, false],
      ];
  let y = below + (card ? 10 : 5);
  for (const [text, step, bold] of lines) {
    const size = fit(text, W - 2 * safe, card ? (bold ? 5 : 3.6) : bold ? 3.4 : 2.6, bold);
    prims.push({ kind: 'text', x: safe, y, size, text, fill: p.text, bold, width: W - 2 * safe });
    y += step;
  }
  // Frame last, outline only, so the header cannot cover its top edge.
  if (p.border) {
    prims.push({
      kind: 'rect',
      x: 1.5,
      y: 1.5,
      w: W - 3,
      h: H - 3,
      fill: null,
      stroke: p.border,
      radius: 2,
    });
  }
  return { width: W, height: H, background: p.background, primitives: prims };
}
