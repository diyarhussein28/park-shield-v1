import { legalDoc, renewalRule, type LegalDoc } from '@parkshield/shared';
import PDFDocument from 'pdfkit';
import { drawLogoMark, headingFonts, winAnsi } from '../core/pdf-brand';
import { MAIL_ICONS, type MailIcon } from '../mail/icons';

/**
 * The PDF „Vertragsbestätigung“ attached to the contract confirmation e-mail (§ 312f BGB, durable
 * medium). Redesign 2026-11-23: page 1 the contract at a glance (details table, included services,
 * term and withdrawal in short, the immediate-start declaration, the provider), page 2 the legal
 * information with the model withdrawal form, then the full AGB and the full withdrawal policy as
 * appendices — word for word, never shortened (the summaries on pages 1–2 are additions).
 *
 * Built in two steps so the content is testable without parsing a PDF: `contractConfirmationContent()`
 * (the text, part by part) and `renderContractConfirmationPdf()` (pdfkit, A4). Which versions were sent
 * is stored in `contract_confirmations`.
 *
 * TODO [LEGAL REVIEW]: every text in this file (contract data wording, the summaries, renewal and
 * cancellation rules, the English model withdrawal form, the list of included services).
 * LEGAL_REVIEW.md §1 and §12.
 */

type Locale = 'de' | 'en';
type Store = 'app_store' | 'play_store';

export interface ContractConfirmationInput {
  locale: Locale;
  customerNo: string;
  contractNo: string;
  /** The customer as in the profile (name, address lines); null for accounts without a profile. */
  customer?: { name: string; address: string[] } | null;
  /** e.g. „19,99 €“ */
  price: string;
  /** Contract start = first purchase (not the start of the current period). */
  startedAt: Date;
  /** End of the current period from Stripe / Apple / Google; null when the provider gave none. */
  renewsAt: Date | null;
  /** Auto-renew on: the end of the period is the next renewal, else the contract end. */
  renews?: boolean;
  /** Show times next to dates (store sandbox periods last minutes or hours, not a year). */
  withTime?: boolean;
  renewalMode: 'annual' | 'monthly_after_first_term';
  docVersion: string;
  /** The immediate-start declaration (§ 356 Abs. 4 BGB) as accepted, with its time. */
  consent: { text: string; at: Date } | null;
  company: {
    name: string;
    street: string;
    postalCode: string;
    city: string;
    email: string;
    country?: string;
    owner?: string;
    phone?: string;
    website?: string;
    vatId?: string;
  };
  webBaseUrl: string;
  /** Sticker value included in the price, e.g. „3,00 €“ (B2); null for old contracts. */
  stickerValue?: string | null;
  /** Bought in the app through Apple/Google (they are the seller); null/undefined: Stripe. */
  store?: Store | null;
  /** Lifetime plan (2026-11-26): paid once, no renewal, nothing to cancel. */
  lifetime?: boolean;
}

export const STORE_NAME = { app_store: 'Apple App Store', play_store: 'Google Play' } as const;
const STORE_SELLER = { app_store: 'Apple', play_store: 'Google' } as const;
const REFUND_ROUTE = {
  app_store: 'https://reportaproblem.apple.com',
  play_store: 'https://play.google.com/store/account/orderhistory',
} as const;

/** B2 price breakdown lines (web checkout, paywall, invoice). TODO [LEGAL REVIEW] */
export function priceBreakdown(locale: Locale, price: string, stickerValue?: string | null) {
  const lines =
    locale === 'de'
      ? [`ParkShield Jahresabo: ${price} / Jahr, inkl. MwSt.`]
      : [`ParkShield yearly plan: ${price} / year, incl. VAT.`];
  if (stickerValue) {
    lines.push(
      locale === 'de'
        ? `Im Preis enthalten: personalisierter Aufkleber inkl. Versand im Wert von ${stickerValue}.`
        : `Included in the price: personalised sticker incl. shipping worth ${stickerValue}.`,
    );
  }
  return lines;
}

/** B2 price breakdown of the lifetime plan (paid once). TODO [LEGAL REVIEW] */
export function lifetimeBreakdown(locale: Locale, price: string, stickerValue?: string | null) {
  const lines =
    locale === 'de'
      ? [`ParkShield Lifetime: ${price} einmalig, inkl. MwSt., ohne Verlängerung.`]
      : [`ParkShield Lifetime: ${price} once, incl. VAT, no renewal.`];
  if (stickerValue) {
    lines.push(
      locale === 'de'
        ? `Im Preis enthalten: personalisierter Aufkleber inkl. Versand im Wert von ${stickerValue}.`
        : `Included in the price: personalised sticker incl. shipping worth ${stickerValue}.`,
    );
  }
  return lines;
}

/** „3. August 2027“, with „, 11:15 Uhr“ when `withTime` (Berlin time). Shared by e-mail and PDF. */
export function contractDate(d: Date, locale: Locale, withTime = false) {
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', {
      ...o,
      timeZone: 'Europe/Berlin',
    }).format(d);
  const day = f({ day: 'numeric', month: 'long', year: 'numeric' });
  if (!withTime) return day;
  const t = f({ hour: '2-digit', minute: '2-digit' });
  return locale === 'de' ? `${day}, ${t} Uhr` : `${day}, ${t}`;
}

export interface PdfRow {
  icon: MailIcon;
  label: string;
  value: string;
}

