import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { sha256 } from '../core/crypto';
import { DB, ENV } from '../core/tokens';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * One view link per alert with photos (`/v/<token>`), the same in every channel. The token is a 256-bit
 * HMAC of the alert id with a server key (like the reply token, AckService): opaque, unguessable, and
 * the worker can rebuild it for each channel without the raw token ever being written to the outbox or
 * a table. Only SHA-256(token) is stored; deleting that row (or its expiry) ends the link. 43 characters,
 * so an SMS with the link still fits one segment.
 */
@Injectable()
export class ViewTokenService {
  private readonly key: Buffer;
  private readonly webBase: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) env: Env,
  ) {
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- key comes from env.SESSION_SECRET
    this.key = createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'base64'))
      .update('parkshield/alert-view/v1')
      .digest();
    this.webBase = env.WEB_BASE_URL.replace(/\/$/, '');
  }

  tokenFor(alertId: string): string {
    return createHmac('sha256', this.key).update(alertId).digest('base64url');
  }

  urlFor(alertId: string): string {
    return `${this.webBase}/v/${this.tokenFor(alertId)}`;
  }

  hashFor(alertId: string): Buffer {
    return sha256(this.tokenFor(alertId));
  }

  /**
   * The alert behind a token, or null (unknown, malformed or expired all look the same). The lookup is
   * by hash; the token is then compared in constant time with the one derived for that alert.
   */
  async resolve(token: string): Promise<string | null> {
    if (!TOKEN.test(token)) return null;
    const row = await this.db
      .selectFrom('alert_view_tokens')
      .select('alert_id')
      .where('token_hash', '=', sha256(token))
      .where('expires_at', '>', sql<Date>`now()`)
      .executeTakeFirst();
    if (!row) return null;
    const expected = Buffer.from(this.tokenFor(row.alert_id));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given)
      ? row.alert_id
      : null;
  }
}
