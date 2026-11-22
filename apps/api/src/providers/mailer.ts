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
        ...(mail.replyTo ? { replyTo: { email: mail.replyTo } } : {}),
        ...(mail.attachments?.length
          ? {
              attachment: mail.attachments.map((a) => ({
                name: a.filename,
                content: a.content.toString('base64'),
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Brevo send failed with HTTP ${res.status}`);
  }
}

/**
 * Mailjet (Sinch Mailjet SAS, EU). Send API v3.1; open and click tracking are switched off for every
 * message, so links stay exactly as written (magic-link tokens never pass a tracking redirect) and no
 * pixel is added.
 */
export class MailjetMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const sender = parseSender(this.from);
    const res = await this.fetchImpl('https://api.mailjet.com/v3.1/send', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        Messages: [
          {
            From: { Email: sender.email, Name: sender.name },
            To: [{ Email: mail.to }],
            Subject: mail.subject,
            TextPart: mail.text,
            HTMLPart: mail.html,
            ...(mail.replyTo ? { ReplyTo: { Email: mail.replyTo } } : {}),
            ...(mail.attachments?.length
              ? {
                  Attachments: mail.attachments.map((a) => ({
                    ContentType: a.contentType,
                    Filename: a.filename,
                    Base64Content: a.content.toString('base64'),
                  })),
                }
              : {}),
            TrackOpens: 'disabled',
            TrackClicks: 'disabled',
            // Template name only (no personal data), for the provider's logs.
            CustomID: mail.tag,
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      Messages?: { Status?: string; Errors?: { ErrorCode?: string }[] }[];
    };
    const msg = body.Messages?.[0];
    if (!res.ok || msg?.Status !== 'success') {
      const code = msg?.Errors?.[0]?.ErrorCode;
      throw new Error(`Mailjet send failed with HTTP ${res.status}${code ? ` (${code})` : ''}`);
    }
  }
}

/** SendGrid (Twilio's e-mail service). `eu` sends through the EU data-residency endpoint. */
export class SendGridMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly region: 'global' | 'eu' = 'global',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    const host = this.region === 'eu' ? 'api.eu.sendgrid.com' : 'api.sendgrid.com';
    const res = await this.fetchImpl(`https://${host}/v3/mail/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: mail.to }] }],
        from: parseSender(this.from),
        subject: mail.subject,
        // text/plain must come first (SendGrid API).
        content: [
          { type: 'text/plain', value: mail.text },
          { type: 'text/html', value: mail.html },
        ],
        categories: [mail.tag],
        ...(mail.replyTo ? { reply_to: { email: mail.replyTo } } : {}),
        ...(mail.attachments?.length
          ? {
              attachments: mail.attachments.map((a) => ({
                content: a.content.toString('base64'),
                filename: a.filename,
                type: a.contentType,
                disposition: 'attachment',
              })),
            }
          : {}),
        // No click or open tracking: links stay as they are and nobody is tracked (hard rule 2).
        tracking_settings: {
          click_tracking: { enable: false, enable_text: false },
          open_tracking: { enable: false },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`SendGrid send failed with HTTP ${res.status}`);
  }
}

/** Local fake: keeps the last 50 mails in Valkey for the dev inbox page and E2E tests. */
export class DevMailer implements Mailer {
  constructor(
    private readonly valkey: Redis,
    private readonly logger: Logger,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    // Attachments are kept base64-encoded so the dev inbox and tests can open them.
    const attachments = mail.attachments?.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.content.length,
      base64: a.content.toString('base64'),
    }));
    await this.valkey
      .multi()
      .lpush(
        DEV_MAILBOX_KEY,
        JSON.stringify({ ...mail, attachments, sentAt: new Date().toISOString() }),
      )
      .ltrim(DEV_MAILBOX_KEY, 0, 49)
      .exec();
    this.logger.info({ tag: mail.tag }, 'dev mail stored in local inbox');
  }
}
