import { describe, expect, it } from 'vitest';
import type { OutgoingMail } from './ports';
import { EmailSupportDesk } from './support-desk';

describe('support by e-mail (SUPPORT_PROVIDER=email)', () => {
  it('mails the request to the support box with the customer as reply-to and escapes HTML', async () => {
    const sent: OutgoingMail[] = [];
    const desk = new EmailSupportDesk(
      { send: async (m) => void sent.push(m) },
      'contact@park-shield.de',
    );
    const { number } = await desk.createTicket({
      email: 'kunde@example.de',
      name: 'Jonas',
      subject: 'Aufkleber kaputt',
      body: 'Hallo <b>Team</b>',
      tags: ['plus', 'decal'],
      locale: 'de',
    });
    expect(number).toMatch(/^PS-[0-9A-Z]{8}$/);
    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail).toMatchObject({
      to: 'contact@park-shield.de',
      subject: `[${number}] Aufkleber kaputt`,
      replyTo: 'kunde@example.de',
      tag: 'support_ticket',
    });
    expect(mail.text).toContain('Jonas <kunde@example.de>');
    expect(mail.text).toContain('Tags: plus, decal');
    expect(mail.html).toContain('Hallo &#60;b&#62;Team&#60;/b&#62;');
    expect(mail.html).not.toContain('<b>');
  });
});
