import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
import { signInReturn } from './sign-in-return';

const LINK_TTL_MS = 15 * 60_000;
/** Wrong codes allowed per sign-in e-mail before the code is spent. */
export const MAX_CODE_ATTEMPTS = 5;

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
    /**
     * The native app: no captcha widget there (the per-network and per-address limits below still
     * apply), and the link opens the app (/app/anmelden, a universal / app link) instead of the portal.
     */
    app?: boolean;
  }): Promise<void> {
    if (!input.app && !(await this.captcha.verify(input.captcha))) {
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
      actionUrl: input.app
        ? `${this.env.WEB_BASE_URL}/app/anmelden#t=${token}`
        : `${this.env.WEB_BASE_URL}/anmelden/link#t=${token}`,
    });
  }

  /**
   * The app's sign-in e-mail (AUTH.md): a 6-digit code and an https link to the bridge page
   * (`/auth/open`). One row carries both, so using either spends the other. Only an HMAC of the code
   * and the token's hash are stored; the app's return address stays on the server (return_id).
   * Answers are the same whether or not the address has an account.
   */
  async requestEmailSignIn(input: {
    email: string;
    locale: 'de' | 'en';
    redirectUri?: string;
    ipPrefix: string;
  }): Promise<void> {
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
    const tokenHash = sha256(token);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const rid = randomToken(16);
    await this.db
      .insertInto('magic_link_tokens')
      .values({
        user_id: user.id,
        token_hash: tokenHash,
        code_hash: this.codeHash(tokenHash, code),
        return_url: signInReturn(input.redirectUri, this.env),
        return_id: rid,
        expires_at: new Date(Date.now() + LINK_TTL_MS),
      })
      .execute();
    // Everything after # stays in the browser: no token or code in server logs or Referer headers.
    await this.mail.send({
      to: email,
      template: 'sign_in_code',
      locale: user.preferred_lang,
      values: { code },
      actionUrl: `${this.env.WEB_BASE_URL}/auth/open#t=${token}&r=${rid}&c=${code}`,
    });
  }

  /** HMAC with the server secret: a leaked table does not give away 6-digit codes by brute force. */
  private codeHash(tokenHash: Buffer, code: string): Buffer {
    return createHmac('sha256', this.env.SESSION_SECRET).update(tokenHash).update(code).digest();
  }

  /**
   * Signs in with the 6-digit code from the latest sign-in e-mail. Wrong codes count; after 5 the
   * code is spent. `code_invalid` for a wrong code (and for an address without any request),
   * `code_expired` once the code is spent, used or older than 15 minutes.
   */
  async verifyEmailCode(emailRaw: string, code: string, device: string): Promise<NewSession> {
    const email = normalizeEmail(emailRaw);
    const row = await this.db
      .selectFrom('magic_link_tokens as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select([
        'm.id',
        'm.user_id',
        'm.token_hash',
        'm.code_hash',
        'm.code_attempts',
        'm.used_at',
        sql<boolean>`m.expires_at > now()`.as('live'),
      ])
      .where('u.email', '=', email)
      .where('m.code_hash', 'is not', null)
      .orderBy('m.created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) throw new BadRequestException({ error: 'code_invalid' });
    if (row.used_at || !row.live || row.code_attempts >= MAX_CODE_ATTEMPTS) {
      throw new BadRequestException({ error: 'code_expired' });
    }
    const expected = row.code_hash!;
    const given = this.codeHash(row.token_hash, code);
    if (!timingSafeEqual(expected, given)) {
      const after = await this.db
        .updateTable('magic_link_tokens')
        .set({ code_attempts: sql`code_attempts + 1` })
        .where('id', '=', row.id)
        .returning('code_attempts')
        .executeTakeFirstOrThrow();
      throw new BadRequestException({
        error: after.code_attempts >= MAX_CODE_ATTEMPTS ? 'code_expired' : 'code_invalid',
      });
    }
    const used = await this.db
      .updateTable('magic_link_tokens')
      .set({ used_at: sql`now()` })
      .where('id', '=', row.id)
      .where('used_at', 'is', null)
      .where('code_attempts', '<', MAX_CODE_ATTEMPTS)
      .where('expires_at', '>', sql<Date>`now()`)
      .returning('user_id')
      .executeTakeFirst();
    if (!used) throw new BadRequestException({ error: 'code_expired' });
    return this.signIn(used.user_id, device);
  }

  /** The bridge page asks where to send the person; looking it up never spends the link. */
  async signInReturnUrl(rid: string): Promise<string> {
    const row = await this.db
      .selectFrom('magic_link_tokens')
      .select('return_url')
      .where('return_id', '=', rid)
      .where('expires_at', '>', sql<Date>`now()`)
      .executeTakeFirst();
    if (!row?.return_url) throw new NotFoundException({ error: 'not_found' });
    return row.return_url;
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
