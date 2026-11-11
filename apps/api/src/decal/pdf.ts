import PDFDocument from 'pdfkit';
import type { DecalSpec, Ink } from './layout';

const PT = 72 / 25.4; // points per millimetre
export const BLEED_MM = 3;

type Mode = 'cmyk' | 'rgb';
const color = (ink: Ink, mode: Mode) => (mode === 'cmyk' ? ink.cmyk : ink.rgb);

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Draws the decal with its trim box's top-left at (ox, oy) millimetres. */
function draw(doc: PDFKit.PDFDocument, spec: DecalSpec, ox: number, oy: number, mode: Mode) {
  for (const p of spec.primitives) {
    if (p.kind === 'rect') {
      const args = [(ox + p.x) * PT, (oy + p.y) * PT, p.w * PT, p.h * PT] as const;
      if (p.radius) doc.roundedRect(...args, p.radius * PT);
      else doc.rect(...args);
      if (p.stroke && p.fill)
        doc.lineWidth(0.6 * PT).fillAndStroke(color(p.fill, mode), color(p.stroke, mode));
      else if (p.stroke) doc.lineWidth(0.6 * PT).stroke(color(p.stroke, mode));
      else if (p.fill) doc.fill(color(p.fill, mode));
    } else if (p.kind === 'text') {
      doc
        .font(p.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(p.size * PT)
        .fillColor(color(p.fill, mode))
        .text(p.text, (ox + p.x) * PT, (oy + p.y) * PT, {
          width: p.width * PT,
          align: 'center',
          baseline: 'alphabetic',
          lineBreak: false,
        });
    } else {
      const n = p.modules.length;
      const m = (p.size / n) * PT;
      p.modules.forEach((row, r) =>
        row.forEach((dark, c) => {
          if (dark) doc.rect((ox + p.x) * PT + c * m, (oy + p.y) * PT + r * m, m + 0.05, m + 0.05);
        }),
      );
      doc.fill(color(p.fill, mode));
    }
  }
}

function printPage(doc: PDFKit.PDFDocument, spec: DecalSpec) {
  const w = spec.width + 2 * BLEED_MM;
  const h = spec.height + 2 * BLEED_MM;
  const page = doc.page as unknown as { dictionary: { data: Record<string, unknown> } };
  page.dictionary.data.TrimBox = [
    BLEED_MM * PT,
    BLEED_MM * PT,
    (w - BLEED_MM) * PT,
    (h - BLEED_MM) * PT,
  ];
  page.dictionary.data.BleedBox = [0, 0, w * PT, h * PT];
  doc.rect(0, 0, w * PT, h * PT).fill(spec.background.cmyk); // background runs into the bleed
  draw(doc, spec, BLEED_MM, BLEED_MM, 'cmyk');
}

const printSize = (spec: DecalSpec): [number, number] => [
  (spec.width + 2 * BLEED_MM) * PT,
  (spec.height + 2 * BLEED_MM) * PT,
];

/** Print-ready file for the print shop: CMYK, 3 mm bleed, TrimBox/BleedBox set (US-10). */
export function renderPrintPdf(spec: DecalSpec, title: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: printSize(spec),
    margin: 0,
    info: { Title: title, Creator: 'ParkShield' },
  });
  printPage(doc, spec);
  return toBuffer(doc);
}

/** AD-07: one print file for a pre-printed batch, one decal per page, same print rules. */
export function renderPrintBatchPdf(specs: DecalSpec[], title: string): Promise<Buffer> {
  const [first, ...rest] = specs;
  if (!first) throw new Error('empty batch');
  const doc = new PDFDocument({
    size: printSize(first),
    margin: 0,
    info: { Title: title, Creator: 'ParkShield' },
  });
  printPage(doc, first);
  for (const spec of rest) {
    doc.addPage({ size: printSize(spec), margin: 0 });
    printPage(doc, spec);
  }
  return toBuffer(doc);
}

/** Free print-at-home sheet (OW-04): A4, decal at true size with a dashed cut line and instructions. */
export function renderHomePdf(spec: DecalSpec, title: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: { Title: title, Creator: 'ParkShield' },
  });
  const ox = (210 - spec.width) / 2;
  const oy = 30;
  doc.rect(ox * PT, oy * PT, spec.width * PT, spec.height * PT).fill(spec.background.rgb);
  draw(doc, spec, ox, oy, 'rgb');
  doc
    .lineWidth(0.5)
    .dash(4, { space: 3 })
    .rect(ox * PT, oy * PT, spec.width * PT, spec.height * PT)
    .stroke('#64748b')
    .undash();
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#0f172a')
    .text('Ihr ParkShield-Aufkleber zum Selbstausdrucken', 20 * PT, 12 * PT, {
      width: 170 * PT,
      align: 'center',
    });
  doc
    .font('Helvetica')
    .fontSize(11)
    .text(
      'Bitte in Originalgröße drucken (100 %, nicht „an Seite anpassen“). Entlang der gestrichelten Linie ausschneiden ' +
        'und gut sichtbar hinter die Windschutzscheibe legen. Testen Sie den Aufkleber danach einmal in Ihrem Konto ' +
        'mit „Aufkleber testen“. ParkShield verlangt nie eine Zahlung.',
      20 * PT,
      (oy + spec.height + 12) * PT,
      { width: 170 * PT, align: 'left', lineGap: 3 },
    );
  return toBuffer(doc);
}
