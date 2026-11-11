import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Db } from '../core/core.module';
import { DB, LOGGER } from '../core/tokens';
import type { OwnerReply } from '../db/types.generated';
import { AckService } from './ack.service';

const Status = z.object({
  id: z.string().max(128),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: z.coerce.number().optional(),
  errors: z.array(z.object({ code: z.coerce.string() })).optional(),
});
// Quick-reply tap on a template button: the payload was set by DispatchService (`ack:<token>:<reply>`).
const ButtonMessage = z.object({
  type: z.literal('button'),
  button: z.object({ payload: z.string().max(256) }),
});
const Payload = z.object({
  entry: z
    .array(
      z.object({
        changes: z.array(
          z.object({
            field: z.string().optional(),
            value: z
              .object({
                statuses: z.array(z.unknown()).optional(),
                messages: z.array(z.unknown()).optional(),
              })
              .loose(),
          }),
        ),
      }),
    )
    .default([]),
});
const HEALTH_FIELDS = new Set([
  'phone_number_quality_update',
  'message_template_status_update',
  'message_template_quality_update',
]);
const REPLY_PAYLOAD = /^ack:([A-Za-z0-9_-]{20,100}):(coming|in_30_min|not_nearby)$/;

const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 } as const;

/** NT-04 delivery statuses and OW-16 quick replies (Meta Cloud API format, forwarded by 360dialog). */
@Injectable()
export class WhatsAppWebhookService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AckService) private readonly ack: AckService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async handle(body: unknown): Promise<number> {
    const parsed = Payload.safeParse(body);
    if (!parsed.success) return 0;
    let updated = 0;
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        if (change.field && HEALTH_FIELDS.has(change.field)) {
          updated += await this.health(change.field, change.value);
          continue;
        }
        for (const raw of change.value.statuses ?? []) {
          const s = Status.safeParse(raw);
          if (s.success) updated += await this.apply(s.data);
        }
        for (const raw of change.value.messages ?? []) {
          const m = ButtonMessage.safeParse(raw);
          const match = m.success ? REPLY_PAYLOAD.exec(m.data.button.payload) : null;
          if (!match) continue;
          try {
            await this.ack.reply(match[1]!, match[2] as OwnerReply);
            updated += 1;
          } catch (err) {
            // Second tap, expired alert: nothing to do. Meta must still get a 200.
            this.logger.info({ err: (err as Error).message }, 'whatsapp quick reply not applied');
          }
        }
      }
    }
    return updated;
  }

  /**
   * AD-16: the number's quality and the template status, shown on the provider health screen. A
   * flagged number or a paused template means WhatsApp may stop delivering soon (kill switch, NT-12).
   */
  private async health(field: string, value: Record<string, unknown>): Promise<number> {
    const event = String(value.event ?? '').slice(0, 40);
    const rows: { metric: string; value: string }[] = [];
    if (field === 'phone_number_quality_update') {
      if (event === 'FLAGGED') rows.push({ metric: 'meta_quality_rating', value: 'RED' });
      if (event === 'UNFLAGGED') rows.push({ metric: 'meta_quality_rating', value: 'GREEN' });
      if (value.current_limit)
        rows.push({ metric: 'messaging_limit', value: String(value.current_limit).slice(0, 40) });
    } else if (field === 'message_template_status_update') {
      const name = String(value.message_template_name ?? 'unknown').slice(0, 24);
      rows.push({ metric: `template_status:${name}`, value: event });
    } else if (field === 'message_template_quality_update') {
      const name = String(value.message_template_name ?? 'unknown').slice(0, 24);
      rows.push({
        metric: `template_quality:${name}`,
        value: String(value.new_quality_score ?? '').slice(0, 20),
      });
    }
    if (!rows.length) return 0;
    await this.db
      .insertInto('provider_status_events')
      .values(rows.map((r) => ({ provider: '360dialog', ...r })))
      .execute();
    return rows.length;
  }

  private async apply(s: z.infer<typeof Status>): Promise<number> {
    const status = s.status;
    const at = s.timestamp ? new Date(s.timestamp * 1000) : new Date();
    const base = this.db
      .updateTable('alert_deliveries')
      .where('channel', '=', 'whatsapp')
      .where('provider_message_id', '=', s.id);
    if (status === 'failed') {
      const r = await base
        .set({ status: 'failed', error_code: s.errors?.[0]?.code.slice(0, 64) ?? 'failed' })
        .where('status', 'in', ['queued', 'sent'])
        .executeTakeFirst();
      return Number(r.numUpdatedRows);
    }
    // Webhooks arrive out of order: never move a delivery backwards (read → delivered).
    const lower = (Object.keys(RANK) as (keyof typeof RANK)[]).filter(
      (k) => RANK[k] < RANK[status],
    );
    const r = await base
      .set({
        status,
        ...(status === 'sent' ? { sent_at: sql`coalesce(sent_at, ${at})` } : {}),
        ...(status !== 'sent' ? { delivered_at: sql`coalesce(delivered_at, ${at})` } : {}),
        ...(status === 'read' ? { read_at: at } : {}),
      })
      .where('status', 'in', lower)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }
}
