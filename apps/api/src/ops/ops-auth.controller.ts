import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { StaffPasskeyService } from '../auth/passkey.service';
import type { Env } from '../config/env';
import { deviceLabel, truncateIp } from '../core/ip';
import { RateLimitService } from '../core/rate-limit.service';
import { ENV } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { OPS_CSRF_COOKIE, OPS_SESSION_COOKIE, OpsPublic, StaffOnly } from './access';
import { CurrentStaff } from './staff.guard';
import { StaffService, type StaffContext } from './staff.service';

const Token = z.object({ token: z.string().min(20).max(100) });
const Register = Token.extend({
  response: z.looseObject({ id: z.string() }),
  label: z.string().max(60).default('Passkey'),
});
const Login = z.object({
  challengeId: z.string().max(64),
  response: z.looseObject({ id: z.string() }),
});

/** Staff sign-in: passkey only, no passwords, no magic links (AD-01). */
@Controller('ops/v1')
export class OpsAuthController {
  constructor(
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(StaffPasskeyService) private readonly passkeys: StaffPasskeyService,
    @Inject(ENV) private readonly env: Env,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  /** ASVS 2.2.1: sign-in and invitation endpoints are limited per peer address. */
  private limit(req: FastifyRequest) {
    return this.limits.enforce('ops_auth.ip', truncateIp(req.ip));
  }

  private setCookies(reply: FastifyReply, s: { token: string; csrf: string }) {
    // Host-only cookies on the ops domain, Strict: ops links are never followed from e-mails.
    const base = {
      path: '/',
      sameSite: 'strict' as const,
      secure: this.env.NODE_ENV === 'production',
    };
    reply.setCookie(OPS_SESSION_COOKIE, s.token, { ...base, httpOnly: true });
    reply.setCookie(OPS_CSRF_COOKIE, s.csrf, { ...base, httpOnly: false });
  }

  @Post('auth/login/options')
  @HttpCode(200)
  @OpsPublic()
  async loginOptions(@Req() req: FastifyRequest) {
    await this.limit(req);
    return this.passkeys.loginOptions();
  }

  @Post('auth/login/verify')
  @HttpCode(200)
  @OpsPublic()
  async login(
    @Body(new ZodPipe(Login)) body: z.infer<typeof Login>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.limit(req);
    const userId = await this.passkeys.login(body.challengeId, body.response as never);
    if (!userId) throw new UnauthorizedException({ error: 'passkey_invalid' });
    this.setCookies(
      reply,
      await this.staff.createSession(userId, deviceLabel(req.headers['user-agent'])),
    );
    return { ok: true };
  }

  @Post('auth/invite/view')
  @HttpCode(200)
  @OpsPublic()
  async inviteView(
    @Body(new ZodPipe(Token)) body: z.infer<typeof Token>,
    @Req() req: FastifyRequest,
  ) {
    await this.limit(req);
    const t = await this.staff.inviteTarget(body.token);
    return { email: t.email, name: t.name };
  }

  @Post('auth/invite/options')
  @HttpCode(200)
  @OpsPublic()
  async inviteOptions(
    @Body(new ZodPipe(Token)) body: z.infer<typeof Token>,
    @Req() req: FastifyRequest,
  ) {
    await this.limit(req);
    const t = await this.staff.inviteTarget(body.token);
    return this.passkeys.registrationOptions({ userId: t.userId, email: t.email });
  }

  @Post('auth/invite/verify')
  @HttpCode(200)
  @OpsPublic()
  async inviteVerify(
    @Body(new ZodPipe(Register)) body: z.infer<typeof Register>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.limit(req);
    const t = await this.staff.inviteTarget(body.token);
    await this.passkeys.register(t.userId, body.response as never, body.label);
    await this.staff.consumeInvite(body.token);
    await this.staff.audit(t.userId, 'staff.passkey_registered', 'users', t.userId);
    this.setCookies(
      reply,
      await this.staff.createSession(t.userId, deviceLabel(req.headers['user-agent'])),
    );
    return { ok: true };
  }

  @Post('auth/logout')
  @HttpCode(200)
  @StaffOnly()
  async logout(
    @CurrentStaff() staff: StaffContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.staff.revoke(staff.sessionId);
    reply.clearCookie(OPS_SESSION_COOKIE, { path: '/' });
    reply.clearCookie(OPS_CSRF_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @StaffOnly()
  me(@CurrentStaff() staff: StaffContext) {
    return {
      email: staff.email,
      name: staff.name,
      roles: staff.roles,
      permissions: [...staff.permissions].sort(),
      sessionExpiresAt: staff.expiresAt,
    };
  }
}
