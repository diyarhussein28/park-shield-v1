import { describe, expect, it } from 'vitest';
import { renderLayout } from './layout';
import { mailTemplates, renderMail, type MailTemplate } from './templates';

const names = Object.keys(mailTemplates.de) as MailTemplate[];
const values = {
  when: new Date('2027-08-03T09:15:00Z'),
  receivedAt: new Date('2027-08-03T09:15:00Z'),
  endsAt: new Date('2028-08-03T00:00:00Z'),
  periodEnd: new Date('2028-08-03T00:00:00Z'),
  device: 'Chrome · Windows',
  code: '482913',
  plan: 'Plus',
  contractNo: 'PS-7K3Q9X2M',
  customerNo: 'PS-2027-000042',
  topic: 'Aufkleber und Versand',
  preview: 'Mein Aufkleber löst sich',
  client: 'web',
  email: 'kunde@example.de',
  product: 'ParkShield-Jahresabo',
  paidAt: new Date('2027-08-03T09:15:00Z'),
  paymentId: 'pi_3QABCDEF',
  attachment: 'attached',
  file: 'PS-2027-000042_PS-7K3Q9X2M_Brief.pdf',
  company: 'Malermeister <Schulz> GmbH',
  nextAttemptAt: new Date('2028-08-06T00:00:00Z'),
  nickname: 'Der Blaue',
  trackingNumber: '00340434161234567890',
  type: 'Fahrzeug versperrt Ausfahrt',
  hasMessage: 'yes',
  message: 'Stehe in der Einfahrt',
  contact: 'Kim',
  owner: 'Jonas',
  hasOwner: 'yes',
  decision: 'confirmed',
  months: 11,
  step: 1,
  steps: 3,
  since: new Date('2027-07-03T09:15:00Z'),
  alerts: 2,
  vehicles: 1,
  active: 1,
  score: 75,
  used: 8,
  limit: 10,
  channel: 'SMS',
  due: new Date('2027-08-04T09:15:00Z'),
  name: 'Anna',
  field: 'Kennzeichen',
  ticket: 'ZM-1234',
  count: 2,
  first: new Date('2027-08-10T09:15:00Z'),
  amount: '7,42 €',
  creditNote: 'GS-2027-000001',
  ended: 'yes',
  days: 90,
  list: 'sms.failures: CRITICAL',
  price: '10,00 €',
  startedAt: new Date('2027-08-03T09:15:00Z'),
  renewalRule: 'Die erste Laufzeit beträgt 12 Monate.',
  consentAt: new Date('2027-08-03T09:14:00Z'),
  consentText: 'Ich verlange ausdrücklich …',
  docVersion: '2026-11-26',
  agbText: 'AGB\n§ 1 Leistung',
  widerrufText: 'Widerrufsbelehrung',
  kind: 'ordinary',
  requestedLine: '',
  reasonLine: '',
  contractRef: 'PS-7K3Q9X2M',
  receiptEmail: 'anna@example.de',
  renewsAt: new Date('2028-08-03T00:00:00Z'),
  interval: 'month',
  at: new Date('2027-08-03T09:15:00Z'),
  noApp: 'yes',
  sms: 'yes',
  until: new Date('2027-09-02T00:00:00Z'),
};

