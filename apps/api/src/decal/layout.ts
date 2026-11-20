import type { DecalProduct, DecalTemplate } from '@parkshield/shared';
import QRCode from 'qrcode';

/** RGB for screen previews, CMYK (0–100) for the print shop. */
export interface Ink {
  rgb: string;
  cmyk: [number, number, number, number];
}

/** Naive RGB → CMYK for the secondary colours; the main brand colours are hand-tuned below. */
function hex(rgb: string): Ink {
  const n = parseInt(rgb.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [
    number,
    number,
    number,
  ];
  const k = 1 - Math.max(r, g, b);
  const part = (v: number) => (k >= 1 ? 0 : Math.round(((1 - v - k) / (1 - k)) * 100));
  return { rgb, cmyk: [part(r), part(g), part(b), Math.round(k * 100)] };
}

interface Palette {
  background: Ink;
  header: Ink;
  headerText: Ink;
  /** Under the header: warning stripes, a thin accent line or nothing. */
  band: { kind: 'stripes'; a: Ink; b: Ink } | { kind: 'line'; ink: Ink } | { kind: 'none' };
  text: Ink;
  /** Icons and the how-to line. */
  accent: Ink;
  /** Outline of the white QR card. */
  frame: Ink;
  footer: Ink;
  footerText: Ink;
  border?: Ink;
}

const white: Ink = { rgb: '#ffffff', cmyk: [0, 0, 0, 0] };
const ink: Ink = { rgb: '#0f172a', cmyk: [0, 0, 0, 95] };
const qrDark: Ink = { rgb: '#000000', cmyk: [0, 0, 0, 100] };
const blue: Ink = { rgb: '#1d4ed8', cmyk: [87, 64, 0, 15] };
const red: Ink = { rgb: '#b91c1c', cmyk: [0, 85, 85, 27] };
const yellow: Ink = { rgb: '#facc15', cmyk: [0, 20, 90, 2] };
const green: Ink = { rgb: '#15803d', cmyk: [85, 10, 100, 10] };

export const TEMPLATES: Record<DecalTemplate, Palette> = {
  classic: {
    background: white,
    header: blue,
    headerText: white,
    band: { kind: 'line', ink: yellow },
    text: ink,
    accent: blue,
    frame: hex('#cbd5e1'),
    footer: hex('#eff6ff'),
    footerText: hex('#1e3a8a'),
  },
  signal: {
    background: white,
    header: red,
    headerText: white,
    band: { kind: 'stripes', a: red, b: white },
    text: ink,
    accent: red,
    frame: hex('#fecaca'),
    footer: hex('#fef2f2'),
    footerText: hex('#7f1d1d'),
  },
  bold: {
    background: yellow,
    header: ink,
    headerText: yellow,
    band: { kind: 'stripes', a: ink, b: yellow },
    text: ink,
    accent: ink,
    frame: ink,
    footer: ink,
    footerText: yellow,
  },
  minimal: {
    background: white,
    header: white,
    headerText: ink,
    band: { kind: 'line', ink },
    text: ink,
    accent: ink,
    frame: hex('#e2e8f0'),
    footer: white,
    footerText: ink,
    border: ink,
  },
  night: {
    background: { rgb: '#0b1220', cmyk: [60, 40, 0, 90] },
    header: { rgb: '#1e293b', cmyk: [55, 35, 0, 75] },
    headerText: white,
    band: { kind: 'line', ink: hex('#38bdf8') },
    text: white,
    accent: hex('#38bdf8'),
    frame: hex('#334155'),
    footer: hex('#111a2e'),
    footerText: hex('#e2e8f0'),
  },
  friendly: {
    background: { rgb: '#f0fdf4', cmyk: [5, 0, 8, 0] },
    header: green,
    headerText: white,
    band: { kind: 'line', ink: hex('#86efac') },
    text: { rgb: '#14532d', cmyk: [80, 20, 95, 55] },
    accent: green,
    frame: hex('#bbf7d0'),
    footer: hex('#dcfce7'),
    footerText: { rgb: '#14532d', cmyk: [80, 20, 95, 55] },
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
      /** Within [x, x + width]; default centre. */
      align?: 'left' | 'center' | 'right';
    }
  | {
      kind: 'qr';
      x: number;
      y: number;
      size: number;
      modules: boolean[][];
      fill: Ink;
      /** Draw the three finder patterns with rounded corners (still decodes like square ones). */
      roundFinders?: boolean;
    }
  | {
      /** SVG path data in a `box` × `box` design grid, drawn at (x, y) with `size` mm. */
      kind: 'path';
      x: number;
      y: number;
      size: number;
      box: number;
      d: string;
      fill: Ink | null;
      stroke?: Ink;
      /** Line width in design-grid units. */
      strokeWidth?: number;
    }
  | {
      /** Diagonal warning stripes clipped to the rectangle. */
      kind: 'stripes';
      x: number;
      y: number;
      w: number;
      h: number;
      a: Ink;
      b: Ink;
      /** Stripe width in mm. */
      step: number;
    };

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

/** Helvetica averages ~0.55 em per character; shrink long text to fit its box. */
const fit = (text: string, width: number, max: number, bold = true) =>
  Math.min(max, width / (Math.max(text.length, 1) * (bold ? 0.6 : 0.55)));
const textWidth = (text: string, size: number, bold: boolean) =>
  text.length * size * (bold ? 0.6 : 0.55);

export function qrModules(url: string): boolean[][] {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => qr.modules.get(r, c) === 1),
  );
}

