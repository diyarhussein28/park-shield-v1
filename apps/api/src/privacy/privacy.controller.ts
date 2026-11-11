import { Body, Controller, Delete, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { clearSessionCookies } from '../auth/cookies';
import { CurrentUser, SessionGuard, SkipCsrf } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import { ENV } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { PrivacyService } from './privacy.service';

const Delete_ = z.object({ confirm: z.literal(true) });
const Cancel = z.object({ token: z.string().min(20).max(100) });

@Controller('v1/me')
export class PrivacyController {
  constructor(
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('export')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async exportJson(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const data = await this.privacy.exportJson(user);
    reply.header('content-disposition', 'attachment; filename="parkshield-daten.json"');
    reply.header('cache-control', 'no-store');
    return data;
  }

  @Post('export.pdf')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async exportPdf(@CurrentUser() user: AuthContext, @Res() reply: FastifyReply) {
    const pdf = await this.privacy.exportPdf(user);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', 'attachment; filename="parkshield-daten.pdf"')
      .header('cache-control', 'no-store')
      .send(pdf);
  }

  @Delete()
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async remove(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Delete_)) _body: z.infer<typeof Delete_>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const r = await this.privacy.requestDeletion(user);
    clearSessionCookies(reply, this.env.NODE_ENV === 'production');
    return r;
  }

  /** Link from the "confirm your request" e-mail sent by support (AD-11 identity verification). */
  @Post('dsr/confirm')
  @HttpCode(200)
  @SkipCsrf()
  confirm(@Body(new ZodPipe(Cancel)) body: z.infer<typeof Cancel>) {
    return this.privacy.confirmIdentity(body.token);
  }

  /** Link from the confirmation e-mail; the person is signed out, so the token authenticates. */
  @Post('deletion/cancel')
  @HttpCode(200)
  @SkipCsrf()
  async cancel(@Body(new ZodPipe(Cancel)) body: z.infer<typeof Cancel>) {
    await this.privacy.cancelDeletion(body.token);
    return { ok: true };
  }
}
