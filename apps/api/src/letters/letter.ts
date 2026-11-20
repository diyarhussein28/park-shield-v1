import { renewalRule } from '@parkshield/shared';
import type { PostalAddress } from '../providers/ports';
import { fill, type CompanyData } from './company';

/**
 * Everything a welcome letter shows, frozen when it is created. Every download renders the PDF
 * from this snapshot, so a letter always looks as it did when it was made, even if the customer's
 * data or the company data change later. Stored encrypted as a whole (name, address, plate).
 */
export interface LetterSnapshot {
  v: 1;
  /** Letter date (ISO), the day it was created. */
  date: string;
  customer: {
    customerNo: string;
    email: string;
    name: string;
    address: PostalAddress | null;
  };
  contract: {
    contractNo: string;
    plan: 'plus' | 'premium';
    planName: string;
    startedAt: string;
    priceCents: number;
    renewalMode: 'annual' | 'monthly_after_first_term';
  };
  vehicle: { plate: string; description: string | null };
  /** The plan's lines from the plan catalog (same source as the pricing page). */
  benefits: string[];
  company: CompanyData;
  companyVersion: number;
  portalUrl: string;
}

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'pairs'; items: [string, string][] }
  | { kind: 'gap' };

export interface LetterContent {
  /** Return address above the window (Rücksendeangabe). */
  senderLine: string;
  /** Recipient lines in the window field, top to bottom. Empty when no address is known. */
  addressLines: string[];
  info: [string, string][];
  subject: string;
  greeting: string;
  blocks: Block[];
  closing: string;
  signatureName: string;
  signatureCompany: string;
  /** Footer columns (every page), only configured fields. */
  footer: string[][];
}

const COUNTRIES: Record<string, string> = {
  AT: 'ÖSTERREICH',
  CH: 'SCHWEIZ',
  NL: 'NIEDERLANDE',
  BE: 'BELGIEN',
  LU: 'LUXEMBURG',
  FR: 'FRANKREICH',
  DK: 'DÄNEMARK',
  PL: 'POLEN',
  IT: 'ITALIEN',
  ES: 'SPANIEN',
};

const date = (iso: string) =>
  new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));

export const euro = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
    .format(cents / 100)
    .replace(/\u202f|\u00a0/g, ' ');

/** DIN 5008: name, street, postal code + city, and the country in capitals when not Germany. */
export function addressLines(a: PostalAddress | null): string[] {
  if (!a) return [];
  const lines = [a.name, a.line1, a.line2 ?? '', `${a.postalCode} ${a.city}`].filter(Boolean);
  if (a.country && a.country !== 'DE') lines.push(COUNTRIES[a.country] ?? a.country.toUpperCase());
  return lines;
}

/** Pure: snapshot → what is printed where. The PDF renderer only draws this. */
export function letterContent(s: LetterSnapshot): LetterContent {
  const c = s.company;
  const vars = { name: s.customer.name, plan: s.contract.planName, portalUrl: s.portalUrl };
  const firm = [c.name, c.legalForm].filter(Boolean).join(' ');

  const blocks: Block[] = [
    { kind: 'paragraph', text: fill(c.texts.welcome, vars) },
    { kind: 'heading', text: 'Ihr registriertes Fahrzeug' },
    {
      kind: 'pairs',
      items: [
        [
          'Kennzeichen',
          s.vehicle.description ? `${s.vehicle.plate} (${s.vehicle.description})` : s.vehicle.plate,
        ],
      ],
    },
  ];
  if (s.benefits.length) {
    blocks.push(
      { kind: 'heading', text: `Ihre Leistungen im Tarif ${s.contract.planName}` },
      { kind: 'bullets', items: s.benefits },
    );
  }
  blocks.push(
    // TODO [LEGAL REVIEW]: contract summary (price, term, renewal) against the AGB version in force.
    { kind: 'heading', text: 'Ihr Vertrag' },
    {
      kind: 'paragraph',
      text: `${s.contract.planName} kostet ${euro(s.contract.priceCents)} pro Jahr inkl. 19 % USt. ${renewalRule('de', { renewalMode: s.contract.renewalMode })} Die vollständigen Bedingungen finden Sie in unseren AGB auf ${c.website}.`,
    },
    { kind: 'heading', text: 'So geht es weiter' },
    {
      kind: 'bullets',
      items: fill(c.texts.nextSteps, vars)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    },
    {
      kind: 'paragraph',
      text: `Bei Fragen helfen wir Ihnen gern: ${[
        c.email && `per E-Mail an ${c.email}`,
        c.phone && `telefonisch unter ${c.phone.replace(/ /g, '\u00a0')}`,
        `im Kundenportal ${s.portalUrl}`,
      ]
        .filter(Boolean)
        .join(', ')
        .replace(/, ([^,]*)$/, ' oder $1')}.`,
    },
  );

  const footer: string[][] = [
    [firm, c.street, `${c.postalCode} ${c.city}`],
    [
      c.phone && `Telefon: ${c.phone}`,
      c.email && `E-Mail: ${c.email}`,
      c.website && `Web: ${c.website}`,
    ].filter(Boolean),
    [
      c.footer.vatId && c.vatId && `USt-IdNr.: ${c.vatId}`,
      c.footer.taxNumber && c.taxNumber && `Steuernummer: ${c.taxNumber}`,
      c.footer.owner && c.owner && `Inhaber: ${c.owner}`,
      c.footer.register && c.registerCourt && c.registerNumber
        ? `${c.registerCourt}, ${c.registerNumber}`
        : '',
    ].filter(Boolean),
    c.footer.bank && c.iban
      ? [c.bankName, `IBAN: ${c.iban}`, c.bic && `BIC: ${c.bic}`].filter(Boolean)
      : [],
  ]
    .map((col) => col.filter((l): l is string => Boolean(l)))
    .filter((col) => col.length);

  return {
    senderLine: [firm, c.street, `${c.postalCode} ${c.city}`].join(' · '),
    addressLines: addressLines(s.customer.address),
    info: [
      ['Kundennummer', s.customer.customerNo],
      ['Vertragsnummer', s.contract.contractNo],
      ['E-Mail', s.customer.email],
      ['Datum', date(s.date)],
      ['Tarif', s.contract.planName],
      ['Vertragsbeginn', date(s.contract.startedAt)],
    ],
    subject: 'Willkommen bei ParkShield',
    greeting: fill(c.texts.greeting, vars),
    blocks,
    closing: c.texts.closing,
    signatureName: c.signatureName,
    signatureCompany: firm,
    footer,
  };
}

/**
 * DIN 5008 Form B geometry in millimetres (A4 210 × 297). The address field matches a DIN-lang
 * window envelope (window 90 × 45 mm, 20 mm from the left, 45 mm from the top when folded).
 */
export const GEOMETRY = {
  page: { w: 210, h: 297 },
  margin: { left: 25, right: 20, top: 20, bottom: 31 },
  /** Anschriftfeld: 85 × 45 mm at (20, 45); return line in the Zusatz- und Vermerkzone. */
  addressField: { x: 20, y: 45, w: 85, h: 45 },
  returnZone: { x: 25, y: 45, w: 80, h: 17.7 },
  addressZone: { x: 25, y: 62.7, w: 80, h: 27.3 },
  infoBlock: { x: 125, y: 50, w: 75 },
  bodyTop: 98.5,
  foldMarks: [105, 210],
  punchMark: 148.5,
  footerTop: 272,
  /** Address lines (10 pt), 4.23 mm apart: at most 6 lines fit the 27.3 mm zone. */
  addressLine: 4.23,
  addressSize: 10,
} as const;
