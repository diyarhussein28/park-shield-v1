import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, SessionGuard, SkipCsrf } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { truncateIp } from '../core/ip';
import { RateLimitService } from '../core/rate-limit.service';
import { ZodPipe } from '../core/zod.pipe';
import { AlertMediaService } from './alert-media.service';

const Report = z.object({ source: z.enum(['view_page', 'email_link']).default('view_page') });

/**
 * The owner's view page for an alert with photos (`/v/<token>`). The token alone authenticates (it came
 * in the owner's notification); every request is rate-limited per network, and unknown, malformed and
 * expired tokens all answer with the same 404.
 */
@Controller('v1/alerts')
@SkipCsrf()
export class AlertViewController {
  constructor(
    @Inject(AlertMediaService) private readonly media: AlertMediaService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Get('view/:token')
  async view(
    @Param('token') token: string,
    @Query('reveal') reveal: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    await this.limits.enforce('alert_view.ip', truncateIp(req.ip));
    return this.media.view(token, reveal === '1');
  }

  /** The decrypted photo, streamed from memory; never cached, never indexed, no referrer. */
  @Get('media/:mediaId')
  async photo(
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Query('t') token: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.limits.enforce('alert_view.ip', truncateIp(req.ip));
    const p = token ? await this.media.photo(token, mediaId) : null;
    if (!p) throw new NotFoundException({ error: 'not_found' });
    return reply
      .header('content-type', 'image/jpeg')
      .header('content-length', String(p.data.length))
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex, nofollow')
      .header('referrer-policy', 'no-referrer')
      .header('content-disposition', `inline; filename="parkshield-foto-${p.position}.jpg"`)
      .send(p.data);
  }

  @Post('view/:token/report-abuse')
  @HttpCode(200)
  async report(
    @Param('token') token: string,
    @Body(new ZodPipe(Report)) body: z.infer<typeof Report>,
    @Req() req: FastifyRequest,
  ) {
    await this.limits.enforce('alert_view.ip', truncateIp(req.ip));
    return this.media.reportFromView(token, body.source);
  }
}

/** "Missbrauch melden" from the alert history in the owner portal. */
@Controller('v1/portal/alerts')
@UseGuards(SessionGuard)
export class PortalAlertMediaController {
  constructor(@Inject(AlertMediaService) private readonly media: AlertMediaService) {}

  @Post(':alertId/report-abuse')
  @HttpCode(200)
  report(@CurrentUser() user: AuthContext, @Param('alertId', ParseUUIDPipe) alertId: string) {
    return this.media.reportFromPortal(user.userId, alertId);
  }
}
