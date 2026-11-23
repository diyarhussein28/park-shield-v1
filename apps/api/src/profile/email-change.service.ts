import { randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { normalizeEmail, sha256, type FieldCrypto } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { CRYPTO, DB, ENV, LOGGER, VALKEY } from '../core/tokens';
import { MailService } from '../mail/mail.service';

/** Outbox topic: copy the account's current e-mail to its Stripe customer (idempotent). */
export const CUSTOMER_EMAIL_TOPIC = 'billing.customer_email';

/** 15 minutes, like the sign-in code. */
export const EMAIL_CHANGE_TTL = 900;
const MAX_ATTEMPTS = 5;
const KEY = 'email:change';

interface Pending {
  email: string;
  codeHash: string;
  attempts: number;
}

/** „anna.schmidt@example.de“ → „an•••@example.de“: the security notice never shows the full address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email.slice(0, Math.min(2, at))}•••${email.slice(at)}`;
}

/**
 * Konto → „E-Mail ändern“. The new address gets a 6-digit code; only after that code is confirmed does
 * `users.email` change (the old address stays the sign-in address until then). Nothing is written to
 * PostgreSQL before the confirmation: the pending change lives in Valkey for 15 minutes, with an HMAC
 * of the code (never the code). After the change: a security notice to the OLD address, the Stripe
 * customer's e-mail is synced through the outbox, and the audit log gets `user.email_changed` without
 * any address in it.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  private codeHash(userId: string, email: string, code: string): string {
    return sha256(`${this.env.SESSION_SECRET}:${userId}:${email}:${code}`).toString('hex');
  }

  private async taken(email: string, userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .where('id', '!=', userId)
      .executeTakeFirst();
    return Boolean(row);
  }

  async start(
    user: AuthContext,
    raw: string,
  ): Promise<{ email: string; expiresInSeconds: number }> {
    const email = normalizeEmail(raw);
    if (email === normalizeEmail(user.email))
      throw new BadRequestException({ error: 'email_unchanged' });
    await this.limits.enforce('email_change.user', user.userId);
    await this.limits.enforce('email_change.email', sha256(email).toString('hex'));
    if (await this.taken(email, user.userId)) throw new ConflictException({ error: 'email_taken' });

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const pending: Pending = {
      email,
      codeHash: this.codeHash(user.userId, email, code),
      attempts: 0,
    };
    await this.valkey.set(`${KEY}:${user.userId}`, JSON.stringify(pending), 'EX', EMAIL_CHANGE_TTL);
    await this.mail.send({
      to: email,
      template: 'email_change_code',
      locale: user.preferredLang,
      values: { code },
    });
    return { email, expiresInSeconds: EMAIL_CHANGE_TTL };
  }

  async verify(user: AuthContext, code: string): Promise<{ email: string }> {
    await this.limits.enforce('email_change.verify', user.userId);
    const key = `${KEY}:${user.userId}`;
    const raw = await this.valkey.get(key);
    if (!raw) throw new BadRequestException({ error: 'code_expired' });
    const pending = JSON.parse(raw) as Pending;
    const ok = timingSafeEqual(
      Buffer.from(pending.codeHash, 'hex'),
      Buffer.from(this.codeHash(user.userId, pending.email, code.trim()), 'hex'),
    );
    if (!ok) {
      pending.attempts += 1;
      if (pending.attempts >= MAX_ATTEMPTS) await this.valkey.del(key);
      else await this.valkey.set(key, JSON.stringify(pending), 'KEEPTTL');
      throw new BadRequestException({
        error: pending.attempts >= MAX_ATTEMPTS ? 'code_expired' : 'code_wrong',
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - pending.attempts),
      });
    }
    // Spend the code first: a second request with the same code finds nothing.
    if (!(await this.valkey.del(key))) throw new BadRequestException({ error: 'code_expired' });

    const oldEmail = await this.db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('users')
        .select(['email'])
        .where('id', '=', user.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (await this.taken(pending.email, user.userId))
        throw new ConflictException({ error: 'email_taken' });
      try {
        await trx
          .updateTable('users')
          .set({ email: pending.email, email_verified_at: sql`now()`, updated_at: sql`now()` })
          .where('id', '=', user.userId)
          .execute();
      } catch (err) {
        // Unique e-mail (another account took it in the meantime).
        if ((err as { code?: string }).code === '23505')
          throw new ConflictException({ error: 'email_taken' });
        throw err;
      }
      // An e-mail contact channel (if any) follows the account address.
      await trx
        .updateTable('contact_channels')
        .set({
          address_enc: this.crypto.encrypt(pending.email),
          address_bidx: this.crypto.blindIndex(pending.email),
          key_version: this.crypto.keyVersion,
          verified_at: sql`now()`,
        })
        .where('user_id', '=', user.userId)
        .where('type', '=', 'email')
        .execute();
      // Unused sign-in links and codes went to the old address: they no longer sign in.
      await trx
        .updateTable('magic_link_tokens')
        .set({ used_at: sql`now()` })
        .where('user_id', '=', user.userId)
        .where('used_at', 'is', null)
        .execute();
      await trx
        .insertInto('audit_logs')
        .values({
          actor_id: user.userId,
          actor_kind: 'customer',
          action: 'user.email_changed',
          entity: 'users',
          entity_id: user.userId,
          meta: JSON.stringify({ via: 'email_code' }),
        })
        .execute();
      await trx
        .insertInto('outbox_events')
        .values({ topic: CUSTOMER_EMAIL_TOPIC, payload: JSON.stringify({ userId: user.userId }) })
        .execute();
      return before.email;
    });

    await this.mail
      .send({
        to: oldEmail,
        template: 'email_changed',
        locale: user.preferredLang,
        values: {
          when: new Date(),
          masked: maskEmail(pending.email),
          support: this.env.SUPPORT_EMAIL,
        },
      })
      .catch((e: unknown) => this.logger.error({ err: String(e) }, 'email-changed notice failed'));
    return { email: pending.email };
  }

  /** Cancels a pending change (the old address stays). */
  async cancel(user: AuthContext): Promise<void> {
    await this.valkey.del(`${KEY}:${user.userId}`);
  }
}
