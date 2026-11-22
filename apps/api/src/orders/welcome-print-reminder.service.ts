import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';
import { APP_PUSH, type AppPushSender } from '../providers/ports';

/** Generic texts only (FCM is Google): no name, no plate, no vehicle label. */
const TEXT = {
  de: {
    title: 'ParkShield',
    body: 'Ihr kostenloser Aufkleber wartet: jetzt gestalten und zusenden lassen.',
  },
  en: { title: 'ParkShield', body: 'Your free sticker is waiting: design it and have it sent.' },
} as const;

/**
 * B1 (2026-11-22): the welcome print is no longer queued on its own; it waits for the customer's
 * confirmation. Customers with an active subscription who have not ordered it get one push reminder
 * after 1 day and one after 3 days (counted in `users.welcome_print_reminders`).
 */
@Injectable()
export class WelcomePrintReminderService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_PUSH) private readonly push: AppPushSender,
  ) {}

  async sweep(): Promise<number> {
    // One statement claims each step, so a second worker never sends the same reminder twice.
    const due = await this.db
      .updateTable('users as u')
      .set({ welcome_print_reminders: sql`u.welcome_print_reminders + 1` })
      .where('u.free_welcome_print_used', '=', false)
      .where('u.welcome_print_reminders', '<', 2)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('subscriptions as s')
            .select('s.id')
            .whereRef('s.user_id', '=', 'u.id')
            .where('s.status', 'in', ['active', 'past_due'])
            .where(
              's.created_at',
              '<',
              sql<Date>`now() - (CASE WHEN u.welcome_print_reminders = 0 THEN interval '1 day' ELSE interval '3 days' END)`,
            ),
        ),
      )
      .returning(['u.id', 'u.preferred_lang'])
      .execute();
    for (const u of due) {
      const devices = await this.db
        .selectFrom('user_devices')
        .select(['fcm_token', 'locale'])
        .where('user_id', '=', u.id)
        .execute();
      for (const d of devices) {
        const t = TEXT[d.locale ?? u.preferred_lang];
        await this.push.send({
          token: d.fcm_token,
          title: t.title,
          body: t.body,
          data: { kind: 'welcome_print' },
          urgent: false,
          ttlSeconds: 86_400,
          collapseKey: 'welcome-print',
        });
      }
    }
    return due.length;
  }
}
