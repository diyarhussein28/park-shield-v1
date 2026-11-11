import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { randomToken, sha256 } from '../core/crypto';
import { DB } from '../core/tokens';
import { SESSION_TTL_DAYS } from './cookies';

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  preferredLang: 'de' | 'en';
  kind: 'customer' | 'staff';
  /** When this session was created; export and deletion need a recent sign-in (US-32). */
  signedInAt: Date;
}

/** "Fresh re-authentication" window for export and account deletion. */
export const RECENT_AUTH_MINUTES = 15;

export interface NewSession {
  token: string;
  csrf: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(userId: string, device: string): Promise<NewSession> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
    await this.db
      .insertInto('sessions')
      .values({
        user_id: userId,
        token_hash: sha256(token),
        user_agent: device,
        expires_at: expiresAt,
      })
      .execute();
    return { token, csrf: randomToken(18), expiresAt };
  }

  async resolve(token: string | undefined): Promise<AuthContext | null> {
    if (!token) return null;
    const row = await this.db
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id as sessionId',
        's.created_at as signedInAt',
        'u.id as userId',
        'u.email',
        'u.preferred_lang',
        'u.kind',
      ])
      .where('s.token_hash', '=', sha256(token))
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', sql<Date>`now()`)
      .where('s.is_staff', '=', false)
      .where('u.status', '=', 'active')
      .executeTakeFirst();
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      email: row.email,
      preferredLang: row.preferred_lang,
      kind: row.kind,
      signedInAt: row.signedInAt,
    };
  }

  /** Ends every session of a user (account deletion). */
  async revokeAll(userId: string): Promise<void> {
    await this.db
      .updateTable('sessions')
      .set({ revoked_at: sql`now()` })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db
      .updateTable('sessions')
      .set({ revoked_at: sql`now()` })
      .where('id', '=', sessionId)
      .execute();
  }

  /** True when the user has signed in before, but never from this kind of device (US-05). */
  async isNewDevice(userId: string, device: string): Promise<boolean> {
    const rows = await this.db
      .selectFrom('sessions')
      .select('user_agent')
      .where('user_id', '=', userId)
      .where('created_at', '>', sql<Date>`now() - interval '180 days'`)
      .execute();
    return rows.length > 0 && !rows.some((r) => r.user_agent === device);
  }
}
