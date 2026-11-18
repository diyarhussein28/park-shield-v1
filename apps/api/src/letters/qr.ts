import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { winAnsi } from './letter-pdf';

export const QR_FORMATS = ['svg', 'png', 'pdf'] as const;
export type QrFormat = (typeof QR_FORMATS)[number];

/** Quiet zone in modules (ISO/IEC 18004 asks for at least 4). */
export const QUIET = 4;
export const PNG_SIZE = 2000;
const PDF_MM = 80;
const PT = 72 / 25.4;

export interface QrInput {
  /** The scanner URL the code encodes. */
  url: string;
  /** Text under the code (short URL), or null. Never a plate, name or customer data. */
  caption: string | null;
}

/** Module matrix, error correction level Q (25 % of the code may be damaged or dirty). */
export function qrMatrix(url: string): boolean[][] {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'Q' });
  const n = qr.modules.size;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => Boolean(qr.modules.data[r * n + c])),
  );
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Vector QR, black on white, one path; units are modules. */
export function qrSvg(input: QrInput): string {
  const m = qrMatrix(input.url);
  const n = m.length;
  const w = n + 2 * QUIET;
  const cap = input.caption ? 4 : 0;
  let d = '';
  m.forEach((row, r) => {
    for (let c = 0; c < n; c++) {
      if (!row[c]) continue;
      let run = 1;
      while (c + run < n && row[c + run]) run++;
      d += `M${c + QUIET} ${r + QUIET}h${run}v1h-${run}z`;
      c += run - 1;
    }
  });
  const fontSize = input.caption
    ? Math.min(2.2, (w - 2) / (0.58 * input.caption.length)).toFixed(2)
    : '0';
  const caption = input.caption
    ? `<text x="${w / 2}" y="${w + 1}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" text-anchor="middle" fill="#000">${esc(input.caption)}</text>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w + cap}" width="${w * 2}mm" height="${(w + cap) * 2}mm" shape-rendering="crispEdges">` +
    `<rect width="${w}" height="${w + cap}" fill="#fff"/><path d="${d}" fill="#000"/>${caption}</svg>`
  );
}

/**
 * Exactly 2000 × 2000 px, white background, crisp module edges (nearest neighbour, no
 * anti-aliasing). The caption is only in SVG and PDF: a raster font would depend on the server.
 */
export async function qrPng(input: QrInput, size = PNG_SIZE): Promise<Buffer> {
  const m = qrMatrix(input.url);
  const n = m.length;
  const w = n + 2 * QUIET;
  const px = Buffer.alloc(size * size, 255);
  for (let y = 0; y < size; y++) {
    const r = Math.floor((y * w) / size) - QUIET;
    if (r < 0 || r >= n) continue;
    const row = m[r]!;
    for (let x = 0; x < size; x++) {
      const c = Math.floor((x * w) / size) - QUIET;
      if (c >= 0 && c < n && row[c]) px[y * size + x] = 0;
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** 80 × 80 mm, vector; with a caption the code shrinks to leave a 6 mm text band. */
export function qrPdf(input: QrInput): Promise<Buffer> {
  const m = qrMatrix(input.url);
  const n = m.length;
  const side = PDF_MM * PT;
  const band = input.caption ? 6 * PT : 0;
  const code = side - band;
  const unit = code / (n + 2 * QUIET);
  const x0 = (side - code) / 2 + QUIET * unit;
  const y0 = QUIET * unit;
  const doc = new PDFDocument({
    size: [side, side],
    margin: 0,
    info: { Title: 'ParkShield QR-Code', Producer: 'ParkShield', CreationDate: new Date(0) },
  });
  doc.rect(0, 0, side, side).fill('#ffffff');
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      // A hair of overlap so adjacent modules print without white seams.
      if (dark) doc.rect(x0 + c * unit, y0 + r * unit, unit + 0.02, unit + 0.02);
    }),
  );
  doc.fill('#000000');
  if (input.caption) {
    doc.font('Helvetica').fontSize(Math.min(9, (side - 8) / (0.55 * input.caption.length)));
    doc.fillColor('#000000').text(winAnsi(input.caption), 0, code + 0.5 * PT, {
      width: side,
      align: 'center',
      lineBreak: false,
    });
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export async function renderQr(
  input: QrInput,
  format: QrFormat,
): Promise<{ file: Buffer; type: string }> {
  if (format === 'svg') return { file: Buffer.from(qrSvg(input)), type: 'image/svg+xml' };
  if (format === 'png') return { file: await qrPng(input), type: 'image/png' };
  return { file: await qrPdf(input), type: 'application/pdf' };
}