export interface PdfSection {
  /** Which part of the confirmation this is (tests check that every part is there). */
  part:
    | 'contract'
    | 'benefits'
    | 'renewal'
    | 'withdrawal'
    | 'immediate_start'
    | 'provider'
    | 'legal_info'
    | 'muster_widerrufsformular'
    | 'agb'
    | 'widerruf';
  heading: string;
  paragraphs: string[];
  /** Label/value rows (contract details, provider). */
  rows?: PdfRow[];
  /** Numbered items with a heading each (legal information). */
  items?: { icon: MailIcon; heading: string; paragraphs: string[] }[];
}

export interface PdfContent {
  locale: Locale;
  title: string;
  subtitle: string;
  contractNo: string;
  docVersion: string;
  status: { title: string; text: string };
  customer: { heading: string; name: string; address: string[] } | null;
  legalTitle: string;
  legalSubtitle: string;
  sections: PdfSection[];
}

const docParagraphs = (doc: LegalDoc['sections']) =>
  doc.flatMap((s) => [`§§ ${s.heading}`, ...s.paragraphs]);

/**
 * The model withdrawal form in its complete statutory wording (Anlage 2 zu Art. 246a § 1 Abs. 2 S. 1
 * Nr. 1 EGBGB), with our address and the contract number filled in. The website's /widerruf page shows
 * a shortened form; the PDF always carries the full one (LEGAL_REVIEW.md §13). TODO [LEGAL REVIEW]
 */
const MODEL_FORM_DE = (c: ContractConfirmationInput['company'], contractNo: string) => [
  '(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)',
  `An ${c.name}${c.owner ? `, Inhaber ${c.owner}` : ''}, ${c.street}, ${c.postalCode} ${c.city}, E-Mail: ${c.email}:`,
  `Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*): ParkShield-Abo, Vertragsnummer ${contractNo}`,
  'Bestellt am (*)/erhalten am (*): ______',
  'Name des/der Verbraucher(s): ______',
  'Anschrift des/der Verbraucher(s): ______',
  'Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier): ______',
  'Datum: ______',
  '(*) Unzutreffendes streichen.',
];
const MODEL_FORM_EN = (c: ContractConfirmationInput['company'], contractNo: string) => [
  '(Complete and return this form only if you wish to withdraw from the contract.)',
  `To ${c.name}${c.owner ? `, owner ${c.owner}` : ''}, ${c.street}, ${c.postalCode} ${c.city}, Germany, e-mail: ${c.email}:`,
  `I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract of sale of the following goods (*)/for the provision of the following service (*): ParkShield subscription, contract number ${contractNo}`,
  'Ordered on (*) / received on (*): ______',
  'Name of consumer(s): ______',
  'Address of consumer(s): ______',
  'Signature of consumer(s) (only if this form is notified on paper): ______',
  'Date: ______',
  '(*) Delete as appropriate.',
];

const BENEFITS = {
  de: [
    'Push-Benachrichtigungen bei Warnungen in der ParkShield-App',
    'Erinnerung nach 10 Minuten, wenn Sie nicht reagieren',
    'SMS-Eskalation nach 30 Minuten an Ihre bestätigte Handynummer',
    'Fotos bei Warnungen',
    'Anonymer Chat mit der Person am Fahrzeug',
    'Ein gedruckter Aufkleber inklusive Versand (kostenlos)',
    'Selbst ausdrucken jederzeit kostenlos',
    '3 € für jeden weiteren gedruckten und verschickten Aufkleber, auch für einen neuen Code nach „Sperren“',
  ],
  en: [
    'Push notifications for alerts in the ParkShield app',
    'Reminder after 10 minutes if you do not react',
    'SMS escalation after 30 minutes to your verified mobile number',
    'Photos with alerts',
    'Anonymous chat with the person at the vehicle',
    'One printed decal including shipping (free)',
    'Print it yourself at any time, free',
    '€3 for each additional printed and shipped decal, also for a new code after “Block”',
  ],
} as const;

/** The term of the Lifetime plan (paid once), as the contract confirmation and the welcome letter say it. */
export function lifetimeRule(locale: Locale): string {
  return locale === 'de'
    ? 'Einmalzahlung ohne feste Laufzeit und ohne Verlängerung: Der Vertrag gilt dauerhaft, solange ParkShield den Dienst anbietet. Es fallen keine weiteren Zahlungen an, eine Kündigung ist nicht nötig.'
    : 'One-time payment without a fixed term and without renewal: the contract runs for good, as long as ParkShield offers the service. No further payments fall due; no cancellation is needed.';
}

