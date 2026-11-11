import { timingSafeEqual } from 'node:crypto';
import {
  createParamDecorator,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import {
  OPS_ACCESS,
  OPS_CSRF_COOKIE,
  OPS_CSRF_HEADER,
  OPS_SESSION_COOKIE,
  type OpsAccess,
} from './access';
import { StaffService, type StaffContext } from './staff.service';

type StaffRequest = FastifyRequest & { staff?: StaffContext };
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard of api-ops (US-34). Fails closed: a route without an access policy is refused.
 * Staff routes need a valid staff session (30-min idle) and, for writes, the double-submit CSRF token.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<OpsAccess | undefined>(OPS_ACCESS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!access) throw new ForbiddenException({ error: 'no_access_policy' });
    if (access.kind === 'public') return true;

    const req = ctx.switchToHttp().getRequest<StaffRequest>();
    const staff = await this.staff.resolve(req.cookies?.[OPS_SESSION_COOKIE]);
    if (!staff) throw new UnauthorizedException({ error: 'not_signed_in' });
    if (!SAFE.has(req.method)) {
      const cookie = req.cookies?.[OPS_CSRF_COOKIE] ?? '';
      const header = String(req.headers[OPS_CSRF_HEADER] ?? '');
      const ok =
        cookie.length > 0 &&
        cookie.length === header.length &&
        timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
      if (!ok) throw new ForbiddenException({ error: 'csrf_failed' });
    }
    if (access.kind === 'permission') {
      const missing = access.permissions.filter((p) => !staff.permissions.has(p));
      if (missing.length) throw new ForbiddenException({ error: 'permission_missing', missing });
    }
    req.staff = staff;
    return true;
  }
}

export const CurrentStaff = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const staff = ctx.switchToHttp().getRequest<StaffRequest>().staff;
  if (!staff) throw new UnauthorizedException({ error: 'not_signed_in' });
  return staff;
});
