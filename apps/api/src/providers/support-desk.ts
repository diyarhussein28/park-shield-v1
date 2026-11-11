import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { randomCrockford } from '../core/crypto';
import type { SupportDesk, SupportTicket } from './ports';

export const DEV_TICKETS_KEY = 'dev:zammad:tickets';

/** Self-hosted Zammad REST API (token auth). The customer is matched or created by e-mail. */
export class ZammadDesk implements SupportDesk {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly group: string,
  ) {}

  async createTicket(t: SupportTicket): Promise<{ number: string }> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/v1/tickets`, {
      method: 'POST',
      headers: { authorization: `Token token=${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: t.subject,
        group: this.group,
        // "guess:" finds the customer by e-mail or creates them.
        customer_id: `guess:${t.email}`,
        tags: t.tags.join(','),
        article: {
          subject: t.subject,
          body: t.body,
          type: 'web',
          sender: 'Customer',
          internal: false,
          content_type: 'text/plain',
        },
      }),
    });
    if (!res.ok) throw new Error(`zammad ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const ticket = (await res.json()) as { number: string | number };
    return { number: String(ticket.number) };
  }
}

/** Local stand-in: tickets go to Valkey and are listed at GET /v1/dev/zammad/tickets. */
export class DevSupportDesk implements SupportDesk {
  constructor(
    private readonly valkey: Redis,
    private readonly logger: Logger,
  ) {}

  async createTicket(t: SupportTicket): Promise<{ number: string }> {
    const number = `DEV-${randomCrockford(6)}`;
    await this.valkey
      .multi()
      .lpush(DEV_TICKETS_KEY, JSON.stringify({ number, ...t, at: new Date().toISOString() }))
      .ltrim(DEV_TICKETS_KEY, 0, 99)
      .exec();
    this.logger.info({ number, tags: t.tags }, 'dev support ticket created');
    return { number };
  }
}
