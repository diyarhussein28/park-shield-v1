import { timingSafeEqual } from 'node:crypto';
import {
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { Env } from '../config/env';
import { ENV } from '../core/tokens';
import { CSRF_HEADER, sessionCookies } from './cookies';
import { SessionService, type AuthContext } from './session.service';

type AuthedRequest = FastifyRequest & { auth?: AuthContext };

/**
 * The native app sends its session as `Authorization: Bearer <token>` (kept in the iOS Keychain /
 * Android Keystore). A bearer header is never sent automatically by a browser, so it needs no CSRF token
 * (CsrfGuard only checks requests that carry the session cookie).
 */
export function bearerToken(req: Pick<FastifyRequest, 'headers'>): string | undefined {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(h.trim());
  return m?.[1];
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const name = sessionCookies(this.env).session;
    const auth = await this.sessions.resolve(req.cookies?.[name] ?? bearerToken(req));
    if (!auth) throw new UnauthorizedException({ error: 'not_signed_in' });
    req.auth = auth;
    return true;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SKIP_CSRF = 'skipCsrf';

/** For endpoints that never use the session (scanner page): a stray portal cookie must not matter. */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

/** Double-submit CSRF check for every state-changing request that carries a session cookie. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const names = sessionCookies(this.env);
    if (SAFE_METHODS.has(req.method) || !req.cookies?.[names.session]) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]))
      return true;
    const cookie = req.cookies[names.csrf] ?? '';
    const header = String(req.headers[CSRF_HEADER] ?? '');
    const ok =
      cookie.length > 0 &&
      cookie.length === header.length &&
      timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
    if (!ok) throw new ForbiddenException({ error: 'csrf_failed' });
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new UnauthorizedException({ error: 'not_signed_in' });
  return auth;
});
