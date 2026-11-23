import { LEGAL_DOC_VERSION } from '@parkshield/shared';
import { describe, expect, it } from 'vitest';
import {
  contractConfirmationContent,
  contractDate,
  contractPdfName,
  renderContractConfirmationPdf,
  type ContractConfirmationInput,
} from './contract-confirmation';

const input = (locale: 'de' | 'en'): ContractConfirmationInput => ({
  locale,
  customerNo: 'PS-2027-000042',
  contractNo: 'PS-7K3Q9X2M',
  customer: {
    name: 'Maximilian Müller-Lüdenscheidt',
    address: ['Große Straße der Einheit 128a', '51371 Leverkusen', 'Deutschland'],
  },
  price: locale === 'de' ? '20,00 €' : '€20.00',
  startedAt: new Date('2027-08-03T09:15:00Z'),
  renewsAt: new Date('2028-08-03T09:15:00Z'),
  renewalMode: 'annual',
  docVersion: LEGAL_DOC_VERSION,
  consent: {
    text: 'Ich verlange ausdrücklich, dass Sie vor Ende der Widerrufsfrist mit der Leistung beginnen.',
    at: new Date('2027-08-03T09:14:00Z'),
  },
  company: {
    name: 'Diyar Hussein Dienstleistungen',
    street: 'Monheimer Str. 24',
    postalCode: '51371',
    city: 'Leverkusen',
    email: 'contact@park-shield.de',
    owner: 'Diyar Hussein',
    phone: '+49 176 20591765',
    website: 'park-shield.de',
    vatId: 'DE454570643',
  },
  webBaseUrl: 'https://park-shield.de',
  stickerValue: locale === 'de' ? '3,00 €' : '€3.00',
});

const sectionText = (s: ReturnType<typeof contractConfirmationContent>['sections'][number]) =>
  [
    s.heading,
    ...(s.rows ?? []).map((r) => `${r.label}: ${r.value}`),
    ...(s.items ?? []).flatMap((i) => [i.heading, ...i.paragraphs]),
    ...s.paragraphs,
  ].join('\n');

