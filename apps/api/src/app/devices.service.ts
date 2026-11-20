import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';

/**
 * Native app devices (FCM registration tokens). Registered after login and on every app start (that
 * refreshes last_seen_at); removed on logout, when FCM reports the token as invalid, and after 90 days
 * without a sign of life (run_retention). No device fingerprint, no advertising ID.
 */
@Injectable()
export class DevicesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async register(
    userId: string,
    input: {
      fcmToken: string;
      platform: 'ios' | 'android';
      appVersion?: string;
      locale?: 'de' | 'en';
    },
  ) {
    // A token belongs to one app install; if it was registered by another account, it moves.
    const row = await this.db
      .insertInto('user_devices')
      .values({
        user_id: userId,
        fcm_token: input.fcmToken,
        platform: input.platform,
        app_version: input.appVersion ?? null,
        locale: input.locale ?? null,
      })
      .onConflict((oc) =>
        oc.column('fcm_token').doUpdateSet({
          user_id: userId,
          platform: input.platform,
          app_version: input.appVersion ?? null,
          locale: input.locale ?? null,
          failed_count: 0,
          last_seen_at: sql`now()`,
        }),
      )
      .returning(['id', 'platform', 'last_seen_at as lastSeenAt'])
      .executeTakeFirstOrThrow();
    return row;
  }

  async remove(userId: string, fcmToken: string): Promise<void> {
    const r = await this.db
      .deleteFrom('user_devices')
      .where('fcm_token', '=', fcmToken)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!Number(r.numDeletedRows)) throw new NotFoundException({ error: 'device_not_found' });
  }
}
