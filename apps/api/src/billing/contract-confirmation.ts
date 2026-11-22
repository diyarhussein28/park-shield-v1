import { legalDoc, renewalRule, type LegalDoc } from '@parkshield/shared';
import PDFDocument from 'pdfkit';
import { winAnsi } from '../letters/letter-pdf';

/**
 * The PDF „Vertragsbestätigung“ attached to the contract confirmation e-mail (§ 312f BGB, durable
 * medium, 2026-11-22). Built in two steps so the content is testable without parsing a PDF:
 * `contractConfirmationContent()` (the text, section by section) and `renderContractConfirmationPdf()`
 * (pdfkit, built-in Helvetica, A4). Which versions were sent is stored in `contract_confirmations`.
 *
 * TODO [LEGAL REVIEW]: every text in this file (contract data wording, renewal and cancellation rules,
 * the English model withdrawal form, the list of included services). LEGAL_REVIEW.md §1.
 */

export interface ContractConfirmationInput {
  locale: 'de' | 'en';
  customerNo: string;
  contractNo: string;
  /** e.g. „20,00 €“ */
  price: string;
  startedAt: Date;
  /** End of the current term = next renewal date. */
  renewsAt: Date;
  renewalMode: 'annual' | 'monthly_after_first_term';
  docVersion: string;
  /** The immediate-start declaration (§ 356 Abs. 4 BGB) as accepted, with its time. */
  consent: { text: string; at: Date } | null;
  company: { name: string; street: string; postalCode: string; city: string; email: string };
  webBaseUrl: string;
}

export interface PdfSection {
  /** Which part of the confirmation this is (tests check that every part is there). */
  part:
    | 'contract'
    | 'renewal'
    | 'immediate_start'
    | 'benefits'
    | 'agb'
    | 'widerruf'
    | 'muster_widerrufsformular';
  heading: string;
  paragraphs: string[];
  /** Bigger heading: the start of an included legal document. */
  document?: boolean;
}

export interface PdfContent {
  title: string;
  intro: string;
  sections: PdfSection[];
}

const date = (d: Date, locale: 'de' | 'en') =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  }).format(d);
const time = (d: Date, locale: 'de' | 'en') =>
  new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(d);

const docParagraphs = (doc: LegalDoc['sections']) =>
  doc.flatMap((s) => [`§§ ${s.heading}`, ...s.paragraphs]);

/** The English model withdrawal form (Annex 2 to Art. 246a § 1 EGBGB). TODO [LEGAL REVIEW] */
const MODEL_FORM_EN = (c: ContractConfirmationInput['company']) => [
  '(Complete and return this form only if you wish to withdraw from the contract.)',
  `To ${c.name}, ${c.street}, ${c.postalCode} ${c.city}, Germany, e-mail: ${c.email}:`,
  'I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the provision of the following service: ParkShield subscription, contract number ______',
  'Ordered on (*) / received on (*): ______',
  'Name of consumer(s): ______',
  'Address of consumer(s): ______',
  'Signature of consumer(s) (only if this form is notified on paper): ______',
  'Date: ______',
  '(*) Delete as appropriate.',
];

