import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Mailer, OutgoingMail } from './ports';

export const DEV_MAILBOX_KEY = 'dev:mailbox';

export function parseSender(from: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1]!, email: m[2]! } : { name: 'ParkShield', email: from.trim() };
}

/** Brevo transactional e-mail (EU). */
export class BrevoMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseSender(this.from),
        to: [{ email: mail.to }],
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: mail.html,
        tags: [mail.tag],
      }),
    });
    if (!res.ok) throw new Error(`Brevo send failed with HTTP ${res.status}`);
  }
}

/** Local fake: keeps the last 50 mails in Valkey for the dev inbox page and E2E tests. */
export class DevMailer implements Mailer {
  constructor(
    private readonly valkey: Redis,
    private readonly logger: Logger,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    await this.valkey
      .multi()
      .lpush(DEV_MAILBOX_KEY, JSON.stringify({ ...mail, sentAt: new Date().toISOString() }))
      .ltrim(DEV_MAILBOX_KEY, 0, 49)
      .exec();
    this.logger.info({ tag: mail.tag }, 'dev mail stored in local inbox');
  }
}
