import { renewalRule } from '@parkshield/shared';
import { lifetimeRule, STORE_NAME } from '../billing/contract-confirmation';
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
    plan: 'standard';
    planName: string;
    startedAt: string;
    /** What the contract was sold at (`BillingService.contractPriceCents`), gross. */
    priceCents: number;
    renewalMode: 'annual' | 'monthly_after_first_term';
    /**
     * `lifetime` = paid once (2026-11-26). Letters made before 2026-11-28 have none: they were
     * all printed as yearly, a Lifetime customer's letter among them (re-create it in ops).
     */
    interval?: 'year' | 'lifetime';
    /** Who took the payment; letters made before 2026-11-28 have none (the row is left out). */
    provider?: 'stripe' | 'app_store' | 'play_store';
  };
  vehicle: {
    plate: string;
    /** „VW Golf, Rot“: make/model and colour in one, kept for older letters. */
    description: string | null;
    makeModel?: string | null;
    color?: string | null;
  };
  /** The plan's lines from the plan catalog (same source as the pricing page). */
  benefits: string[];
  company: CompanyData;
  companyVersion: number;
  portalUrl: string;
}

export type StepIcon = 'phone' | 'bell' | 'sticker' | 'nfc';

export interface LetterContent {
  /** Return address above the window (Rücksendeangabe). */
  senderLine: string;
  /** Recipient lines in the window field, top to bottom. Empty when no address is known. */
  addressLines: string[];
  /** „Leverkusen, 28. November 2026“ */
  dateLine: string;
  title: string;
  greeting: string;
  intro: string;
  /** „Ihre Vertragsdaten“: label/value rows. */
  info: [string, string][];
  /** „Ihr Fahrzeug“: label/value rows. */
  vehicle: [string, string][];
  benefits: string[];
  steps: { icon: StepIcon; title: string; text: string }[];
  /** Term and renewal in short, with the pointer to the AGB. */
  terms: string;
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

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
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

/** The four steps after the letter arrives (app first since 2026-11-24; no portal, no e-mail alerts). */
function steps(portalUrl: string): LetterContent['steps'] {
  return [
    { icon: 'phone', title: 'App öffnen', text: `${portalUrl}, mit Ihrer E-Mail anmelden` },
    { icon: 'bell', title: 'Push erlauben', text: 'Für Warnungen; nach 30 Min. kommt eine SMS' },
    { icon: 'sticker', title: 'Aufkleber anbringen', text: 'Innen an die Windschutzscheibe' },
    { icon: 'nfc', title: 'QR & NFC testen', text: 'In der App: „Aufkleber testen“' },
  ];
}

/** Pure: snapshot → what is printed where. The PDF renderer only draws this. */
export function letterContent(s: LetterSnapshot): LetterContent {
  const c = s.company;
  const vars = { name: s.customer.name, plan: s.contract.planName, portalUrl: s.portalUrl };
  const firm = [c.name, c.legalForm].filter(Boolean).join(' ');
  const life = s.contract.interval === 'lifetime';
  const price = euro(s.contract.priceCents);
  const p = s.contract.provider;

  // TODO [LEGAL REVIEW]: contract summary (price, term, renewal) against the AGB version in force.
  const info: [string, string][] = [
    ['Kundennummer', s.customer.customerNo],
    ['Vertragsnummer', s.contract.contractNo],
    ['Tarif', life ? `${s.contract.planName} – Lifetime` : s.contract.planName],
    ['Preis', life ? `${price} einmalig (inkl. 19 % USt.)` : `${price} / Jahr (inkl. 19 % USt.)`],
    ['Vertragsbeginn', longDate(s.contract.startedAt)],
    [
      'Laufzeit',
      life
        ? 'Unbefristet (kein Abo, keine Verlängerung)'
        : s.contract.renewalMode === 'annual'
          ? '12 Monate, verlängert sich jährlich'
          : '12 Monate, danach monatlich',
    ],
  ];
  if (p) info.push(['Zahlung über', p === 'stripe' ? 'Stripe (park-shield.de)' : STORE_NAME[p]]);

  const v = s.vehicle;
  const vehicle: [string, string][] = [['Kennzeichen', v.plate]];
  if (v.makeModel !== undefined || v.color !== undefined) {
    if (v.makeModel) vehicle.push(['Modell', v.makeModel]);
    if (v.color) vehicle.push(['Farbe', v.color]);
  } else if (v.description) {
    vehicle.push(['Fahrzeug', v.description]);
  }

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
    dateLine: `${c.city}, ${longDate(s.date)}`,
    title: 'Willkommen bei ParkShield',
    greeting: fill(c.texts.greeting, vars),
    intro: fill(c.texts.welcome, vars),
    info,
    vehicle,
    benefits: s.benefits,
    steps: steps(s.portalUrl),
    terms: `${life ? lifetimeRule('de') : renewalRule('de', { renewalMode: s.contract.renewalMode })} Es gelten unsere AGB auf ${c.website}.`,
    closing: c.texts.closing,
    signatureName: c.signatureName,
    // The full name with the legal form is in the footer.
    signatureCompany: c.name,
    footer,
  };
}

/**
 * DIN 5008 Form B geometry in millimetres (A4 210 × 297). The address field matches a DIN-lang
 * window envelope (window 90 × 45 mm, 20 mm from the left, 45 mm from the top when folded).
 */
export const GEOMETRY = {
  page: { w: 210, h: 297 },
  /** `bottom` only stops pdfkit from breaking pages itself; the layout ends at footerTop − 3. */
  margin: { left: 25, right: 20, top: 20, bottom: 17 },
  /** Anschriftfeld: 85 × 45 mm at (20, 45); return line in the Zusatz- und Vermerkzone. */
  addressField: { x: 20, y: 45, w: 85, h: 45 },
  returnZone: { x: 25, y: 45, w: 80, h: 17.7 },
  addressZone: { x: 25, y: 62.7, w: 80, h: 27.3 },
  /** The sticker picture, right of the window field. */
  stickerBox: { x: 128, y: 41, w: 62, h: 52 },
  /** Right under the window field (it ends at 90 mm). */
  bodyTop: 93,
  foldMarks: [105, 210],
  punchMark: 148.5,
  footerTop: 281,
  /** Address lines (10 pt), 4.23 mm apart: at most 6 lines fit the 27.3 mm zone. */
  addressLine: 4.23,
  addressSize: 10,
} as const;
