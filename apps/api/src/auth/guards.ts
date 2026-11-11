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
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './cookies';
import { SessionService, type AuthContext } from './session.service';

type AuthedRequest = FastifyRequest & { auth?: AuthContext };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const auth = await this.sessions.resolve(req.cookies?.[SESSION_COOKIE]);
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
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(req.method) || !req.cookies?.[SESSION_COOKIE]) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()]))
      return true;
    const cookie = req.cookies[CSRF_COOKIE] ?? '';
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
