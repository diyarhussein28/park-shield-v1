import { describe, expect, it } from 'vitest';
import type { OutgoingMail } from './ports';
import { EmailSupportDesk } from './support-desk';

describe('support by e-mail (SUPPORT_PROVIDER=email)', () => {
  it('mails the request to the support box in the shared layout, reply-to = the customer, HTML escaped', async () => {
    const sent: OutgoingMail[] = [];
    const desk = new EmailSupportDesk(
      { send: async (m) => void sent.push(m) },
      'support@park-shield.de',
      'https://park-shield.de',
    );
    const { number } = await desk.createTicket({
      email: 'kunde@example.de',
      name: 'Jonas',
      subject: 'Aufkleber kaputt',
      body: 'Hallo <b>Team</b>',
      tags: ['standard', 'topic_decal'],
      locale: 'de',
      fields: {
        topic: 'Aufkleber und Versand',
        message: 'Hallo <b>Team</b>, mein Aufkleber ist kaputt.',
        customerNo: 'PS-2026-000042',
        contractNo: 'PS-7K3Q9X2M',
        client: 'web',
        at: new Date('2026-11-22T10:15:00Z'),
      },
    });
    expect(number).toMatch(/^PS-[0-9A-Z]{8}$/);
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail).toMatchObject({
      to: 'support@park-shield.de',
      replyTo: 'kunde@example.de',
      tag: 'support_ticket',
    });
    expect(mail.subject).toBe(
      `[${number}] Aufkleber und Versand: Hallo <b>Team</b>, mein Aufkleber ist kaputt.`,
    );
    // Exactly the agreed fields: topic, message, e-mail, customer and contract number, version, time.
    for (const s of [
      'Betreff: –',
      'Thema: Aufkleber und Versand',
      'E-Mail: kunde@example.de',
      'Kundennummer: PS-2026-000042',
      'Vertragsnummer: PS-7K3Q9X2M',
      'Version: web',
      '22. November 2026 um 11:15',
      'mein Aufkleber ist kaputt',
    ]) {
      expect(mail.text).toContain(s);
    }
    // No other personal data (the name stays out), no „do not reply“ line: replying is the point.
    expect(mail.text).not.toContain('Jonas');
    expect(mail.text).not.toContain('Bitte antworten Sie nicht');
    expect(mail.html).toContain('Hallo &lt;b&gt;Team&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Team');
    expect(mail.html).toContain('Neue Anfrage über das Kontaktformular');
  });

  it('shows the subject of the in-app form and uses it in the e-mail subject', async () => {
    const sent: OutgoingMail[] = [];
    const desk = new EmailSupportDesk(
      { send: async (m) => void sent.push(m) },
      'support@park-shield.de',
    );
    await desk.createTicket({
      email: 'antwort@example.de',
      name: null,
      subject: '[Sonstiges] Rechnung fehlt',
      body: 'x',
      tags: ['topic_other', 'signed_in'],
      locale: 'de',
      fields: {
        topic: 'Sonstiges',
        subject: 'Rechnung fehlt',
        message: 'Ich finde meine Rechnung nicht.',
        customerNo: 'PS-2026-000042',
        contractNo: null,
        client: 'app 1.0.0 ios',
        at: new Date('2026-11-22T10:15:00Z'),
      },
    });
    expect(sent[0]!.subject).toMatch(/^\[PS-[0-9A-Z]{8}\] Sonstiges: Rechnung fehlt$/);
    expect(sent[0]!.text).toContain('Betreff: Rechnung fehlt');
    expect(sent[0]!.replyTo).toBe('antwort@example.de');
  });
});