export function contractConfirmationContent(i: ContractConfirmationInput): PdfContent {
  const de = i.locale === 'de';
  const l = i.locale;
  const web = i.webBaseUrl.replace(/\/+$/, '');
  const renews = i.renews ?? true;
  const agb = legalDoc(l, 'agb', { renewalMode: i.renewalMode });
  const widerruf = legalDoc(l, 'widerruf', { renewalMode: i.renewalMode });
  const isForm = (h: string) => /Muster-Widerrufsformular|model withdrawal form/i.test(h);
  const policy = widerruf.sections.filter((s) => !isForm(s.heading));
  const life = i.lifetime === true;
  const rule = life ? lifetimeRule(l) : renewalRule(l, { renewalMode: i.renewalMode });
  const c = i.company;
  const s = i.store ?? null;

  const cancel = life
    ? de
      ? 'Es gibt kein Abo, das sich verlängert; Sie müssen nichts kündigen. Ihr Konto können Sie jederzeit in der App löschen.'
      : 'There is no subscription that renews; you do not need to cancel anything. You can delete your account in the app at any time.'
    : s
      ? de
        ? `Ihr Abo verwaltet ${STORE_SELLER[s]}: Kündigen können Sie jederzeit in den Abo-Einstellungen von ${STORE_NAME[s]} (in der App unter „Vertrag hier kündigen“ verlinkt).`
        : `${STORE_SELLER[s]} manages your subscription: you can cancel at any time in the subscription settings of ${STORE_NAME[s]} (linked in the app under “Cancel contract”).`
      : de
        ? `Kündigen können Sie jederzeit ohne Anmeldung über „Verträge hier kündigen“ unten auf jeder Seite unserer Website (${web}/kuendigen) oder in Ihrem Konto. Wir bestätigen den Eingang sofort per E-Mail mit dem Datum, zu dem der Vertrag endet.`
        : `You can cancel at any time without signing in via “Cancel contract” at the bottom of every page of our website (${web}/kuendigen) or in your account. We confirm receipt at once by e-mail with the date the contract ends.`;
  const withdraw = s
    ? de
      ? `Über Widerruf und Erstattung entscheidet ${STORE_SELLER[s]}: ${REFUND_ROUTE[s]}. Der Button „Vertrag widerrufen“ in der App (Konto › Abo) führt dorthin.`
      : `${STORE_SELLER[s]} decides on withdrawal and refunds: ${REFUND_ROUTE[s]}. The “Withdraw from contract” button in the app (Account › Plan) leads there.`
    : de
      ? `Innerhalb der Widerrufsfrist können Sie ohne Angabe von Gründen widerrufen: in der App unter Konto › Abo › „Vertrag widerrufen“, auf ${web}/widerrufen oder mit einer eindeutigen Erklärung an ${c.email}. Wir bestätigen den Eingang per E-Mail.`
      : `Within the withdrawal period you can withdraw without giving reasons: in the app under Account › Plan › “Withdraw from contract”, at ${web}/widerrufen or with a clear statement to ${c.email}. We confirm receipt by e-mail.`;
  const notInvoice = s
    ? de
      ? `Das Abo wird über ${STORE_SELLER[s]} abgerechnet; den Zahlungsbeleg erhalten Sie von ${STORE_SELLER[s]}. Dieses Dokument ist eine Vertragsbestätigung, keine Rechnung.`
      : `The subscription is billed by ${STORE_SELLER[s]}; you receive the receipt from ${STORE_SELLER[s]}. This document is a contract confirmation, not an invoice.`
    : de
      ? 'Bezahlt über Stripe auf park-shield.de; Ihre Rechnungen finden Sie in Ihrem Konto unter „Abo“. Dieses Dokument ist eine Vertragsbestätigung, keine Rechnung.'
      : 'Paid through Stripe on park-shield.de; you find your invoices in your account under “Plan”. This document is a contract confirmation, not an invoice.';

  // Page 1 summaries; the full wording is in „Rechtliche Informationen“ and the appendices.
  const shortTerm = life
    ? rule
    : i.renewalMode === 'annual'
      ? de
        ? 'Laufzeit 12 Monate; verlängert sich automatisch um jeweils 12 Monate. Eine Kündigung wirkt zum Ende des laufenden Zeitraums.'
        : 'Term 12 months; renews automatically by 12 months at a time. A cancellation takes effect at the end of the current period.'
      : rule;
  const shortCancel = life
    ? cancel
    : s
      ? de
        ? `Kündigen jederzeit in den Abo-Einstellungen von ${STORE_NAME[s]} (in der App: „Vertrag hier kündigen“).`
        : `Cancel at any time in the ${STORE_NAME[s]} subscription settings (in the app: “Cancel contract”).`
      : de
        ? `Kündigen jederzeit ohne Anmeldung: ${web}/kuendigen oder in Ihrem Konto.`
        : `Cancel at any time without signing in: ${web}/kuendigen or in your account.`;
  const shortWithdraw = s
    ? de
      ? `Widerruf und Erstattung laufen über ${STORE_SELLER[s]} (${REFUND_ROUTE[s]}); „Vertrag widerrufen“ in der App führt dorthin.`
      : `Withdrawal and refunds go through ${STORE_SELLER[s]} (${REFUND_ROUTE[s]}); “Withdraw from contract” in the app leads there.`
    : de
      ? `Innerhalb der Widerrufsfrist: in der App unter Konto › Abo › „Vertrag widerrufen“, auf ${web}/widerrufen oder per E-Mail an ${c.email}.`
      : `Within the withdrawal period: in the app under Account › Plan › “Withdraw from contract”, at ${web}/widerrufen or by e-mail to ${c.email}.`;

  const rows: PdfRow[] = [
    { icon: 'user', label: de ? 'Kundennummer' : 'Customer number', value: i.customerNo },
    { icon: 'hash', label: de ? 'Vertragsnummer' : 'Contract number', value: i.contractNo },
    {
      icon: 'layers',
      label: de ? 'Tarif' : 'Plan',
      value: de
        ? 'ParkShield – ein Fahrzeug, alles inklusive'
        : 'ParkShield – one vehicle, everything included',
    },
    { icon: 'car', label: de ? 'Fahrzeuge' : 'Vehicles', value: de ? '1 Fahrzeug' : '1 vehicle' },
    {
      icon: 'tag',
      label: life ? (de ? 'Preis' : 'Price') : de ? 'Jahrespreis' : 'Annual price',
      value: life
        ? de
          ? `${i.price} einmalig (inkl. 19 % MwSt.)`
          : `${i.price} once (incl. 19% VAT)`
        : de
          ? `${i.price} / Jahr (inkl. 19 % MwSt.)`
          : `${i.price} / year (incl. 19% VAT)`,
    },
    ...(i.stickerValue
      ? [
          {
            icon: 'gift' as const,
            label: de ? 'Im Preis enthalten' : 'Included in the price',
            value: de
              ? `personalisierter Aufkleber inkl. Versand im Wert von ${i.stickerValue}`
              : `personalised sticker incl. shipping worth ${i.stickerValue}`,
          },
        ]
      : []),
    {
      icon: 'calendar',
      label: de ? 'Vertragsbeginn' : 'Start date',
      value: contractDate(i.startedAt, l, i.withTime),
    },
    {
      icon: 'refresh',
      label: life
        ? de
          ? 'Laufzeit'
          : 'Term'
        : renews
          ? de
            ? 'Nächste Verlängerung'
            : 'Next renewal'
          : de
            ? 'Vertragsende'
            : 'Contract end',
      value: life
        ? de
          ? 'dauerhaft, ohne Verlängerung'
          : 'lifetime, no renewal'
        : i.renewsAt
          ? contractDate(i.renewsAt, l, i.withTime)
          : '–',
    },
    {
      icon: 'card',
      label: de ? 'Bezahlt über' : 'Paid through',
      value: s
        ? STORE_NAME[s]
        : de
          ? 'Stripe (direkt bei ParkShield)'
          : 'Stripe (directly to ParkShield)',
    },
  ];

  const providerRows: PdfRow[] = [
    {
      icon: 'building',
      label: de ? 'Anbieter (Vertragspartner)' : 'Provider (contracting party)',
      value: [
        c.name,
        c.owner ? (de ? `Inhaber ${c.owner}` : `Owner ${c.owner}`) : '',
        c.street,
        `${c.postalCode} ${c.city}${de ? '' : ', Germany'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
    {
      icon: 'mail',
      label: de ? 'Kontakt' : 'Contact',
      value: [
        c.email,
        c.website ? `https://${c.website.replace(/^https?:\/\//, '')}` : web,
        c.phone ?? '',
        c.vatId ? (de ? `USt-IdNr. ${c.vatId}` : `VAT ID ${c.vatId}`) : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];

  const consent = i.consent
    ? [
        de
          ? `Abgegeben am ${contractDate(i.consent.at, l)} um ${contractDate(i.consent.at, l, true).split(', ')[1]} (Europe/Berlin):`
          : `Given on ${contractDate(i.consent.at, l)} at ${contractDate(i.consent.at, l, true).split(', ')[1]} (Europe/Berlin):`,
        `„${i.consent.text}“`,
      ]
    : [de ? 'Keine Erklärung abgegeben.' : 'No declaration given.'];

  return {
    locale: l,
    title: de ? 'Vertragsbestätigung' : 'Contract confirmation',
    subtitle: de
      ? `Auf einem dauerhaften Datenträger (§ 312f BGB) · Fassung der Vertragstexte ${i.docVersion}`
      : `On a durable medium (§ 312f BGB) · contract texts version ${i.docVersion} · the German version is binding`,
    contractNo: i.contractNo,
    docVersion: i.docVersion,
    status: {
      title: de ? 'Vertrag abgeschlossen' : 'Contract concluded',
      text: de
        ? `Ihr ParkShield-Abo wurde am ${contractDate(i.startedAt, l)} abgeschlossen. ${notInvoice}`
        : `Your ParkShield subscription was concluded on ${contractDate(i.startedAt, l)}. ${notInvoice}`,
    },
    customer: i.customer
      ? { heading: de ? 'Kunde' : 'Customer', name: i.customer.name, address: i.customer.address }
      : null,
    legalTitle: de ? 'Rechtliche Informationen' : 'Legal information',
    legalSubtitle: de
      ? 'Diese Informationen sind Teil Ihres Vertrags. Die vollständigen AGB und die Widerrufsbelehrung stehen im Anhang.'
      : 'This information forms part of your contract. The full terms and the withdrawal policy are in the appendix.',
    sections: [
      {
        part: 'contract',
        heading: de ? 'Vertragsdaten' : 'Contract details',
        rows,
        paragraphs: [],
      },
      {
        part: 'benefits',
        heading: de ? 'Enthaltene Leistungen' : 'Included services',
        paragraphs: [...BENEFITS[l]],
      },
      {
        part: 'renewal',
        heading: de ? 'Laufzeit und Kündigung' : 'Term and cancellation',
        paragraphs: [shortTerm, shortCancel],
      },
      {
        part: 'withdrawal',
        heading: de ? 'Widerruf' : 'Withdrawal',
        paragraphs: [
          shortWithdraw,
          de
            ? 'Widerrufsbelehrung und Muster-Widerrufsformular: Anhang B.'
            : 'Withdrawal policy and model withdrawal form: appendix B.',
        ],
      },
      {
        part: 'immediate_start',
        heading: de
          ? 'Ihre Erklärung zum sofortigen Beginn'
          : 'Your declaration on the immediate start',
        paragraphs: consent,
      },
      {
        part: 'provider',
        heading: de ? 'Anbieter' : 'Provider',
        rows: providerRows,
        paragraphs: [],
      },
      {
        part: 'legal_info',
        heading: de ? 'Rechtliche Informationen' : 'Legal information',
        paragraphs: [],
        items: [
          {
            icon: 'calendar',
            heading: de ? 'Laufzeit und Verlängerung' : 'Term and renewal',
            paragraphs: [rule],
          },
          { icon: 'refresh', heading: de ? 'Kündigung' : 'Cancellation', paragraphs: [cancel] },
          {
            icon: 'scale',
            heading: de ? 'Widerrufsrecht' : 'Right of withdrawal',
            paragraphs: [
              withdraw,
              de
                ? 'Für den gedruckten, personalisierten Aufkleber besteht kein Widerrufsrecht, weil er nach Ihren Angaben hergestellt wird (§ 312g Abs. 2 Nr. 1 BGB). Ihr Widerrufsrecht für das Abo bleibt davon unberührt.'
                : 'There is no right of withdrawal for the printed, personalised sticker because it is made to your specifications (§ 312g (2) no. 1 BGB). Your right of withdrawal from the subscription is not affected.',
              de
                ? 'Maßgeblich ist die vollständige Widerrufsbelehrung in Anhang B; an ihrem Ende steht das Muster-Widerrufsformular. Sie können es verwenden, müssen es aber nicht.'
                : 'The full withdrawal policy in appendix B applies; the model withdrawal form follows at its end. You may use it, but you do not have to.',
            ],
          },
          {
            icon: 'card',
            heading: de ? 'Zahlungsanbieter' : 'Payment provider',
            paragraphs: [
              s
                ? de
                  ? `Sie haben im ${STORE_NAME[s]} gekauft. ${STORE_SELLER[s]} ist Verkäufer des In-App-Kaufs und wickelt Zahlung, Abrechnung, Zahlungsbelege und Erstattungen ab; Anträge stellen Sie über Ihr ${STORE_SELLER[s]}-Konto (${REFUND_ROUTE[s]}).`
                  : `You bought in the ${STORE_NAME[s]}. ${STORE_SELLER[s]} is the seller of the in-app purchase and handles payment, billing, receipts and refunds; you make requests through your ${STORE_SELLER[s]} account (${REFUND_ROUTE[s]}).`
                : de
                  ? 'Sie haben auf park-shield.de über unseren Zahlungsdienstleister Stripe bezahlt. Rechnungen und Gutschriften finden Sie in Ihrem Konto unter „Abo“; Erstattungen zahlen wir auf das ursprüngliche Zahlungsmittel zurück.'
                  : 'You paid on park-shield.de through our payment provider Stripe. You find invoices and credit notes in your account under “Plan”; we pay refunds back to the original means of payment.',
            ],
          },
          {
            icon: 'file',
            heading: de ? 'Vertragstexte' : 'Contract texts',
            paragraphs: [
              de
                ? `Es gelten die AGB in der Fassung ${i.docVersion} (Anhang A) und die Widerrufsbelehrung (Anhang B), wie Sie sie beim Vertragsschluss akzeptiert haben. Vertragssprache ist Deutsch.`
                : `The terms in version ${i.docVersion} (appendix A) and the withdrawal policy (appendix B) apply as you accepted them when the contract was concluded. The language of the contract is German; the German version is binding.`,
            ],
          },
        ],
      },
      {
        part: 'muster_widerrufsformular',
        heading: de ? 'Muster-Widerrufsformular' : 'Model withdrawal form',
        paragraphs: de ? MODEL_FORM_DE(c, i.contractNo) : MODEL_FORM_EN(c, i.contractNo),
      },
      {
        part: 'agb',
        heading: de
          ? `Anhang A – ${agb.title} (Fassung ${i.docVersion})`
          : `Appendix A – ${agb.title} (version ${i.docVersion})`,
        paragraphs: docParagraphs(agb.sections),
      },
      {
        part: 'widerruf',
        heading: de ? `Anhang B – ${widerruf.title}` : `Appendix B – ${widerruf.title}`,
        paragraphs: docParagraphs(policy),
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Rendering (pdfkit, A4)

const PT = 72 / 25.4;
const mm = (v: number) => v * PT;
const NAVY = '#0b2a6b';
const INK = '#0f172a';
const GREY = '#475569';
const BLUE = '#1d4ed8';
const PANEL = '#f5f8ff';
const LINE = '#e2e8f0';
const GREEN = '#16a34a';

function drawIcon(
  doc: PDFKit.PDFDocument,
  name: MailIcon,
  x: number,
  y: number,
  size: number,
  color = BLUE,
) {
  doc.save();
  doc.translate(x, y).scale(size / 24);
  doc
    .path(MAIL_ICONS[name])
    .lineWidth(2)
    .lineCap('round')
    .lineJoin('round')
    .strokeColor(color)
    .stroke();
  doc.restore();
}

/** A4, Plus Jakarta Sans headings (OFL), Helvetica text (WinAnsi), header and footer on every page. */
export function renderContractConfirmationPdf(
  c: PdfContent,
  meta: { created: Date; contractNo: string },
): Promise<Buffer> {
  const HEADER = mm(21);
  const FOOTER = mm(16);
  const SIDE = mm(16);
  const doc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    margins: { top: HEADER + mm(6), bottom: FOOTER + mm(4), left: SIDE, right: SIDE },
    info: {
      Title: `${c.title} ${meta.contractNo}`,
      Author: 'ParkShield',
      Creator: 'ParkShield',
      Producer: 'ParkShield',
      CreationDate: meta.created,
    },
  });
  const fonts = headingFonts(doc);
  const hasFonts = fonts.hasFonts;
  const head = (x = false) => (x ? fonts.extra : fonts.bold);
  // Helvetica is WinAnsi only; the heading font has every character we use.
  const ht = (s: string) => (hasFonts ? s : winAnsi(s));
  const W = doc.page.width;
  const H = doc.page.height;
  const left = SIDE;
  const width = W - 2 * SIDE;
  const bottom = () => H - doc.page.margins.bottom;
  const de = c.locale === 'de';

  const drawHeader = () => {
    const grad = doc.linearGradient(0, 0, W, HEADER).stop(0, NAVY).stop(0.55, NAVY).stop(1, BLUE);
    doc.rect(0, 0, W, HEADER).fill(grad);
    const tile = mm(11);
    const ty = (HEADER - tile) / 2;
    doc.roundedRect(left, ty, tile, tile, mm(3)).fill('#ffffff');
    drawLogoMark(doc, left + mm(1.5), ty + mm(1.5), tile - mm(3));
    doc
      .font(head(true))
      .fontSize(19)
      .fillColor('#ffffff')
      .text('Park', left + tile + mm(3.5), ty - mm(0.8), { continued: true, lineBreak: false })
      .fillColor('#93c5fd')
      .text('Shield', { lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#dbeafe')
      .text(
        de ? 'Smarter QR-Schutz für Ihr Fahrzeug' : 'Smart QR Protection for Your Vehicle',
        left + tile + mm(3.5),
        ty + mm(7.4),
        { lineBreak: false },
      );
    doc
      .font(head())
      .fontSize(10.5)
      .fillColor('#ffffff')
      .text(ht(c.title), left, ty + mm(0.5), { width, align: 'right', lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#dbeafe')
      .text(c.contractNo, left, ty + mm(5.8), { width, align: 'right', lineBreak: false });
    doc.x = left;
    doc.y = doc.page.margins.top;
  };
  doc.on('pageAdded', drawHeader);
  drawHeader();

  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const text = (
    s: string,
    o: { size?: number; color?: string; bold?: boolean; x?: number; w?: number; gap?: number } = {},
  ) => {
    doc
      .font(o.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(o.size ?? 9.5)
      .fillColor(o.color ?? INK)
      .text(winAnsi(s), o.x ?? left, doc.y, { width: o.w ?? width, lineGap: o.gap ?? 1.5 });
  };
  const height = (s: string, w: number, size = 9.5, bold = false) =>
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(size)
      .heightOfString(winAnsi(s), { width: w, lineGap: 1.5 });
  const headHeight = (s: string, w: number, size: number) =>
    doc.font(head(true)).fontSize(size).heightOfString(ht(s), { width: w });
  const heading = (s: string, size = 13, x = left, w = width) => {
    doc.font(head(true)).fontSize(size).fillColor(INK).text(ht(s), x, doc.y, { width: w });
  };
  const part = (p: PdfSection['part']) => c.sections.find((s) => s.part === p)!;

  // ---- Page 1: the contract at a glance --------------------------------------------------
  heading(c.title, 20);
  doc.moveDown(0.1);
  text(c.subtitle, { size: 9, color: GREY });
  doc.moveDown(0.6);

  // Status.
  {
    const h = Math.max(mm(12), mm(7.6) + height(c.status.text, width - mm(18), 9) + mm(2.2));
    ensure(h);
    const y = doc.y;
    doc.roundedRect(left, y, width, h, mm(3)).fill('#e8f7ee');
    doc.circle(left + mm(8), y + h / 2, mm(4)).fill(GREEN);
    drawIcon(doc, 'check', left + mm(5.2), y + h / 2 - mm(2.8), mm(5.6), '#ffffff');
    doc
      .font(head(true))
      .fontSize(12)
      .fillColor('#166534')
      .text(ht(c.status.title), left + mm(15), y + mm(2), { width: width - mm(18) });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(INK)
      .text(winAnsi(c.status.text), left + mm(15), y + mm(7.6), { width: width - mm(18) });
    doc.x = left;
    doc.y = y + h + mm(4);
  }

  // Contract details table; on the right the customer (when there is a profile) and the provider.
  {
    const sec = part('contract');
    const rows = sec.rows ?? [];
    const sideW = mm(56);
    const gap = mm(5);
    const tableW = width - sideW - gap;
    const labelW = tableW * 0.37;
    const valueW = tableW - labelW - mm(12);
    const rowH = (r: PdfRow) =>
      Math.max(height(r.label, labelW, 9, true), height(r.value, valueW, 9)) + mm(2.5);
    const tableH = mm(10) + rows.reduce((a, r) => a + rowH(r), 0) + mm(1.5);
    const sideInner = sideW - mm(8);
    const blocks: { icon: MailIcon; heading: string; bold?: string; lines: string[] }[] = [
      ...(c.customer
        ? [
            {
              icon: 'user' as const,
              heading: c.customer.heading,
              bold: c.customer.name,
              lines: c.customer.address,
            },
          ]
        : []),
      ...(part('provider').rows ?? []).map((r) => ({
        icon: r.icon,
        heading: r.label,
        lines: r.value.split('\n'),
      })),
    ];
    const headH = (b: (typeof blocks)[number]) =>
      doc
        .font(head(true))
        .fontSize(10)
        .heightOfString(ht(b.heading), { width: sideW - mm(13) });
    const blockH = (b: (typeof blocks)[number]) =>
      headH(b) +
      mm(2.2) +
      (b.bold ? height(b.bold, sideInner, 8.8, true) : 0) +
      b.lines.reduce((a, l) => a + height(l, sideInner, 8.5), 0) +
      mm(3);
    const sideH = mm(3.5) + blocks.reduce((a, b) => a + blockH(b), 0);
    const total = Math.max(tableH, sideH);
    ensure(total);
    const y0 = doc.y;
    doc.roundedRect(left, y0, tableW, total, mm(3)).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.y = y0 + mm(3);
    heading(sec.heading, 11.5, left + mm(4), tableW - mm(8));
    let y = y0 + mm(10);
    rows.forEach((r, idx) => {
      const h = rowH(r);
      if (idx) {
        doc
          .moveTo(left + mm(4), y)
          .lineTo(left + tableW - mm(4), y)
          .lineWidth(0.5)
          .strokeColor(LINE)
          .stroke();
      }
      drawIcon(doc, r.icon, left + mm(4), y + mm(1.1), mm(4));
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(INK)
        .text(winAnsi(r.label), left + mm(10.5), y + mm(1.25), { width: labelW, lineGap: 1.5 });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(INK)
        .text(winAnsi(r.value), left + mm(10.5) + labelW, y + mm(1.25), {
          width: valueW,
          lineGap: 1.5,
        });
      y += h;
    });
    const cx = left + tableW + gap;
    doc.roundedRect(cx, y0, sideW, total, mm(3)).fill(PANEL);
    let by = y0 + mm(3.5);
    for (const b of blocks) {
      drawIcon(doc, b.icon, cx + mm(4), by, mm(4.2));
      doc
        .font(head(true))
        .fontSize(10)
        .fillColor(INK)
        .text(ht(b.heading), cx + mm(10), by + mm(0.2), { width: sideW - mm(13) });
      doc.y = by + headH(b) + mm(1.8);
      if (b.bold) text(b.bold, { bold: true, size: 8.8, x: cx + mm(4), w: sideInner });
      for (const l of b.lines) text(l, { size: 8.5, x: cx + mm(4), w: sideInner, color: GREY });
      by += blockH(b);
    }
    doc.x = left;
    doc.y = y0 + total + mm(4);
  }

  // Included services in two columns.
  {
    const sec = part('benefits');
    const colW = (width - mm(22)) / 2;
    const half = Math.ceil(sec.paragraphs.length / 2);
    const cols = [sec.paragraphs.slice(0, half), sec.paragraphs.slice(half)];
    const colH = cols.map((col) =>
      col.reduce((a, b) => a + height(b, colW - mm(6), 8.8) + mm(1), 0),
    );
    const total = mm(10.5) + Math.max(...colH) + mm(2);
    ensure(total);
    const y0 = doc.y;
    doc.roundedRect(left, y0, width, total, mm(3)).fill(PANEL);
    drawIcon(doc, 'gift', left + mm(4), y0 + mm(3), mm(4.6));
    doc.y = y0 + mm(3);
    heading(sec.heading, 11.5, left + mm(11), width - mm(16));
    cols.forEach((col, ci) => {
      let y = y0 + mm(10);
      const x = left + mm(6) + ci * (colW + mm(10));
      for (const b of col) {
        drawIcon(doc, 'check', x, y + mm(0.1), mm(3.4));
        doc
          .font('Helvetica')
          .fontSize(8.8)
          .fillColor(INK)
          .text(winAnsi(b), x + mm(5.5), y, { width: colW - mm(6), lineGap: 1.5 });
        y += height(b, colW - mm(6), 8.8) + mm(1);
      }
    });
    doc.x = left;
    doc.y = y0 + total + mm(3.5);
  }

  // Term & cancellation | Withdrawal, side by side.
  {
    const pair = [part('renewal'), part('withdrawal')];
    const icons: MailIcon[] = ['refresh', 'scale'];
    const colW = (width - mm(5)) / 2;
    const inner = colW - mm(8);
    const hs = pair.map(
      (sec) =>
        mm(10) + sec.paragraphs.reduce((a, p) => a + height(p, inner, 8.5) + mm(1.2), 0) + mm(1.5),
    );
    const total = Math.max(...hs);
    ensure(total);
    const y0 = doc.y;
    pair.forEach((sec, i) => {
      const x = left + i * (colW + mm(5));
      doc.roundedRect(x, y0, colW, total, mm(3)).lineWidth(0.8).strokeColor(LINE).stroke();
      drawIcon(doc, icons[i]!, x + mm(4), y0 + mm(3), mm(4.6));
      doc.y = y0 + mm(3);
      heading(sec.heading, 11, x + mm(11), colW - mm(15));
      doc.y = y0 + mm(9.5);
      for (const p of sec.paragraphs) {
        text(p, { size: 8.5, x: x + mm(4), w: inner });
        doc.y += mm(1.2);
      }
    });
    doc.x = left;
    doc.y = y0 + total + mm(3.5);
  }

  // The immediate-start declaration.
  {
    const sec = part('immediate_start');
    const inner = width - mm(15.5);
    const total =
      mm(9.5) + sec.paragraphs.reduce((a, p) => a + height(p, inner, 8.5) + mm(0.8), 0) + mm(1.5);
    ensure(total);
    const y0 = doc.y;
    doc.roundedRect(left, y0, width, total, mm(3)).fill(PANEL);
    drawIcon(doc, 'pen', left + mm(4), y0 + mm(3), mm(4.6));
    doc.y = y0 + mm(3);
    heading(sec.heading, 11, left + mm(11), inner);
    doc.y = y0 + mm(9);
    for (const p of sec.paragraphs) {
      text(p, { size: 8.5, x: left + mm(11), w: inner });
      doc.y += mm(0.8);
    }
    doc.x = left;
    doc.y = y0 + total + mm(3.5);
  }

  // ---- Page 2: legal information and the model withdrawal form ----------------------------
  doc.addPage();
  heading(c.legalTitle, 20);
  doc.moveDown(0.1);
  text(c.legalSubtitle, { size: 9.5, color: GREY });
  doc.moveDown(0.7);
  {
    const items = part('legal_info').items ?? [];
    const inner = width - mm(26);
    items.forEach((it, n) => {
      const body = it.paragraphs.reduce((a, p) => a + height(p, inner, 9) + mm(1.2), 0);
      const total = mm(4) + headHeight(it.heading, inner, 11) + mm(1.5) + body + mm(2.5);
      ensure(total);
      const y0 = doc.y;
      doc.roundedRect(left, y0, width, total, mm(3)).lineWidth(0.8).strokeColor(LINE).stroke();
      doc.circle(left + mm(6), y0 + mm(6), mm(3.2)).fill(BLUE);
      doc
        .font(head(true))
        .fontSize(10)
        .fillColor('#ffffff')
        .text(String(n + 1), left + mm(2.8), y0 + mm(4.15), { width: mm(6.4), align: 'center' });
      drawIcon(doc, it.icon, left + mm(13.5), y0 + mm(3.6), mm(5));
      doc.y = y0 + mm(3.6);
      heading(it.heading, 11, left + mm(22), inner);
      doc.y += mm(1.5);
      for (const p of it.paragraphs) {
        text(p, { size: 9, x: left + mm(22), w: inner });
        doc.y += mm(1.2);
      }
      doc.x = left;
      doc.y = y0 + total + mm(3);
    });
  }
  // ---- Appendices: the full texts, word for word -------------------------------------------
  const drawForm = () => {
    const sec = part('muster_widerrufsformular');
    const inner = width - mm(10);
    const body = sec.paragraphs.reduce((a, p) => a + height(p, inner, 8.5) + mm(1), 0);
    const total = mm(11) + body + mm(2);
    ensure(total);
    const y0 = doc.y;
    doc.roundedRect(left, y0, width, total, mm(3)).fill(PANEL);
    drawIcon(doc, 'file', left + mm(4), y0 + mm(3.6), mm(5));
    doc.y = y0 + mm(3.8);
    heading(sec.heading, 11.5, left + mm(11.5), inner);
    doc.y = y0 + mm(10.5);
    for (const p of sec.paragraphs) {
      text(p, { size: 8.5, x: left + mm(5), w: inner });
      doc.y += mm(1);
    }
    doc.x = left;
    doc.y = y0 + total + mm(3);
  };

  for (const p of ['agb', 'widerruf'] as const) {
    const sec = part(p);
    doc.addPage();
    doc.outline.addItem(winAnsi(sec.heading));
    heading(sec.heading, 14);
    doc.moveDown(0.4);
    for (const para of sec.paragraphs) {
      if (para.startsWith('§§ ')) {
        ensure(mm(14));
        doc.moveDown(0.35);
        doc
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .fillColor(INK)
          .text(winAnsi(para.slice(3)), left, doc.y, { width });
        doc.moveDown(0.15);
      } else {
        text(para, { size: 8.8 });
        doc.moveDown(0.25);
      }
    }
    // The withdrawal policy refers to the form „unten stehend“: it follows the policy.
    if (p === 'widerruf') {
      doc.moveDown(0.6);
      drawForm();
    }
  }

  // ---- Footer on every page ------------------------------------------------------------------
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = H - FOOTER + mm(4);
    doc
      .moveTo(left, fy - mm(3))
      .lineTo(left + width, fy - mm(3))
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GREY)
      .text(
        winAnsi(
          `ParkShield – ${c.title} · ${meta.contractNo} · ${de ? 'Fassung' : 'Version'} ${c.docVersion}`,
        ),
        left,
        fy,
        { width: width * 0.75, lineBreak: false },
      );
    doc.text(
      winAnsi(de ? `Seite ${p + 1} von ${range.count}` : `Page ${p + 1} of ${range.count}`),
      left,
      fy,
      { width, align: 'right', lineBreak: false },
    );
    doc.page.margins.bottom = keep;
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
export const contractPdfName = (locale: Locale, contractNo: string) =>
  `${locale === 'de' ? 'Vertragsbestaetigung' : 'Contract_confirmation'}_${contractNo}.pdf`;
