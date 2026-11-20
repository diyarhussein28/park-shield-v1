import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';

const RANK = { queued: 0, sent: 1, delivered: 2 } as const;

/** Twilio MessageStatus → delivery status; queued/accepted/sending are not recorded (still queued). */
const TWILIO_STATUS: Record<string, 'sent' | 'delivered' | 'failed'> = {
  sent: 'sent',
  delivered: 'delivered',
  failed: 'failed',
  undelivered: 'failed',
};

/** NT-04: SMS delivery statuses from Twilio status callbacks (signature checked by the controller). */
@Injectable()
export class SmsStatusService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async handleTwilio(params: Record<string, unknown>): Promise<number> {
    const str = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : '');
    const status = TWILIO_STATUS[str('MessageStatus')];
    const id = str('MessageSid').slice(0, 128);
    if (!status || !id) return 0;
    const base = this.db
      .updateTable('alert_deliveries')
      .where('channel', '=', 'sms')
      .where('provider_message_id', '=', id);
    if (status === 'failed') {
      const r = await base
        .set({ status: 'failed', error_code: str('ErrorCode').slice(0, 64) || 'failed' })
        .where('status', 'in', ['queued', 'sent'])
        .executeTakeFirst();
      return Number(r.numUpdatedRows);
    }
    // Callbacks arrive out of order: never move a delivery backwards (delivered → sent).
    const lower = (Object.keys(RANK) as (keyof typeof RANK)[]).filter(
      (k) => RANK[k] < RANK[status],
    );
    const at = new Date();
    const r = await base
      .set({
        status,
        ...(status === 'sent' ? { sent_at: sql`coalesce(sent_at, ${at})` } : {}),
        ...(status === 'delivered' ? { delivered_at: sql`coalesce(delivered_at, ${at})` } : {}),
      })
      .where('status', 'in', lower)
      .executeTakeFirst();
    return Number(r.numUpdatedRows);
  }
}
