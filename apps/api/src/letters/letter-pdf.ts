import PDFDocument from 'pdfkit';
import { GEOMETRY as G, letterContent, type LetterContent, type LetterSnapshot } from './letter';

const PT = 72 / 25.4; // points per millimetre
const mm = (v: number) => v * PT;

const BODY = 10;
const SMALL = 9; // nothing on the letter is smaller (readable when printed in black and white)
const INK = '#000000';
const GREY = '#555555';

/** Logo and signature of the company-data version the letter was created with. */
export interface LetterImages {
  logoPng: Buffer | null;
  signaturePng: Buffer | null;
}

export interface RenderInput {
  snapshot: LetterSnapshot;
  images: LetterImages;
}

// Characters outside WinAnsi (the encoding of the built-in Helvetica) fall back to their base
// letter (ş → s, ł → l), so a name never prints as garbage. No external font, no CDN.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const FALLBACK: Record<string, string> = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i', ħ: 'h', ŋ: 'n' };
export function winAnsi(s: string): string {
  let out = '';
  for (const ch of s.replace(/[\u202f\u2009]/g, ' ')) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out += ch;
    else if (WIN_ANSI_EXTRA.includes(ch)) out += ch;
    else if (ch === '\n') out += ch;
    else {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]+$/.test(base) ? base : (FALLBACK[ch] ?? '?');
    }
  }
  return out;
}

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function newDoc(created: Date, title: string): PDFKit.PDFDocument {
  return new PDFDocument({
    size: 'A4',
    autoFirstPage: false,
    bufferPages: true,
    margins: {
      top: mm(G.margin.top),
      bottom: mm(G.margin.bottom),
      left: mm(G.margin.left),
      right: mm(G.margin.right),
    },
    // Fixed metadata: the same snapshot always gives the same file.
    info: {
      Title: title,
      Author: 'ParkShield',
      Creator: 'ParkShield',
      Producer: 'ParkShield',
      CreationDate: created,
    },
  });
}

const contentWidth = mm(G.page.w - G.margin.left - G.margin.right);

function header(doc: PDFKit.PDFDocument, c: LetterContent, s: LetterSnapshot, img: LetterImages) {
  const brand = s.company.brandColor;
  if (img.logoPng) {
    doc.image(img.logoPng, mm(G.margin.left), mm(12), { fit: [mm(60), mm(18)] });
  } else {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(brand);
    doc.text('ParkShield', mm(G.margin.left), mm(14), { lineBreak: false });
  }
  doc.font('Helvetica-Bold').fontSize(BODY).fillColor(INK);
  doc.text(winAnsi(c.signatureCompany), mm(105), mm(13), { width: mm(85), align: 'right' });
  doc.font('Helvetica').fontSize(SMALL).fillColor(GREY);
  doc.text(winAnsi(s.company.website), mm(105), doc.y + 1, { width: mm(85), align: 'right' });
  doc
    .moveTo(mm(G.margin.left), mm(38))
    .lineTo(mm(G.page.w - G.margin.right), mm(38))
    .lineWidth(0.8)
    .strokeColor(brand)
    .stroke();

  // Return address: bottom-aligned in the Zusatz- und Vermerkzone, may wrap to two lines.
  const z = G.returnZone;
  doc.font('Helvetica').fontSize(SMALL).fillColor(INK);
  const sender = winAnsi(c.senderLine);
  const h = doc.heightOfString(sender, { width: mm(z.w) });
  doc.text(sender, mm(z.x), mm(z.y + z.h - 1.5) - h, { width: mm(z.w) });

  // Recipient address in the window field.
  const a = G.addressZone;
  let y = a.y + 1;
  if (!c.addressLines.length) {
    doc.font('Helvetica-Bold').fontSize(G.addressSize);
    doc.text('Anschrift fehlt', mm(a.x), mm(y), { width: mm(a.w), lineBreak: false });
  }
  doc.font('Helvetica').fontSize(G.addressSize).fillColor(INK);
  for (const line of c.addressLines) {
    doc.text(winAnsi(line), mm(a.x), mm(y), { width: mm(a.w), lineBreak: false, ellipsis: true });
    y += G.addressLine;
  }

  // Information block (right).
  const ib = G.infoBlock;
  let iy = mm(ib.y);
  for (const [label, value] of c.info) {
    doc.font('Helvetica').fontSize(SMALL).fillColor(GREY);
    doc.text(label, mm(ib.x), iy, { width: mm(28), lineBreak: false });
    doc.font('Helvetica').fontSize(SMALL).fillColor(INK);
    const opts = { width: mm(ib.w - 28 - 5) };
    let v = winAnsi(value);
    // A long e-mail address breaks after the @, not somewhere inside the domain.
    if (v.includes('@') && doc.widthOfString(v) > opts.width) v = v.replace('@', '@\n');
    doc.text(v, mm(ib.x + 28), iy, opts);
    iy += Math.max(doc.heightOfString(v, opts), SMALL * 1.2) + mm(0.8);
  }

  // Fold marks (DIN 5008) and punch mark at the left edge.
  doc.lineWidth(0.5).strokeColor(GREY);
  for (const f of G.foldMarks) doc.moveTo(mm(4), mm(f)).lineTo(mm(9), mm(f)).stroke();
  doc.moveTo(mm(4), mm(G.punchMark)).lineTo(mm(11), mm(G.punchMark)).stroke();

  return Math.max(mm(G.bodyTop), iy + mm(4));
}