describe('PDF „Vertragsbestätigung“ (§ 312f BGB)', () => {
  it('store purchases (A6): a confirmation, not an invoice; cancel and refund through the store', () => {
    const c = contractConfirmationContent({ ...input('de'), store: 'app_store' });
    const text = [c.status.text, ...c.sections.map(sectionText)].join('\n');
    expect(text).toContain('Dieses Dokument ist eine Vertragsbestätigung, keine Rechnung.');
    expect(text).toContain('den Zahlungsbeleg erhalten Sie von Apple');
    expect(text).toContain('https://reportaproblem.apple.com');
    const play = contractConfirmationContent({ ...input('de'), store: 'play_store' });
    expect(play.sections.map(sectionText).join('\n')).toContain(
      'https://play.google.com/store/account/orderhistory',
    );
    expect(text).toContain('Bezahlt über: Apple App Store');
    expect(text).not.toContain('Stripe');
  });

  it.each(['de', 'en'] as const)('%s: contains every required part', (locale) => {
    const c = contractConfirmationContent(input(locale));
    expect(c.sections.map((s) => s.part)).toEqual([
      'contract',
      'benefits',
      'renewal',
      'withdrawal',
      'immediate_start',
      'provider',
      'legal_info',
      'muster_widerrufsformular',
      'agb',
      'widerruf',
    ]);
    const all = (part: string) =>
      c.sections
        .filter((s) => s.part === part)
        .map(sectionText)
        .join('\n');
    expect(c.customer?.name).toBe('Maximilian Müller-Lüdenscheidt');
    expect(c.status.text).toMatch(locale === 'de' ? /keine Rechnung\.$/ : /not an invoice\.$/);
    // Contract data.
    for (const v of ['PS-2027-000042', 'PS-7K3Q9X2M', '3', '2027', '2028']) {
      expect(all('contract')).toContain(v);
    }
    expect(all('contract')).toMatch(
      locale === 'de'
        ? /Jahrespreis: 20,00 € \/ Jahr \(inkl\. 19 % MwSt\.\)/
        : /Annual price: €20\.00 \/ year \(incl\. 19% VAT\)/,
    );
    // B2: the sticker value included in the price.
    expect(all('contract')).toMatch(
      locale === 'de'
        ? /Im Preis enthalten: personalisierter Aufkleber inkl\. Versand im Wert von 3,00 €/
        : /Included in the price: personalised sticker incl\. shipping worth €3\.00/,
    );
    expect(all('contract')).toContain(locale === 'de' ? '3. August 2027' : '3 August 2027');
    expect(all('contract')).toContain(
      locale === 'de' ? 'Nächste Verlängerung: 3. August 2028' : 'Next renewal: 3 August 2028',
    );
    // Renewal and cancellation: short on page 1, in full under „Rechtliche Informationen“.
    expect(all('renewal')).toContain('https://park-shield.de/kuendigen');
    expect(all('legal_info')).toMatch(locale === 'de' ? /verlängert sich/ : /renews/);
    expect(all('legal_info')).toContain('§ 312g');
    expect(all('withdrawal')).toContain('https://park-shield.de/widerrufen');
    // The provider's legal details.
    for (const v of [
      'Diyar Hussein Dienstleistungen',
      'Monheimer Str. 24',
      'contact@park-shield.de',
      'DE454570643',
    ]) {
      expect(all('provider')).toContain(v);
    }
    // The immediate-start declaration with its timestamp (Berlin time).
    expect(all('immediate_start')).toContain('Ich verlange ausdrücklich');
    expect(all('immediate_start')).toContain('11:14');
    // Included services, the free sticker and the 3 € print.
    const benefits = all('benefits');
    for (const re of locale === 'de'
      ? [
          /Push/,
          /Erinnerung/,
          /SMS/,
          /Fotos/,
          /Chat/,
          /gedruckter Aufkleber inklusive Versand/,
          /Selbst ausdrucken/,
          /3 €.*„Sperren“/,
        ]
      : [
          /Push/,
          /Reminder/,
          /SMS/,
          /Photos/,
          /chat/,
          /printed decal including shipping/,
          /Print it yourself/,
          /€3.*“Block”/,
        ]) {
      expect(benefits).toMatch(re);
    }
    // The AGB in the accepted version, the withdrawal policy and the model form.
    expect(all('agb')).toContain(LEGAL_DOC_VERSION);
    expect(all('agb').length).toBeGreaterThan(500);
    expect(all('widerruf')).toMatch(locale === 'de' ? /Widerrufsbelehrung/ : /Withdrawal policy/);
    // The model withdrawal form in its complete statutory wording (Anlage 2 EGBGB).
    for (const re of locale === 'de'
      ? [
          /Wenn Sie den Vertrag widerrufen wollen/,
          /Hiermit widerrufe\(n\) ich\/wir \(\*\)/,
          /Bestellt am \(\*\)\/erhalten am \(\*\)/,
          /Unterschrift des\/der Verbraucher\(s\) \(nur bei Mitteilung auf Papier\)/,
          /\(\*\) Unzutreffendes streichen\./,
          /Vertragsnummer PS-7K3Q9X2M/,
        ]
      : [/I\/We \(\*\) hereby give notice/, /\(\*\) Delete as appropriate\./, /PS-7K3Q9X2M/]) {
      expect(all('muster_widerrufsformular')).toMatch(re);
    }
    expect(all('widerruf')).not.toMatch(/Hiermit widerrufe\(n\)/); // the form is its own part
  });

  it('dates: no profile, contract end instead of renewal, times for short (sandbox) periods', () => {
    const c = contractConfirmationContent({
      ...input('de'),
      customer: null,
      renews: false,
      withTime: true,
      startedAt: new Date('2026-11-22T23:57:19Z'),
      renewsAt: new Date('2026-11-23T00:57:19Z'),
    });
    expect(c.customer).toBeNull();
    const rows = c.sections.find((s) => s.part === 'contract')!.rows!;
    expect(rows.find((r) => r.icon === 'calendar')!.value).toBe('23. November 2026, 00:57 Uhr');
    expect(rows.find((r) => r.icon === 'refresh')).toMatchObject({
      label: 'Vertragsende',
      value: '23. November 2026, 01:57 Uhr',
    });
    expect(contractDate(new Date('2027-08-03T22:30:00Z'), 'en')).toBe('4 August 2027'); // Berlin
    const unknown = contractConfirmationContent({ ...input('en'), renewsAt: null });
    expect(
      unknown.sections.find((s) => s.part === 'contract')!.rows!.find((r) => r.icon === 'refresh')!
        .value,
    ).toBe('–');
  });

  it('renders an A4 PDF with every section', async () => {
    const c = contractConfirmationContent(input('de'));
    const pdf = await renderContractConfirmationPdf(c, {
      created: new Date('2027-08-03T09:15:00Z'),
      contractNo: 'PS-7K3Q9X2M',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    // Page 1 (contract), page 2 (legal information), appendix A (AGB) and B (withdrawal policy).
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(4);
    for (const store of ['app_store', null] as const) {
      for (const locale of ['de', 'en'] as const) {
        const other = await renderContractConfirmationPdf(
          contractConfirmationContent({ ...input(locale), store, customer: null, consent: null }),
          { created: new Date(), contractNo: 'PS-7K3Q9X2M' },
        );
        expect(other.subarray(0, 5).toString()).toBe('%PDF-');
      }
    }
    expect(contractPdfName('de', 'PS-7K3Q9X2M')).toBe('Vertragsbestaetigung_PS-7K3Q9X2M.pdf');
  });
});
