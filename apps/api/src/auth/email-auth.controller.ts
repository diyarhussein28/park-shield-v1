import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { truncateIp } from '../core/ip';
import { RateLimitService } from '../core/rate-limit.service';
import { ZodPipe } from '../core/zod.pipe';
import { AuthService } from './auth.service';
import { SkipCsrf } from './guards';

const Request = z.object({
  email: z.string().trim().email().max(254),
  locale: z.enum(['de', 'en']).default('de'),
  /** The app's return address (Linking.createURL('auth/callback')); allowlisted server-side. */
  redirectUri: z.string().trim().max(300).optional(),
});
const Platform = z.enum(['ios', 'android']).optional();
const VerifyCode = z.object({
  email: z.string().trim().email().max(254),
  code: z.string().regex(/^\d{6}$/),
  platform: Platform,
});
const VerifyLink = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
  platform: Platform,
});

const device = (platform?: 'ios' | 'android') =>
  `ParkShield App${platform === 'ios' ? ' (iOS)' : platform === 'android' ? ' (Android)' : ''}`;

/**
 * Sign-in for the native app by e-mail (AUTH.md): the e-mail carries a 6-digit code and a link to the
 * bridge page. Nothing here signs in on a GET; the session token comes back in the body.
 */
@Controller('v1/auth/email')
@SkipCsrf()
export class EmailAuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Post('request')
  @HttpCode(202)
  async request(
    @Body(new ZodPipe(Request)) body: z.infer<typeof Request>,
    @Req() req: FastifyRequest,
  ) {
    await this.auth.requestEmailSignIn({ ...body, ipPrefix: truncateIp(req.ip) });
    return { ok: true };
  }

  @Post('verify-code')
  @HttpCode(200)
  async verifyCode(
    @Body(new ZodPipe(VerifyCode)) body: z.infer<typeof VerifyCode>,
    @Req() req: FastifyRequest,
  ) {
    await this.limits.enforce('auth.code_ip', truncateIp(req.ip));
    const session = await this.auth.verifyEmailCode(body.email, body.code, device(body.platform));
    return { token: session.token, expiresAt: session.expiresAt };
  }

  @Post('verify-link')
  @HttpCode(200)
  async verifyLink(
    @Body(new ZodPipe(VerifyLink)) body: z.infer<typeof VerifyLink>,
    @Req() req: FastifyRequest,
  ) {
    await this.limits.enforce('auth.ip', truncateIp(req.ip));
    const session = await this.auth.consumeMagicLink(body.token, device(body.platform));
    if (!session) throw new UnauthorizedException({ error: 'link_invalid_or_used' });
    return { token: session.token, expiresAt: session.expiresAt };
  }

  /** For the bridge page: where „In der App öffnen“ leads. Looking it up never spends the link. */
  @Get('return/:rid')
  async returnUrl(@Param('rid') rid: string, @Req() req: FastifyRequest) {
    await this.limits.enforce('auth.ip', truncateIp(req.ip));
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(rid)) return { url: null };
    return { url: await this.auth.signInReturnUrl(rid) };
  }
}
