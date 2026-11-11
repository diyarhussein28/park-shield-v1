import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { normalizeEmail, randomToken, sha256 } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { DB, ENV, LOGGER } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { CAPTCHA, type Captcha } from '../providers/ports';
import { SessionService, type NewSession } from './session.service';

const LINK_TTL_MS = 15 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CAPTCHA) private readonly captcha: Captcha,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /**
   * Always resolves the same way whether or not the address exists, so the endpoint cannot be used to
   * discover customers. 5 links per hour per address (02-architecture §10).
   */
  async requestMagicLink(input: {
    email: string;
    locale: 'de' | 'en';
    captcha?: string;
    ipPrefix: string;
  }): Promise<void> {
    if (!(await this.captcha.verify(input.captcha))) {
      throw new BadRequestException({ error: 'captcha_failed' });
    }
    const email = normalizeEmail(input.email);
    await this.limits.enforce('magic_link.ip', input.ipPrefix);
    await this.limits.enforce('magic_link.email', sha256(email).toString('hex'));

    await this.db
      .insertInto('users')
      .values({ email, preferred_lang: input.locale })
      .onConflict((oc) => oc.column('email').doNothing())
      .execute();
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'status', 'preferred_lang', 'kind'])
      .where('email', '=', email)
      .executeTakeFirstOrThrow();
    if (user.status !== 'active' || user.kind !== 'customer') return;

    const token = randomToken();
    await this.db
      .insertInto('magic_link_tokens')
      .values({
        user_id: user.id,
        token_hash: sha256(token),
        expires_at: new Date(Date.now() + LINK_TTL_MS),
      })
      .execute();
    // The token travels in the URL fragment: it never reaches server logs or Referer headers.
    await this.mail.send({
      to: email,
      template: 'magic_link',
      locale: user.preferred_lang,
      actionUrl: `${this.env.WEB_BASE_URL}/anmelden/link#t=${token}`,
    });
  }

  /** Single use: the token is consumed atomically by the explicit "Anmelden" POST, never by a GET. */
  async consumeMagicLink(token: string, device: string): Promise<NewSession | null> {
    const used = await this.db
      .updateTable('magic_link_tokens')
      .set({ used_at: sql`now()` })
      .where('token_hash', '=', sha256(token))
      .where('used_at', 'is', null)
      .where('expires_at', '>', sql<Date>`now()`)
      .returning('user_id')
      .executeTakeFirst();
    if (!used) return null;
    return this.signIn(used.user_id, device);
  }

  async signIn(userId: string, device: string): Promise<NewSession> {
    const isNew = await this.sessions.isNewDevice(userId, device);
    const user = await this.db
      .updateTable('users')
      .set({
        email_verified_at: sql`coalesce(email_verified_at, now())`,
        last_login_at: sql`now()`,
      })
      .where('id', '=', userId)
      .returning(['email', 'preferred_lang'])
      .executeTakeFirstOrThrow();
    const session = await this.sessions.create(userId, device);
    if (isNew) {
      await this.mail
        .send({
          to: user.email,
          template: 'new_device',
          locale: user.preferred_lang,
          values: { when: new Date(), device },
        })
        .catch((e: unknown) => this.logger.error({ err: String(e) }, 'new-device mail failed'));
    }
    return session;
  }
}
