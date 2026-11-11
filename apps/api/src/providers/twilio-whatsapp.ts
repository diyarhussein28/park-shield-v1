import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env';
import type { WhatsAppSender, WhatsAppTemplate } from './ports';

type Lang = 'de' | 'en';
export type ContentSids = Partial<Record<`${WhatsAppTemplate}:${Lang}`, string>>;

export const TWILIO_WEBHOOK_PATH = '/v1/webhooks/twilio/whatsapp';

/** The approved template per language (TWILIO_CONTENT_<TEMPLATE>_<LANG>). */
export function contentSidsFromEnv(env: Env): ContentSids {
  const sids: ContentSids = {};
  for (const t of ['ps_alert', 'ps_followup', 'ps_test', 'ps_otp'] as const) {
    for (const l of ['de', 'en'] as const) {
      const v = env[`TWILIO_CONTENT_${t.toUpperCase()}_${l.toUpperCase()}` as keyof Env];
      if (typeof v === 'string' && v) sids[`${t}:${l}`] = v;
    }
  }
  return sids;
}

/** Where Twilio reaches us: the public origin (TWILIO_WEBHOOK_BASE_URL, else WEB_BASE_URL) + path. */
export const twilioWebhookUrl = (env: Pick<Env, 'TWILIO_WEBHOOK_BASE_URL' | 'WEB_BASE_URL'>) =>
  `${(env.TWILIO_WEBHOOK_BASE_URL || env.WEB_BASE_URL).replace(/\/$/, '')}${TWILIO_WEBHOOK_PATH}`;

/**
 * Twilio's request signature (X-Twilio-Signature): base64 HMAC-SHA1 with the auth token over the full
 * URL followed by every POST parameter, sorted by name, as name + value.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      const v = params[k];
      return acc + (Array.isArray(v) ? v.map((x) => k + String(x)).join('') : k + String(v ?? ''));
    }, url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
  signature: string | undefined,
): boolean {
  if (!authToken || !signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * WhatsApp through Twilio (Content API templates, approved by Meta). Body variables are {{1}}, {{2}};
 * for templates with quick replies the three button ids follow as the next variables, so a tap comes
 * back as ButtonPayload `ack:<token>:<reply>` exactly as with 360dialog (NT-02, OW-16).
 */
export class TwilioWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    private readonly contentSids: ContentSids,
    /** Only an https URL is passed on: Twilio cannot call localhost. */
    private readonly statusCallback: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendTemplate(input: {
    to: string;
    template: WhatsAppTemplate;
    lang: Lang;
    params: string[];
    buttons?: string[];
  }): Promise<{ messageId: string }> {
    const contentSid = this.contentSids[`${input.template}:${input.lang}`];
    if (!contentSid) {
      throw new Error(`No Twilio template SID for ${input.template} (${input.lang})`);
    }
    const values = [...input.params];
    if (input.template !== 'ps_otp') {
      // Three quick-reply ids; messages without reply links (the test after linking) get inert ones.
      for (let i = 0; i < 3; i++) values.push(input.buttons?.[i] ?? `noop:${i}`);
    }
    const variables = Object.fromEntries(values.map((v, i) => [String(i + 1), v]));
    const form = new URLSearchParams({
      To: `whatsapp:+${input.to.replace(/^\+/, '')}`,
      From: `whatsapp:+${this.from.replace(/^\+/, '')}`,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify(variables),
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
        `Twilio send failed with HTTP ${res.status}${body.code ? ` (${body.code})` : ''}`,
      );
    }
    if (!body.sid) throw new Error('Twilio returned no message SID');
    return { messageId: body.sid };
  }
}
