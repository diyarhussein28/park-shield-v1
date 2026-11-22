import { LEGAL_DOC_VERSION } from '@parkshield/shared';
import { describe, expect, it } from 'vitest';
import {
  contractConfirmationContent,
  contractPdfName,
  renderContractConfirmationPdf,
  type ContractConfirmationInput,
} from './contract-confirmation';

const input = (locale: 'de' | 'en'): ContractConfirmationInput => ({
  locale,
  customerNo: 'PS-2027-000042',
  contractNo: 'PS-7K3Q9X2M',
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
  },
  webBaseUrl: 'https://park-shield.de',
});

describe('PDF „Vertragsbestätigung“ (§ 312f BGB)', () => {
  it.each(['de', 'en'] as const)('%s: contains every required part', (locale) => {
    const c = contractConfirmationContent(input(locale));
    expect(c.sections.map((s) => s.part)).toEqual([
      'contract',
      'renewal',
      'immediate_start',
      'benefits',
      'agb',
      'widerruf',
      'muster_widerrufsformular',
    ]);
    const all = (part: string) =>
      c.sections
        .filter((s) => s.part === part)
        .flatMap((s) => [s.heading, ...s.paragraphs])
        .join('\n');
    // Contract data.
    for (const v of ['PS-2027-000042', 'PS-7K3Q9X2M', '3', '2027', '2028']) {
      expect(all('contract')).toContain(v);
    }
    expect(all('contract')).toMatch(
      locale === 'de'
        ? /20,00 € pro Jahr inklusive 19 % MwSt/
        : /€20\.00 per year including 19% VAT/,
    );
    // Renewal and cancellation rules.
    expect(all('renewal')).toMatch(locale === 'de' ? /verlängert sich/ : /renews/);
    expect(all('renewal')).toContain('https://park-shield.de/kuendigen');
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
    expect(all('muster_widerrufsformular')).toMatch(
      locale === 'de' ? /Hiermit widerrufe\(n\) ich\/wir/ : /I\/We \(\*\) hereby give notice/,
    );
    expect(all('widerruf')).not.toMatch(/Hiermit widerrufe\(n\)/); // the form is its own part
  });

  it('renders an A4 PDF with every section', async () => {
    const c = contractConfirmationContent(input('de'));
    const pdf = await renderContractConfirmationPdf(c, {
      created: new Date('2027-08-03T09:15:00Z'),
      contractNo: 'PS-7K3Q9X2M',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(5_000);
    // One outline entry per section: the document's bookmarks name every part.
    expect((pdf.toString('latin1').match(/\/Title \(/g) ?? []).length).toBeGreaterThanOrEqual(
      c.sections.length,
    );
    expect(contractPdfName('de', 'PS-7K3Q9X2M')).toBe('Vertragsbestaetigung_PS-7K3Q9X2M.pdf');
  });
});
