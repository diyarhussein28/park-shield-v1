import PDFDocument from 'pdfkit';
import { drawLogoMark, headingFonts, mm, winAnsi } from '../core/pdf-brand';
import { layoutStockSticker } from '../decal/stock-sticker';
import { drawDecal } from '../decal/pdf';
import { MAIL_ICONS } from '../mail/icons';
import {
  GEOMETRY as G,
  letterContent,
  type LetterContent,
  type LetterSnapshot,
  type StepIcon,
} from './letter';

export { winAnsi };

/*
 * The welcome letter (redesign 2026-11-28, owner mockup): one A4 page in the look of the contract
 * confirmation — brand header, the address in the DIN 5008 window field (DL window envelope), the
 * printed sticker beside it, then cards for the contract and the vehicle, the plan's services, four
 * steps to start and a short closing. Printed in colour or black and white; nothing is smaller than 7.5 pt.
 */

const NAVY = '#0b2a6b';
const INK = '#0f172a';
const GREY = '#475569';
const PANEL = '#f5f8ff';
const LINE = '#dbe3ef';
const GREEN = '#16a34a';

/** Logo and signature of the company-data version the letter was created with. */
export interface LetterImages {
  logoPng: Buffer | null;
  signaturePng: Buffer | null;
}

export interface RenderInput {
  snapshot: LetterSnapshot;
  images: LetterImages;
}

/** Line icons (24 × 24, stroke 2): the e-mail set plus the four step icons. */
const ICONS: Record<string, string> = {
  ...MAIL_ICONS,
  bell: 'M6 9a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8 M10 21h4',
  sticker: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 18h2v2h-2z M14 18v2 M18 14h2',
  nfc: 'M6 9a4.5 4.5 0 0 1 0 6 M10 6a9 9 0 0 1 0 12 M14 3a13.5 13.5 0 0 1 0 18',
  rocket:
    'M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1Z M12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2Z M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0 M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5',
};
const STEP_ICON: Record<StepIcon, string> = {
  phone: 'phone',
  bell: 'bell',
  sticker: 'sticker',
  nfc: 'nfc',
};