export function contractConfirmationContent(i: ContractConfirmationInput): PdfContent {
  const de = i.locale === 'de';
  const l = i.locale;
  const web = i.webBaseUrl.replace(/\/+$/, '');
  const agb = legalDoc(l, 'agb', { renewalMode: i.renewalMode });
  const widerruf = legalDoc(l, 'widerruf', { renewalMode: i.renewalMode });
  const isForm = (h: string) => /Muster-Widerrufsformular|model withdrawal form/i.test(h);
  const policy = widerruf.sections.filter((s) => !isForm(s.heading));
  const form = widerruf.sections.find((s) => isForm(s.heading));

  return {
    title: de ? 'Vertragsbestätigung' : 'Contract confirmation',
    intro: de
      ? `Hiermit bestätigen wir Ihren Vertrag über ParkShield. Dieses Dokument ist Ihre Vertragsbestätigung auf einem dauerhaften Datenträger (§ 312f BGB). Fassung der Vertragstexte: ${i.docVersion}.`
      : `This confirms your ParkShield contract. This document is your contract confirmation on a durable medium (§ 312f BGB). Version of the contract texts: ${i.docVersion}. The German version is binding.`,
    sections: [
      {
        part: 'contract',
        heading: de ? 'Vertragsdaten' : 'Contract details',
        paragraphs: de
          ? [
              `Kundennummer: ${i.customerNo}`,
              `Vertragsnummer: ${i.contractNo}`,
              'Tarif: ParkShield – ein Fahrzeug, alles inklusive',
              `Vertragsbeginn: ${date(i.startedAt, l)}`,
              `Nächste Verlängerung: ${date(i.renewsAt, l)}`,
              `Preis: ${i.price} pro Jahr inklusive 19 % MwSt.`,
              `Anbieter: ${i.company.name}, ${i.company.street}, ${i.company.postalCode} ${i.company.city}, ${i.company.email}`,
            ]
          : [
              `Customer number: ${i.customerNo}`,
              `Contract number: ${i.contractNo}`,
              'Plan: ParkShield – one vehicle, everything included',
              `Start: ${date(i.startedAt, l)}`,
              `Next renewal: ${date(i.renewsAt, l)}`,
              `Price: ${i.price} per year including 19% VAT`,
              `Provider: ${i.company.name}, ${i.company.street}, ${i.company.postalCode} ${i.company.city}, Germany, ${i.company.email}`,
            ],
      },
      {
        part: 'renewal',
        heading: de ? 'Laufzeit, Verlängerung und Kündigung' : 'Term, renewal and cancellation',
        paragraphs: de
          ? [
              renewalRule(l, { renewalMode: i.renewalMode }),
              `Kündigen können Sie jederzeit ohne Anmeldung über „Verträge hier kündigen“ unten auf jeder Seite unserer Website (${web}/kuendigen) oder in Ihrem Konto. Wir bestätigen den Eingang Ihrer Kündigung sofort per E-Mail mit dem Datum, zu dem der Vertrag endet.`,
              `Innerhalb der Widerrufsfrist können Sie den Vertrag über „Vertrag widerrufen“ (${web}/widerrufen) widerrufen; Einzelheiten in der Widerrufsbelehrung unten.`,
            ]
          : [
              renewalRule(l, { renewalMode: i.renewalMode }),
              `You can cancel at any time without signing in via “Cancel contract” at the bottom of every page of our website (${web}/kuendigen) or in your account. We confirm receipt at once by e-mail with the date the contract ends.`,
              `Within the withdrawal period you can withdraw via “Withdraw from contract” (${web}/widerrufen); details in the withdrawal policy below.`,
            ],
      },
      {
        part: 'immediate_start',
        heading: de
          ? 'Ihre Erklärung zum sofortigen Beginn'
          : 'Your declaration on the immediate start',
        paragraphs: i.consent
          ? [
              de
                ? `Abgegeben am ${date(i.consent.at, l)} um ${time(i.consent.at, l)} Uhr (Europe/Berlin):`
                : `Given on ${date(i.consent.at, l)} at ${time(i.consent.at, l)} (Europe/Berlin):`,
              `„${i.consent.text}“`,
            ]
          : [de ? 'Keine Erklärung abgegeben.' : 'No declaration given.'],
      },
      {
        part: 'benefits',
        heading: de ? 'Enthaltene Leistungen' : 'Included services',
        paragraphs: de
          ? [
              '• Push-Benachrichtigungen bei Warnungen in der ParkShield-App',
              '• Erinnerung nach 10 Minuten, wenn Sie nicht reagieren',
              '• SMS-Eskalation nach 30 Minuten an Ihre bestätigte Handynummer',
              '• Fotos bei Warnungen',
              '• Anonymer Chat mit der Person am Fahrzeug',
              '• Ein gedruckter Aufkleber inklusive Versand (kostenlos)',
              '• Selbst ausdrucken jederzeit kostenlos',
              '• 3 € für jeden weiteren gedruckten und verschickten Aufkleber, auch für einen neuen Code nach „Sperren“',
            ]
          : [
              '• Push notifications for alerts in the ParkShield app',
              '• Reminder after 10 minutes if you do not react',
              '• SMS escalation after 30 minutes to your verified mobile number',
              '• Photos with alerts',
              '• Anonymous chat with the person at the vehicle',
              '• One printed decal including shipping (free)',
              '• Print it yourself at any time, free',
              '• €3 for each additional printed and shipped decal, also for a new code after “Block”',
            ],
      },
      {
        part: 'agb',
        document: true,
        heading: de
          ? `${agb.title} (Fassung ${i.docVersion})`
          : `${agb.title} (version ${i.docVersion})`,
        paragraphs: docParagraphs(agb.sections),
      },
      {
        part: 'widerruf',
        document: true,
        heading: widerruf.title,
        paragraphs: docParagraphs(policy),
      },
      {
        part: 'muster_widerrufsformular',
        document: true,
        heading: de ? 'Muster-Widerrufsformular' : 'Model withdrawal form',
        paragraphs: form ? form.paragraphs : MODEL_FORM_EN(i.company),
      },
    ],
  };
}

const PT = 72 / 25.4;
const mm = (v: number) => v * PT;
const INK = '#0f172a';
const GREY = '#475569';
const BLUE = '#1d4ed8';

/** A4, built-in Helvetica (WinAnsi), page numbers in the footer. Never stored, only attached. */
export function renderContractConfirmationPdf(
  c: PdfContent,
  meta: { created: Date; contractNo: string },
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    margins: { top: mm(20), bottom: mm(22), left: mm(22), right: mm(20) },
    info: {
      Title: `${c.title} ${meta.contractNo}`,
      Author: 'ParkShield',
      Creator: 'ParkShield',
      Producer: 'ParkShield',
      CreationDate: meta.created,
    },
  });
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(BLUE).text('ParkShield', { continued: false });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(winAnsi(c.title));
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor(GREY).text(winAnsi(c.intro), { width });
  for (const s of c.sections) {
    if (s.document) doc.addPage();
    else doc.moveDown(1);
    doc
      .font('Helvetica-Bold')
      .fontSize(s.document ? 14 : 12)
      .fillColor(INK)
      .text(winAnsi(s.heading), { width });
    doc.outline.addItem(winAnsi(s.heading));
    doc.moveDown(0.3);
    for (const p of s.paragraphs) {
      if (p.startsWith('§§ ')) {
        doc.moveDown(0.3);
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(INK)
          .text(winAnsi(p.slice(3)), { width });
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(INK).text(winAnsi(p), { width });
      }
      doc.moveDown(0.25);
    }
  }
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GREY)
      .text(
        winAnsi(`${c.title} · ${meta.contractNo} · ${p + 1}/${range.count}`),
        doc.page.margins.left,
        doc.page.height - mm(14),
        { width, align: 'center', lineBreak: false },
      );
    doc.page.margins.bottom = bottom;
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (ch: Buffer) => chunks.push(ch));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** „Vertragsbestaetigung_PS-…pdf“ */
export const contractPdfName = (locale: 'de' | 'en', contractNo: string) =>
  `${locale === 'de' ? 'Vertragsbestaetigung' : 'Contract_confirmation'}_${contractNo}.pdf`;