/** A circle as four cubic curves (no arcs, so every PDF and SVG renderer draws it the same). */
function circle(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  return (
    `M${cx - r} ${cy}C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}` +
    `C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}` +
    `C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}` +
    `C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}Z`
  );
}

/** Line icons on a 24-unit grid (stroke only). */
const ICONS = {
  camera:
    'M14.5 4H9.5L7 7H4C2.9 7 2 7.9 2 9V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V9C22 7.9 21.1 7 20 7H17Z' +
    circle(12, 13, 3.5),
  choose:
    'M7 2H17C18.1 2 19 2.9 19 4V20C19 21.1 18.1 22 17 22H7C5.9 22 5 21.1 5 20V4C5 2.9 5.9 2 7 2Z' +
    'M9 8H15M9 12H15M9 16H13',
  bell:
    'M6 8C6 4.7 8.7 2 12 2C15.3 2 18 4.7 18 8C18 15 21 17 21 17H3C3 17 6 15 6 8Z' +
    'M10.3 21C10.6 21.6 11.3 22 12 22C12.7 22 13.4 21.6 13.7 21',
};

/** The ParkShield shield mark (same artwork as the website logo), on a 32-unit grid. */
function logo(x: number, y: number, size: number, shield: Ink, mark: Ink): Primitive[] {
  const u = size / 32;
  const sq = (sx: number, sy: number, s: number, fill: Ink, r = 1): Primitive => ({
    kind: 'rect',
    x: x + sx * u,
    y: y + sy * u,
    w: s * u,
    h: s * u,
    fill,
    radius: r * u,
  });
  return [
    {
      kind: 'path',
      x,
      y,
      size,
      box: 32,
      d: 'M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z',
      fill: shield,
    },
    sq(10, 10, 5, mark),
    sq(17, 10, 5, yellow),
    sq(10, 17, 5, mark),
    sq(17.5, 17.5, 2, mark, 0),
    sq(20.5, 20.5, 2, mark, 0),
  ];
}

/**
 * One line if it stays at least `min` mm tall, otherwise two lines split at the space closest to
 * the middle (preferring a break after "?", "!" or ","). Text without spaces stays on one line.
 */