function body(doc: PDFKit.PDFDocument, c: LetterContent, img: LetterImages, top: number) {
  const left = mm(G.margin.left);
  doc.fillColor(INK);
  doc.font('Helvetica-Bold').fontSize(11).text(winAnsi(c.subject), left, top, {
    width: contentWidth,
  });
  doc.moveDown(1);
  doc.font('Helvetica').fontSize(BODY).text(winAnsi(c.greeting), left, doc.y, {
    width: contentWidth,
  });
  doc.moveDown(0.6);
  const text = { width: contentWidth, lineGap: 1.2 };
  let prev: string | null = null;
  for (const b of c.blocks) {
    if (b.kind === 'heading') {
      // Keep a heading with at least two lines of what follows.
      if (doc.y + BODY * 4 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      else doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(BODY).text(winAnsi(b.text), left, doc.y, text);
      doc.moveDown(0.25);
    } else if (b.kind === 'paragraph') {
      if (prev === 'bullets') doc.moveDown(0.4);
      doc.font('Helvetica').fontSize(BODY).text(winAnsi(b.text), left, doc.y, text);
    } else if (b.kind === 'bullets') {
      doc.font('Helvetica').fontSize(BODY);
      doc.list(
        b.items.map((i) => winAnsi(i)),
        left,
        doc.y,
        {
          ...text,
          bulletRadius: 1.3,
          textIndent: mm(5),
          bulletIndent: mm(1),
          paragraphGap: 0.5,
        } as PDFKit.Mixins.TextOptions,
      );
    } else if (b.kind === 'pairs') {
      for (const [k, v] of b.items) {
        doc
          .font('Helvetica')
          .fontSize(BODY)
          .text(`${winAnsi(k)}: `, left, doc.y, {
            ...text,
            continued: true,
          });
        doc.font('Helvetica-Bold').text(winAnsi(v), text);
      }
    } else {
      doc.moveDown(0.6);
    }
    prev = b.kind;
  }
  // Closing with room for a handwritten or printed signature; kept together on one page.
  if (doc.y + mm(27) > doc.page.height - doc.page.margins.bottom) doc.addPage();
  else doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(BODY).text(winAnsi(c.closing), left, doc.y, text);
  if (img.signaturePng) {
    doc.image(img.signaturePng, left, doc.y + mm(1), { fit: [mm(45), mm(11)] });
    doc.y += mm(13);
  } else {
    doc.y += mm(10);
  }
  if (c.signatureName) doc.text(winAnsi(c.signatureName), left, doc.y, text);
  doc.text(winAnsi(c.signatureCompany), left, doc.y, text);
}

function footers(doc: PDFKit.PDFDocument, c: LetterContent, from: number, to: number) {
  const n = to - from;
  for (let i = from; i < to; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin would start a new page; lift the margin while drawing.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const top = mm(G.footerTop);
    if (n > 1) {
      doc.font('Helvetica').fontSize(SMALL).fillColor(GREY);
      doc.text(`Seite ${i - from + 1} von ${n}`, mm(G.margin.left), top - mm(6), {
        width: contentWidth,
        align: 'right',
        lineBreak: false,
      });
    }
    doc
      .moveTo(mm(G.margin.left), top - mm(1.5))
      .lineTo(mm(G.page.w - G.margin.right), top - mm(1.5))
      .lineWidth(0.4)
      .strokeColor(GREY)
      .stroke();
    const cols = c.footer.length || 1;
    const w = contentWidth / cols;
    c.footer.forEach((col, ci) => {
      doc.font('Helvetica').fontSize(SMALL).fillColor(GREY);
      doc.text(winAnsi(col.join('\n')), mm(G.margin.left) + ci * w, top, {
        width: w - mm(2),
        lineGap: 0.5,
      });
    });
    doc.page.margins.bottom = bottom;
  }
}

function draw(doc: PDFKit.PDFDocument, input: RenderInput) {
  const c = letterContent(input.snapshot);
  const first = doc.bufferedPageRange().count;
  doc.addPage();
  const top = header(doc, c, input.snapshot, input.images);
  body(doc, c, input.images, top);
  footers(doc, c, first, doc.bufferedPageRange().count);
}

/** One welcome letter as PDF (A4, DIN 5008 Form B). */
export function renderLetterPdf(input: RenderInput): Promise<Buffer> {
  const doc = newDoc(new Date(input.snapshot.date), 'Willkommen bei ParkShield');
  draw(doc, input);
  return toBuffer(doc);
}

/** Several letters in one file for printing; each letter starts on a new page. */
export function renderLettersPdf(inputs: RenderInput[]): Promise<Buffer> {
  const latest = inputs.reduce((m, i) => Math.max(m, Date.parse(i.snapshot.date)), 0);
  const doc = newDoc(new Date(latest), 'ParkShield Willkommensbriefe');
  for (const input of inputs) draw(doc, input);
  return toBuffer(doc);
}
