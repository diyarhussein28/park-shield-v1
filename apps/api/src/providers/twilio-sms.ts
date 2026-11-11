import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { randomToken } from '../core/crypto';
import type { Env } from '../config/env';
import type { SmsSender } from './ports';

export const DEV_SMS_KEY = 'dev:sms';
export const TWILIO_SMS_WEBHOOK_PATH = '/v1/webhooks/twilio/sms';

/** Where Twilio sends SMS status callbacks: the public origin + path (same base as WhatsApp). */
export const twilioSmsWebhookUrl = (env: Pick<Env, 'TWILIO_WEBHOOK_BASE_URL' | 'WEB_BASE_URL'>) =>
  `${(env.TWILIO_WEBHOOK_BASE_URL || env.WEB_BASE_URL).replace(/\/$/, '')}${TWILIO_SMS_WEBHOOK_PATH}`;

/**
 * The From of an SMS: a Messaging Service (MG…), a Twilio number (+…) or an alphanumeric sender ID
 * (1–11 letters, digits and spaces, at least one letter; one-way, supported in Germany).
 */
export function smsSender(from: string): { MessagingServiceSid: string } | { From: string } {
  const v = from.trim();
  if (/^MG[0-9a-f]{32}$/i.test(v)) return { MessagingServiceSid: v };
  if (/^\+[1-9]\d{6,14}$/.test(v)) return { From: v };
  if (/^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/.test(v)) return { From: v };
  throw new Error(
    'TWILIO_SMS_FROM must be MG…, an E.164 number or a sender ID of max. 11 characters',
  );
}

/** Twilio Programmable SMS (same account and auth token as WhatsApp). */
export class TwilioSmsSender implements SmsSender {
  private readonly from: ReturnType<typeof smsSender>;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    from: string,
    /** Only an https URL is passed on: Twilio cannot call localhost. */
    private readonly statusCallback: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.from = smsSender(from);
  }

  async send(input: { to: string; body: string; tag: string }): Promise<{ messageId: string }> {
    const form = new URLSearchParams({
      To: `+${input.to.replace(/^\+/, '')}`,
      Body: input.body,
      ...this.from,
    });
    if (this.statusCallback?.startsWith('https://'))
      form.set('StatusCallback', this.statusCallback);
    const res = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await res.json().catch(() => ({}))) as { sid?: string; code?: number };
    if (!res.ok) {
      throw new Error(
        `Twilio SMS failed with HTTP ${res.status}${body.code ? ` (${body.code})` : ''}`,
      );
    }
    if (!body.sid) throw new Error('Twilio returned no message SID');
    return { messageId: body.sid };
  }
}

/** Local fake: SMS land in the dev inbox next to the e-mails. */
export class DevSmsSender implements SmsSender {
  constructor(
    private readonly valkey: Redis,
    private readonly logger: Logger,
  ) {}

  async send(input: { to: string; body: string; tag: string }): Promise<{ messageId: string }> {
    const messageId = `SMdev${randomToken(12)}`;
    await this.valkey
      .multi()
      .lpush(DEV_SMS_KEY, JSON.stringify({ ...input, messageId, sentAt: new Date().toISOString() }))
      .ltrim(DEV_SMS_KEY, 0, 49)
      .exec();
    this.logger.info({ tag: input.tag }, 'dev SMS stored in local inbox');
    return { messageId };
  }
}
