import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { randomToken } from '../core/crypto';
import type { WhatsAppSender, WhatsAppTemplate } from './ports';

export const DEV_WHATSAPP_KEY = 'dev:whatsapp';

/**
 * 360dialog (WhatsApp BSP, Berlin). Templates are approved in Phase 0 (05-business §11 week 7);
 * the OTP template uses the authentication category with a copy-code button.
 */
export class Dialog360Sender implements WhatsAppSender {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async sendTemplate(input: {
    to: string;
    template: WhatsAppTemplate;
    lang: 'de' | 'en';
    params: string[];
    buttons?: string[];
  }): Promise<{ messageId: string }> {
    const components: unknown[] = [
      { type: 'body', parameters: input.params.map((text) => ({ type: 'text', text })) },
      ...(input.buttons ?? []).map((payload, index) => ({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload }],
      })),
    ];
    if (input.template === 'ps_otp') {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: input.params[0] }],
      });
    }
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: { 'D360-API-KEY': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'template',
        template: { name: input.template, language: { code: input.lang }, components },
      }),
    });
    if (!res.ok) throw new Error(`360dialog send failed with HTTP ${res.status}`);
    const body = (await res.json()) as { messages?: { id: string }[] };
    const id = body.messages?.[0]?.id;
    if (!id) throw new Error('360dialog returned no message id');
    return { messageId: id };
  }
}

/** Local fake: messages land in the dev inbox next to the e-mails. */
export class DevWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly valkey: Redis,
    private readonly logger: Logger,
  ) {}

  async sendTemplate(input: {
    to: string;
    template: WhatsAppTemplate;
    lang: 'de' | 'en';
    params: string[];
    buttons?: string[];
  }): Promise<{ messageId: string }> {
    const messageId = `wamid.dev.${randomToken(12)}`;
    await this.valkey
      .multi()
      .lpush(
        DEV_WHATSAPP_KEY,
        JSON.stringify({ ...input, messageId, sentAt: new Date().toISOString() }),
      )
      .ltrim(DEV_WHATSAPP_KEY, 0, 49)
      .exec();
    this.logger.info({ template: input.template }, 'dev WhatsApp message stored in local inbox');
    return { messageId };
  }
}
