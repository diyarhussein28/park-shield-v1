import PDFDocument from 'pdfkit';
import type { DecalSpec, Ink } from './layout';
import { finderOrigins, inFinder, stripeQuads } from './svg';

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
          align: p.align ?? 'center',
          baseline: 'alphabetic',
          lineBreak: false,
        });
    } else if (p.kind === 'path') {
      doc.save();
      doc.translate((ox + p.x) * PT, (oy + p.y) * PT).scale((p.size / p.box) * PT);
      doc.path(p.d);
      if (p.stroke) {
        doc
          .lineWidth(p.strokeWidth ?? 2)
          .lineCap('round')
          .lineJoin('round');
        if (p.fill) doc.fillAndStroke(color(p.fill, mode), color(p.stroke, mode));
        else doc.stroke(color(p.stroke, mode));
      } else if (p.fill) doc.fill(color(p.fill, mode));
      doc.restore();
    } else if (p.kind === 'stripes') {
      const x = (ox + p.x) * PT;
      const y = (oy + p.y) * PT;
      doc.save();
      doc.rect(x, y, p.w * PT, p.h * PT).clip();
      doc.rect(x, y, p.w * PT, p.h * PT).fill(color(p.b, mode));
      for (const q of stripeQuads(p)) {
        doc.polygon(...q.map(([qx, qy]) => [(ox + qx) * PT, (oy + qy) * PT] as [number, number]));
        doc.fill(color(p.a, mode));
      }
      doc.restore();
    } else {
      const n = p.modules.length;
      const m = (p.size / n) * PT;
      const x0 = (ox + p.x) * PT;
      const y0 = (oy + p.y) * PT;
      p.modules.forEach((row, r) =>
        row.forEach((dark, c) => {
          if (dark && !(p.roundFinders && inFinder(r, c, n)))
            doc.rect(x0 + c * m, y0 + r * m, m + 0.05, m + 0.05);
        }),
      );
      doc.fill(color(p.fill, mode));
      if (p.roundFinders) {
        const paper: Ink = { rgb: '#ffffff', cmyk: [0, 0, 0, 0] };
        for (const [r, c] of finderOrigins(n)) {
          const x = x0 + c * m;
          const y = y0 + r * m;
          doc.roundedRect(x, y, 7 * m, 7 * m, 2 * m).fill(color(p.fill, mode));
          doc.roundedRect(x + m, y + m, 5 * m, 5 * m, 1.4 * m).fill(color(paper, mode));
          doc.roundedRect(x + 2 * m, y + 2 * m, 3 * m, 3 * m, 0.9 * m).fill(color(p.fill, mode));
        }
      }
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

/** Crop marks: 5 mm lines, 2 mm away from each corner of the trim box (outside the decal). */
function cropMarks(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number) {
  const gap = 2;
  const len = 5;
  doc.save().lineWidth(0.5).strokeColor('#0f172a');
  for (const [cx, cy] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ] as const) {
    const dx = cx === x ? -1 : 1;
    const dy = cy === y ? -1 : 1;
    doc
      .moveTo((cx + dx * gap) * PT, cy * PT)
      .lineTo((cx + dx * (gap + len)) * PT, cy * PT)
      .stroke();
    doc
      .moveTo(cx * PT, (cy + dy * gap) * PT)
      .lineTo(cx * PT, (cy + dy * (gap + len)) * PT)
      .stroke();
  }
  doc.restore();
}

/**
 * Free print-at-home sheet (OW-04, owner decision 2026-11-21): A4, the decal at true size
 * (80 × 80 mm) with crop marks and a dashed cut line, the instructions and the weatherproof notice.
 */
export function renderHomePdf(spec: DecalSpec, title: string, locale: 'de' | 'en' = 'de'): Promise<Buffer> {
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
  cropMarks(doc, ox, oy, spec.width, spec.height);
  const t =
    locale === 'en'
      ? {
          head: 'Your ParkShield decal to print yourself',
          size: `Size: ${spec.width} × ${spec.height} mm.`,
          how:
            'Print at actual size (100 %, not “fit to page”). Cut along the marks and place the decal clearly visible behind the windscreen. Then test it once in the app with “Test your decal”. ParkShield never asks for payment.',
          paper:
            'Plain paper does not stand up to sun, rain and the car wash for long. We recommend weatherproof polyester labels for laser printers.',
        }
      : {
          head: 'Ihr ParkShield-Aufkleber zum Selbstausdrucken',
          size: `Größe: ${spec.width} × ${spec.height} mm.`,
          how:
            'Bitte in Originalgröße drucken (100 %, nicht „an Seite anpassen“). Entlang der Schnittmarken ausschneiden und gut sichtbar hinter die Windschutzscheibe legen. Testen Sie den Aufkleber danach einmal mit „Aufkleber testen“. ParkShield verlangt nie eine Zahlung.',
          paper:
            'Normales Papier hält Sonne, Regen und Waschanlage nicht lange stand. Wir empfehlen wetterfeste Polyester-Etiketten für Laserdrucker.',
        };
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#0f172a')
    .text(t.head, 20 * PT, 12 * PT, { width: 170 * PT, align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(11)
    .text(`${t.size} ${t.how}`, 20 * PT, (oy + spec.height + 14) * PT, {
      width: 170 * PT,
      align: 'left',
      lineGap: 3,
    });
  doc
    .moveDown(0.8)
    .font('Helvetica-Bold')
    .text(t.paper, { width: 170 * PT, align: 'left', lineGap: 3 });
  return toBuffer(doc);
}