function icon(
  doc: PDFKit.PDFDocument,
  name: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  doc.save();
  doc.translate(x, y).scale(size / 24);
  doc
    .path(ICONS[name]!)
    .lineWidth(2)
    .lineCap('round')
    .lineJoin('round')
    .strokeColor(color)
    .stroke();
  doc.restore();
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

/** The example sticker (serial PS-000123, QR code to the home page): never a customer's real code. */
const STICKER = layoutStockSticker({
  code: 'BEISPIEL',
  scannerBaseUrl: 'https://park-shield.de',
  serial: 'PS-000123',
});

class Painter {
  readonly left = mm(G.margin.left);
  readonly width = mm(G.page.w - G.margin.left - G.margin.right);
  readonly bottom = mm(G.footerTop - 3);
  readonly head: { bold: string; extra: string; hasFonts: boolean };
  constructor(
    readonly doc: PDFKit.PDFDocument,
    readonly c: LetterContent,
    readonly s: LetterSnapshot,
    readonly img: LetterImages,
  ) {
    this.head = headingFonts(doc);
  }
  get brand() {
    return this.s.company.brandColor;
  }
  /** Headings use Plus Jakarta Sans (every character); Helvetica only knows WinAnsi. */
  ht(t: string) {
    return this.head.hasFonts ? t : winAnsi(t);
  }
  textH(t: string, w: number, size: number, bold = false, gap = 1.3) {
    return this.doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .heightOfString(winAnsi(t), { width: w, lineGap: gap });
  }
  text(
    t: string,
    x: number,
    y: number,
    o: {
      w: number;
      size: number;
      bold?: boolean;
      color?: string;
      align?: 'left' | 'center' | 'right';
    },
  ) {
    this.doc
      .font(o.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(o.size)
      .fillColor(o.color ?? INK)
      .text(winAnsi(t), x, y, { width: o.w, lineGap: 1.3, align: o.align ?? 'left' });
  }
  heading(t: string, x: number, y: number, size: number, w: number) {
    this.doc
      .font(this.head.extra)
      .fontSize(size)
      .fillColor(INK)
      .text(this.ht(t), x, y, { width: w, lineBreak: false });
  }
  /** Starts a new page when `h` does not fit; returns the y to draw at. */
  fit(y: number, h: number) {
    if (y + h <= this.bottom) return y;
    this.doc.addPage();
    return mm(G.margin.top);
  }

  header() {
    const { doc, c, s, img, left } = this;
    const right = mm(G.page.w - G.margin.right);
    if (img.logoPng) {
      doc.image(img.logoPng, left, mm(11), { fit: [mm(62), mm(17)] });
    } else {
      drawLogoMark(doc, left, mm(11.5), mm(15));
      doc
        .font(this.head.extra)
        .fontSize(25)
        .fillColor(NAVY)
        .text('Park', left + mm(17.5), mm(11.2), { continued: true, lineBreak: false })
        .fillColor(this.brand)
        .text('Shield', { lineBreak: false });
      this.text('Der smarte Aufkleber für Ihr Auto', left + mm(17.8), mm(21.6), {
        w: mm(70),
        size: 8.5,
        color: GREY,
      });
    }
    const firm = [s.company.name, s.company.legalForm].filter(Boolean).join(' ');
    doc
      .font(this.head.extra)
      .fontSize(10.5)
      .fillColor(NAVY)
      .text(this.ht(firm), mm(100), mm(12), { width: right - mm(100), align: 'right' });
    const lines = [
      `${s.company.street} · ${s.company.postalCode} ${s.company.city}`,
      s.company.vatId && `USt-IdNr.: ${s.company.vatId}`,
    ].filter(Boolean) as string[];
    this.text(lines.join('\n'), mm(100), doc.y + 1, {
      w: right - mm(100),
      size: 8.5,
      color: GREY,
      align: 'right',
    });
    doc.moveTo(left, mm(32)).lineTo(right, mm(32)).lineWidth(1).strokeColor(this.brand).stroke();

    // Return address: bottom-aligned in the Zusatz- und Vermerkzone, may wrap to two lines.
    const z = G.returnZone;
    const sender = winAnsi(c.senderLine);
    doc.font('Helvetica').fontSize(7.5).fillColor(GREY);
    const h = doc.heightOfString(sender, { width: mm(z.w) });
    doc.text(sender, mm(z.x), mm(z.y + z.h - 1.5) - h, { width: mm(z.w) });

    // Recipient address in the window field.
    const a = G.addressZone;
    let y = a.y + 1;
    if (!c.addressLines.length) {
      doc.font('Helvetica-Bold').fontSize(G.addressSize).fillColor(INK);
      doc.text('Anschrift fehlt', mm(a.x), mm(y), { width: mm(a.w), lineBreak: false });
    }
    doc.font('Helvetica').fontSize(G.addressSize).fillColor(INK);
    for (const line of c.addressLines) {
      doc.text(winAnsi(line), mm(a.x), mm(y), { width: mm(a.w), lineBreak: false, ellipsis: true });
      y += G.addressLine;
    }

    // Fold marks (DIN 5008) and punch mark at the left edge.
    doc.lineWidth(0.5).strokeColor(GREY);
    for (const f of G.foldMarks) doc.moveTo(mm(4), mm(f)).lineTo(mm(9), mm(f)).stroke();
    doc.moveTo(mm(4), mm(G.punchMark)).lineTo(mm(11), mm(G.punchMark)).stroke();

    this.sticker();
  }

  /** The printed sticker, slightly turned, on a pale blue swoosh right of the window field. */
  sticker() {
    const { doc } = this;
    const b = G.stickerBox;
    doc.save();
    doc
      .path(
        `M ${mm(b.x + 6)} ${mm(b.y + b.h)} C ${mm(b.x + 16)} ${mm(b.y + 18)} ${mm(b.x + 40)} ${mm(b.y + 2)} ${mm(b.x + b.w)} ${mm(b.y)} L ${mm(b.x + b.w)} ${mm(b.y + b.h)} Z`,
      )
      .fill('#eaf1ff');
    doc.restore();
    const size = 40; // mm
    const k = size / STICKER.width;
    const x = mm(b.x + b.w - size - 9);
    const y = mm(b.y + 5);
    doc.save();
    doc.rotate(-6, { origin: [x + mm(size / 2), y + mm(size / 2)] });
    doc
      .roundedRect(x + mm(1.2), y + mm(1.8), mm(size), mm(size), mm(3.2))
      .fillOpacity(0.18)
      .fill('#0b2a6b');
    doc.fillOpacity(1);
    doc.translate(x, y).scale(k);
    doc.roundedRect(0, 0, mm(STICKER.width), mm(STICKER.height), mm(7)).clip();
    doc.rect(0, 0, mm(STICKER.width), mm(STICKER.height)).fill(STICKER.background.rgb);
    drawDecal(doc, STICKER, 0, 0, 'rgb');
    doc.restore();
  }

  /** Title, greeting and the welcome text. */
  intro(): number {
    const { doc, c, left, width } = this;
    let y = mm(G.bodyTop);
    // The date sits on the title's line, on the right.
    this.text(c.dateLine, left, y + mm(2.8), { w: width, size: 9, color: GREY, align: 'right' });
    const pre = 'Willkommen bei ';
    if (c.title.startsWith(pre)) {
      doc
        .font(this.head.extra)
        .fontSize(19.5)
        .fillColor(INK)
        .text(this.ht(pre), left, y, { continued: true, lineBreak: false })
        .fillColor(this.brand)
        .text(this.ht(c.title.slice(pre.length)), { lineBreak: false });
    } else {
      this.heading(c.title, left, y, 19.5, width);
    }
    y += mm(10);
    this.text(c.greeting, left, y, { w: width, size: 10 });
    y += this.textH(c.greeting, width, 10) + mm(0.8);
    this.text(c.intro, left, y, { w: width, size: 10 });
    return y + this.textH(c.intro, width, 10) + mm(4);
  }

  /** A bordered card with a tinted head (icon + heading) and label/value rows. */
  rowsCard(
    x: number,
    y: number,
    w: number,
    h: number,
    iconName: string,
    title: string,
    rows: [string, string][],
    labelW: number,
  ) {
    const { doc } = this;
    doc.roundedRect(x, y, w, h, mm(3)).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.save();
    doc.roundedRect(x, y, w, h, mm(3)).clip();
    doc.rect(x, y, w, mm(8.5)).fill(PANEL);
    doc.restore();
    icon(doc, iconName, x + mm(3.5), y + mm(2), mm(4.4), this.brand);
    this.heading(title, x + mm(9.8), y + mm(1.9), 11, w - mm(13));
    let ry = y + mm(10);
    rows.forEach(([label, value], i) => {
      if (i)
        doc
          .moveTo(x + mm(3.5), ry - mm(0.8))
          .lineTo(x + w - mm(3.5), ry - mm(0.8))
          .lineWidth(0.4)
          .strokeColor(LINE)
          .stroke();
      this.text(label, x + mm(3.5), ry, { w: labelW, size: 8.8, color: GREY });
      this.text(value, x + mm(3.5) + labelW, ry, { w: w - labelW - mm(7), size: 8.8, bold: true });
      ry += this.rowH(label, value, w, labelW);
    });
  }

  rowH(label: string, value: string, w: number, labelW: number) {
    return (
      Math.max(this.textH(value, w - labelW - mm(7), 8.8, true), this.textH(label, labelW, 8.8)) +
      mm(1.2)
    );
  }

  rowsHeight(rows: [string, string][], w: number, labelW: number) {
    return mm(10) + rows.reduce((a, [l, v]) => a + this.rowH(l, v, w, labelW), 0) + mm(0.6);
  }

  /** Contract (left) | vehicle and contact (right). */
  cards(y0: number): number {
    const { c, s, left, width } = this;
    const gap = mm(5);
    const rightW = mm(60);
    const leftW = width - rightW - gap;
    const contact: [string, string][] = [
      ['E-Mail', s.company.email],
      ['Telefon', s.company.phone],
    ].filter(([, v]) => v) as [string, string][];
    const hLeft = this.rowsHeight(c.info, leftW, mm(28));
    const hVehicle = this.rowsHeight(c.vehicle, rightW, mm(21));
    const hContact = this.rowsHeight(contact, rightW, mm(15));
    const total = Math.max(hLeft, hVehicle + mm(3.5) + hContact);
    const y = this.fit(y0, total);
    this.rowsCard(left, y, leftW, total, 'file', 'Ihre Vertragsdaten', c.info, mm(28));
    const x = left + leftW + gap;
    this.rowsCard(x, y, rightW, hVehicle, 'car', 'Ihr Fahrzeug', c.vehicle, mm(21));
    const cy = y + hVehicle + mm(3.5);
    this.rowsCard(x, cy, rightW, total - hVehicle - mm(3.5), 'mail', 'Kontakt', contact, mm(15));
    return y + total + mm(3.2);
  }

  benefits(y0: number): number {
    const { doc, c, left, width } = this;
    if (!c.benefits.length) return y0;
    const colW = (width - mm(14)) / 2;
    const half = Math.ceil(c.benefits.length / 2);
    const cols = [c.benefits.slice(0, half), c.benefits.slice(half)];
    const colH = cols.map((col) =>
      col.reduce((a, b) => a + this.textH(b, colW - mm(6), 8.8) + mm(1), 0),
    );
    const total = mm(10.5) + Math.max(...colH) + mm(1.2);
    const y = this.fit(y0, total);
    doc.roundedRect(left, y, width, total, mm(3)).fill(PANEL);
    doc.circle(left + mm(6.2), y + mm(5), mm(2.9)).fill(this.brand);
    icon(doc, 'check', left + mm(4.3), y + mm(3.1), mm(3.8), '#ffffff');
    this.heading(
      `Ihre Leistungen im Tarif ${this.s.contract.planName}`,
      left + mm(11.5),
      y + mm(2.4),
      11,
      width - mm(15),
    );
    cols.forEach((col, ci) => {
      let by = y + mm(10);
      const x = left + mm(5) + ci * (colW + mm(4));
      for (const b of col) {
        icon(doc, 'check', x, by - mm(0.2), mm(3.6), GREEN);
        this.text(b, x + mm(5.5), by, { w: colW - mm(6), size: 8.8 });
        by += this.textH(b, colW - mm(6), 8.8) + mm(1);
      }
    });
    return y + total + mm(3.2);
  }

  steps(y0: number): number {
    const { doc, c, left, width } = this;
    const n = c.steps.length;
    const arrow = mm(5);
    const w = (width - (n - 1) * arrow) / n;
    const inner = w - mm(4);
    const textH = Math.max(
      ...c.steps.map(
        (st) => this.textH(st.title, inner, 9.2, true) + mm(0.6) + this.textH(st.text, inner, 7.8),
      ),
    );
    const cardH = mm(10.2) + textH + mm(1.8);
    const total = mm(6.8) + cardH;
    let y = this.fit(y0, total);
    icon(doc, 'rocket', left, y + mm(0.2), mm(5), this.brand);
    this.heading('So starten Sie', left + mm(7.5), y, 12, width);
    y += mm(6.8);
    c.steps.forEach((st, i) => {
      const x = left + i * (w + arrow);
      doc.roundedRect(x, y, w, cardH, mm(3)).lineWidth(0.8).strokeColor(LINE).stroke();
      doc.circle(x + mm(4.6), y + mm(4.6), mm(2.8)).fill(this.brand);
      doc
        .font(this.head.extra)
        .fontSize(9)
        .fillColor('#ffffff')
        .text(String(i + 1), x + mm(1.8), y + mm(2.8), { width: mm(5.6), align: 'center' });
      icon(doc, STEP_ICON[st.icon], x + w / 2 - mm(2.9), y + mm(2.2), mm(5.8), INK);
      let ty = y + mm(9.6);
      this.text(st.title, x + mm(2), ty, { w: inner, size: 9.2, bold: true, align: 'center' });
      ty += this.textH(st.title, inner, 9.2, true) + mm(0.6);
      this.text(st.text, x + mm(2), ty, { w: inner, size: 7.8, color: GREY, align: 'center' });
      if (i < n - 1) {
        const ax = x + w + mm(1);
        const ay = y + cardH / 2;
        doc
          .moveTo(ax, ay)
          .lineTo(ax + mm(3), ay)
          .moveTo(ax + mm(1.8), ay - mm(1.2))
          .lineTo(ax + mm(3), ay)
          .lineTo(ax + mm(1.8), ay + mm(1.2))
          .lineWidth(1)
          .lineCap('round')
          .lineJoin('round')
          .strokeColor(this.brand)
          .stroke();
      }
    });
    return y + cardH + mm(3.5);
  }

  /** Term in short (left), closing with signature (right). */
  closing(y0: number) {
    const { doc, c, img, left, width } = this;
    const rightW = mm(52);
    const leftW = width - rightW - mm(7);
    const leftH = this.textH(c.terms, leftW, 8, false, 1);
    const sigH = img.signaturePng ? mm(9) : mm(3);
    const rightH =
      this.textH(c.closing, rightW, 9.5) +
      sigH +
      (c.signatureName ? this.textH(c.signatureName, rightW, 9.5) : 0) +
      this.textH(c.signatureCompany, rightW, 8);
    const y = this.fit(y0, Math.max(leftH, rightH));
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GREY)
      .text(winAnsi(c.terms), left, y, { width: leftW, lineGap: 1 });
    const x = left + width - rightW;
    this.text(c.closing, x, y, { w: rightW, size: 9.5 });
    let sy = y + this.textH(c.closing, rightW, 9.5);
    if (img.signaturePng) doc.image(img.signaturePng, x, sy + mm(1), { fit: [mm(36), mm(7.5)] });
    sy += sigH;
    if (c.signatureName) {
      this.text(c.signatureName, x, sy, { w: rightW, size: 9.5, bold: true });
      sy += this.textH(c.signatureName, rightW, 9.5, true);
    }
    this.text(c.signatureCompany, x, sy, { w: rightW, size: 8, color: GREY });
  }

  footers(from: number, to: number) {
    const { doc, c, left, width } = this;
    const n = to - from;
    for (let i = from; i < to; i++) {
      doc.switchToPage(i);
      // Writing below the bottom margin would start a new page; lift the margin while drawing.
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const top = mm(G.footerTop);
      if (n > 1)
        this.text(`Seite ${i - from + 1} von ${n}`, left, top - mm(5.5), {
          w: width,
          size: 7.5,
          color: GREY,
          align: 'right',
        });
      doc
        .moveTo(left, top - mm(1.8))
        .lineTo(left + width, top - mm(1.8))
        .lineWidth(0.8)
        .strokeColor(this.brand)
        .stroke();
      const cols = c.footer.length || 1;
      const w = width / cols;
      c.footer.forEach((col, ci) => {
        doc.font('Helvetica').fontSize(7.5).fillColor(GREY);
        doc.text(winAnsi(col.join('\n')), left + ci * w, top, { width: w - mm(2), lineGap: 0.5 });
      });
      doc.page.margins.bottom = keep;
    }
  }
}

function draw(doc: PDFKit.PDFDocument, input: RenderInput) {
  const c = letterContent(input.snapshot);
  const first = doc.bufferedPageRange().count;
  doc.addPage();
  const p = new Painter(doc, c, input.snapshot, input.images);
  p.header();
  let y = p.intro();
  y = p.cards(y);
  y = p.benefits(y);
  y = p.steps(y);
  p.closing(y);
  p.footers(first, doc.bufferedPageRange().count);
}

/** One welcome letter as PDF (A4, DIN 5008 Form B, one page). */
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