export function headline(text: string, width: number, max: number, min: number): string[] {
  if (fit(text, width, max) >= min) return [text];
  const spaces = [...text.matchAll(/ /g)].map((m) => m.index);
  if (!spaces.length) return [text];
  const score = (i: number) =>
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- single character class on one character
    Math.abs(i - text.length / 2) - (/[?!,:]/.test(text[i - 1] ?? '') ? text.length / 6 : 0);
  const at = spaces.reduce((a, b) => (score(b) < score(a) ? b : a));
  return [text.slice(0, at), text.slice(at + 1)];
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
  const inner = W - 2 * safe;
  const headerH = card ? 27 : 16;
  const bandH = p.band.kind === 'stripes' ? (card ? 3 : 2.2) : p.band.kind === 'line' ? 1 : 0;
  const panel = card ? 78 : 44;
  const quiet = card ? 5 : 3.6;
  const panelY = headerH + bandH + (card ? 5 : 2.3);
  const footerH = card ? 13 : 11.5;
  const footerY = H - footerH;
  const prims: Primitive[] = [];

  // 1. Header with the owner's headline (first text primitive: the headline). A long headline
  // goes on two lines instead of shrinking until it is hard to read from outside the car.
  prims.push({ kind: 'rect', x: 0, y: 0, w: W, h: headerH, fill: p.header });
  const max = card ? 8.5 : 5.8;
  const lines = headline(input.cta, inner, max, card ? 6.5 : 4.4);
  const ctaSize = Math.min(...lines.map((l) => fit(l, inner, lines.length > 1 ? max * 0.86 : max)));
  const lead = ctaSize * 1.18;
  const firstBase = headerH / 2 - ((lines.length - 1) * lead) / 2 + ctaSize * 0.36;
  lines.forEach((text, i) =>
    prims.push({
      kind: 'text',
      x: safe,
      y: firstBase + i * lead,
      size: ctaSize,
      text,
      fill: p.headerText,
      bold: true,
      width: inner,
    }),
  );
  if (p.band.kind === 'stripes') {
    prims.push({
      kind: 'stripes',
      x: 0,
      y: headerH,
      w: W,
      h: bandH,
      a: p.band.a,
      b: p.band.b,
      step: card ? 3 : 2.2,
    });
  } else if (p.band.kind === 'line') {
    // Inside the frame for templates that have one, edge to edge otherwise.
    const inset = p.border ? 1.5 : 0;
    prims.push({
      kind: 'rect',
      x: inset,
      y: headerH,
      w: W - 2 * inset,
      h: bandH,
      fill: p.band.ink,
    });
  }

  // 2. QR on a white card: always dark-on-white with a quiet zone, so every phone can read it.
  prims.push({
    kind: 'rect',
    x: (W - panel) / 2,
    y: panelY,
    w: panel,
    h: panel,
    fill: white,
    radius: card ? 4 : 2.6,
    stroke: p.frame,
  });
  prims.push({
    kind: 'qr',
    x: (W - panel) / 2 + quiet,
    y: panelY + quiet,
    size: panel - 2 * quiet,
    modules,
    fill: qrDark,
    roundFinders: true,
  });
  const below = panelY + panel;

  // 3. How it works.
  if (card) {
    const steps: [keyof typeof ICONS, string][] = [
      ['camera', 'Scannen'],
      ['choose', 'Problem wählen'],
      ['bell', 'Fahrer informiert'],
    ];
    const col = inner / 3;
    const icon = 7;
    steps.forEach(([name, label], i) => {
      const cx = safe + col * i + col / 2;
      prims.push({
        kind: 'path',
        x: cx - icon / 2,
        y: below + 3.5,
        size: icon,
        box: 24,
        d: ICONS[name],
        fill: null,
        stroke: p.accent,
        strokeWidth: 1.8,
      });
      prims.push({
        kind: 'text',
        x: safe + col * i,
        y: below + 3.5 + icon + 3.6,
        size: fit(label, col - 2, 3, true),
        text: label,
        fill: p.text,
        bold: true,
        width: col,
      });
    });
    const en = 'Scan to notify the driver – no app needed.';
    prims.push({
      kind: 'text',
      x: safe,
      y: footerY - 2.4,
      size: fit(en, inner, 3, false),
      text: en,
      fill: p.text,
      bold: false,
      width: inner,
    });
  } else {
    // One line with a camera icon in front, centred as a group.
    const how = 'Mit der Handykamera scannen – ohne App';
    const size = 2.5;
    const icon = 3.4;
    const gap = 1;
    const tw = textWidth(how, size, true);
    const left = Math.max(safe, (W - (icon + gap + tw)) / 2);
    const base = below + (footerY - below) / 2 + size * 0.36;
    prims.push({
      kind: 'path',
      x: left,
      y: base - size * 0.36 - icon / 2,
      size: icon,
      box: 24,
      d: ICONS.camera,
      fill: null,
      stroke: p.accent,
      strokeWidth: 2.2,
    });
    const tx = left + icon + gap;
    prims.push({
      kind: 'text',
      x: tx,
      y: base,
      size: fit(how, W - safe - tx, size, true),
      text: how,
      fill: p.text,
      bold: true,
      width: W - safe - tx,
      align: 'left',
    });
  }

  // 4. Footer: logo, name, the printed address (SC-15) and the fixed trust sentence.
  prims.push({ kind: 'rect', x: 0, y: footerY, w: W, h: footerH, fill: p.footer });
  const mark = card ? 6.5 : 5.2;
  const row = footerY + (card ? 2 : 1.6);
  const isDark = p.footer === ink || p.footer.rgb === '#111a2e';
  prims.push(...logo(safe + 0.5, row, mark, isDark ? yellow : blue, white));
  const nameX = safe + 0.5 + mark + 1.2;
  const nameSize = card ? 3.6 : 2.9;
  const nameW = textWidth('ParkShield', nameSize, true) + 0.5;
  prims.push({
    kind: 'text',
    x: nameX,
    y: row + mark / 2 + nameSize * 0.36,
    size: nameSize,
    text: 'ParkShield',
    fill: p.footerText,
    bold: true,
    width: nameW,
    align: 'left',
  });
  const urlX = nameX + nameW + 1.5;
  const urlW = W - safe - urlX;
  const urlSize = fit(shown, urlW, card ? 3.4 : 2.6, true);
  prims.push({
    kind: 'text',
    x: urlX,
    y: row + mark / 2 + urlSize * 0.36,
    size: urlSize,
    text: shown,
    fill: p.footerText,
    bold: true,
    width: urlW,
    align: 'right',
  });
  prims.push({
    kind: 'text',
    x: safe,
    // Templates with a frame keep the sentence clear of the frame line.
    y: H - (card ? 2.4 : 2.1) - (p.border ? 0.7 : 0),
    size: fit(FIXED_SENTENCE, inner, card ? 2.8 : 2.15, false),
    text: FIXED_SENTENCE,
    fill: p.footerText,
    bold: false,
    width: inner,
  });

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