describe('mail templates', () => {
  it('DE and EN define the same templates with the same structure', () => {
    expect(Object.keys(mailTemplates.en).sort()).toEqual([...names].sort());
    for (const n of names) {
      const de: { lines: string[]; action?: string } = mailTemplates.de[n];
      const en: { lines: string[]; action?: string } = mailTemplates.en[n];
      expect(en.lines.length, n).toBe(de.lines.length);
      expect(Boolean(en.action), n).toBe(Boolean(de.action));
    }
  });

  it.each(names)('%s renders in both locales without leftover placeholders', (name) => {
    for (const locale of ['de', 'en'] as const) {
      const r = renderMail(name, locale, values, 'https://parkshield.de/x');
      expect(r.subject + r.text).not.toMatch(/[{}]/);
    }
  });

  it('formats dates in German time and escapes HTML', () => {
    const r = renderMail(
      'ec_invite',
      'de',
      { ...values, owner: values.company },
      'https://parkshield.de/b?x=1&y=2',
    );
    expect(r.html).toContain('Malermeister &lt;Schulz&gt; GmbH');
    expect(r.html).toContain('href="https://parkshield.de/b?x=1&amp;y=2"');
    const c = renderMail('cancel_received', 'de', values);
    expect(c.text).toContain('3. August 2027 um 11:15');
  });

  // The one layout for every e-mail (2026-11-22): snapshot of each type, privacy and structure rules.
  const frame = {
    webBaseUrl: 'https://park-shield.de',
    company: {
      name: 'Diyar Hussein Dienstleistungen',
      street: 'Monheimer Str. 24',
      postalCode: '51371',
      city: 'Leverkusen',
      country: 'DE',
    },
  };

  it.each(names)('%s: snapshot in the shared layout (DE and EN)', (name) => {
    for (const locale of ['de', 'en'] as const) {
      const r = renderMail(name, locale, values, 'https://park-shield.de/x', [], [], frame);
      expect({ subject: r.subject, text: r.text }).toMatchSnapshot(locale);
    }
  });

  it.each(names)(
    '%s: own logo only, no tracking, plain-text part, footer and no-reply line',
    (name) => {
      for (const locale of ['de', 'en'] as const) {
        const r = renderMail(name, locale, values, 'https://park-shield.de/x', [], [], frame);
        const imgs = [...r.html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
        expect(imgs.length).toBeGreaterThan(0);
        for (const src of imgs)
          expect(src).toBe('https://park-shield.de/email/parkshield-shield.png');
        // No tracking pixel or tracking parameters, no external fonts or scripts.
        expect(r.html).not.toMatch(
          /utm_|mc_eid|trk|pixel|width="1"|height="1"|<script|@import|fonts\.googleapis/i,
        );
        expect(r.html).toMatch(/<meta name="color-scheme" content="light dark">/);
        // At most one primary blue button.
        expect((r.html.match(/class="ps-btn"/g) ?? []).length).toBeLessThanOrEqual(1);
        expect(r.text.length).toBeGreaterThan(50);
        expect(r.text).not.toMatch(/<[a-z]/i);
        const noReply =
          locale === 'de'
            ? 'Dies ist eine automatische Nachricht von ParkShield. Bitte antworten Sie nicht auf diese E-Mail.'
            : 'This is an automated message from ParkShield. Please do not reply to this e-mail.';
        // Internal support mails are answered by replying: no „do not reply“ line there.
        const replyable = name === 'support_request';
        expect(r.text.includes(noReply)).toBe(!replyable);
        expect(r.html.includes(noReply)).toBe(!replyable);
        for (const path of ['/hilfe', '/datenschutz', '/agb', '/widerruf']) {
          expect(r.html).toContain(`href="https://park-shield.de${path}"`);
        }
        expect(r.html).toContain('Monheimer Str. 24');
        expect(r.html).toContain('Hosted in Germany');
        expect(r.html).toContain(locale === 'de' ? 'Hilfe benötigt?' : 'Need help?');
      }
    },
  );

  it('the sign-in code sits in the highlighted box with „Gültig für 15 Minuten“; the action link is the first URL', () => {
    const r = renderMail(
      'sign_in_code',
      'de',
      values,
      'https://park-shield.de/app/anmelden#t=abc',
      [],
      [],
      frame,
    );
    expect(r.html).toMatch(/class="ps-code"[^>]*>482913</);
    expect(r.html).toContain('Gültig für 15 Minuten');
    expect(r.html).toContain('Smarter QR-Schutz für Ihr Fahrzeug');
    expect(/\b(\d{6})\b/.exec(r.text)![1]).toBe('482913');
    expect(/(https?:\/\/\S+)/.exec(r.text)![1]).toBe('https://park-shield.de/app/anmelden#t=abc');
  });

  it('a greeting line becomes the headline; otherwise the subject is the headline', () => {
    const l = renderLayout({
      locale: 'en',
      subject: 'S',
      headline: 'Hello Anna,',
      lines: ['Body'],
      replies: [],
      links: [],
    });
    expect(l.html).toMatch(/<h1[^>]*>Hello Anna,<\/h1>/);
    const e = renderMail('staff_invite', 'de', values, 'https://x.example/y', [], [], frame);
    expect(e.html).toMatch(/<h1[^>]*>Hallo Anna,<\/h1>/);
    const d = renderMail('decal_shipped', 'de', values, 'https://x.example/y', [], [], frame);
    expect(d.html).toMatch(/<h1[^>]*>Ihr Aufkleber ist unterwegs<\/h1>/);
  });
});
