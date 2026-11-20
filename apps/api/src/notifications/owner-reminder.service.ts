import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';

export const REMIND_TOPIC = 'alert.remind';

/**
 * Owner reminder (tiered notifications): an alert nobody answered within `reminder.after_minutes`
 * (default 3) gets a second push (all plans) and, for PREMIUM, a second SMS. "Seen" does not stop it,
 * an answer does, and so does opening the chat (ChatService.open clears `remind_at`). `remind_at` is the source of truth; the sweeper marks due alerts (reminded_at)
 * and queues the reminder in one statement, so there is never a double reminder, also after a Valkey
 * restart or with several workers.
 */
@Injectable()
export class OwnerReminderService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async initialRemindAt(isTest: boolean): Promise<Date | null> {
    if (isTest) return null;
    const minutes = Number(await this.settings.get('reminder.after_minutes', 3));
    return minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  }

  async sweep(): Promise<number> {
    const rows = await sql<{ id: string }>`
      WITH due AS (
        UPDATE alerts SET reminded_at = now()
         WHERE id IN (
           SELECT id FROM alerts
            WHERE reminded_at IS NULL AND remind_at <= now() AND expires_at > now()
              AND owner_reply IS NULL AND acknowledged_by IS NULL AND NOT is_test
              AND status IN ('dispatched', 'delivered', 'escalated')
            ORDER BY remind_at LIMIT 200 FOR UPDATE SKIP LOCKED)
         RETURNING id)
      INSERT INTO outbox_events (topic, payload)
      SELECT ${REMIND_TOPIC}, jsonb_build_object('alertId', id) FROM due
      RETURNING id`.execute(this.db);
    return rows.rows.length;
  }
}
