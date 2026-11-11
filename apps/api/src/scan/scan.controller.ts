import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ALERT_TYPE_CODES, CUSTOM_MESSAGE_MAX } from '@parkshield/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SkipCsrf } from '../auth/guards';
import { truncateIp } from '../core/ip';
import { RateLimitService } from '../core/rate-limit.service';
import { ZodPipe } from '../core/zod.pipe';
import { CAPTCHA, type Captcha } from '../providers/ports';
import { ScanService } from './scan.service';

const ReportFake = z.object({
  note: z.string().max(500).optional(),
  captcha: z.string().max(4096).optional(),
});
const CreateAlert = z.object({
  type: z.enum(ALERT_TYPE_CODES),
  message: z.string().max(CUSTOM_MESSAGE_MAX).optional(),
  lang: z.enum(['de', 'en']).default('de'),
  captcha: z.string().max(4096).optional(),
});

/** Scanner endpoints: no account, no cookies, no session (SC-01–SC-07). */
@Controller('v1')
@SkipCsrf()
export class ScanController {
  constructor(
    @Inject(ScanService) private readonly scan: ScanService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(CAPTCHA) private readonly captcha: Captcha,
  ) {}

  /** Unknown, revoked and unpaid codes all answer the same; misses are limited per truncated IP. */
  private async resolve(code: string, req: FastifyRequest) {
    const token = await this.scan.lookup(code);
    if (!token) {
      await this.limits.enforce('scan.not_found', truncateIp(req.ip));
      throw new NotFoundException({ error: 'inactive' });
    }
    return token;
  }

  @Get('scan/:code')
  async page(@Param('code') code: string, @Req() req: FastifyRequest) {
    const token = await this.scan.lookup(code);
    if (!token && (await this.scan.isUnclaimed(code))) return { unclaimed: true };
    return this.scan.pageData(token ?? (await this.resolve(code, req)));
  }

  @Post('scan/:code/alerts')
  async create(
    @Param('code') code: string,
    @Body(new ZodPipe(CreateAlert)) body: z.infer<typeof CreateAlert>,
    @Req() req: FastifyRequest,
  ) {
    if (!(await this.captcha.verify(body.captcha)))
      throw new BadRequestException({ error: 'captcha_failed' });
    const token = await this.resolve(code, req);
    return this.scan.createAlert(token, body, {
      ipPrefix: truncateIp(req.ip),
      userAgent: String(req.headers['user-agent'] ?? ''),
      ip: req.ip,
    });
  }

  @Post('scan/:code/report-fake')
  @HttpCode(202)
  async reportFake(
    @Param('code') code: string,
    @Body(new ZodPipe(ReportFake)) body: z.infer<typeof ReportFake>,
    @Req() req: FastifyRequest,
  ) {
    if (!(await this.captcha.verify(body.captcha))) {
      throw new BadRequestException({ error: 'captcha_failed' });
    }
    const token = await this.resolve(code, req);
    await this.scan.reportFake(token, body.note, {
      ipPrefix: truncateIp(req.ip),
      userAgent: String(req.headers['user-agent'] ?? ''),
    });
    return { ok: true };
  }

  /** "Ich warte noch" (SC-14): usable once, from 15 min after the owner's acknowledgement. */
  @Post('alerts/:id/waiting')
  @HttpCode(200)
  async waiting(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-status-token') statusToken: string | undefined,
  ) {
    const r = statusToken ? await this.scan.stillWaiting(id, statusToken) : 'not_found';
    if (r === 'not_found') throw new NotFoundException({ error: 'not_found' });
    if (r === 'used') throw new ConflictException({ error: 'already_sent' });
    if (r === 'not_yet') throw new ConflictException({ error: 'not_available_yet' });
    return { ok: true };
  }

  @Get('alerts/:id/status')
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-status-token') statusToken: string | undefined,
  ) {
    const s = statusToken ? await this.scan.status(id, statusToken) : null;
    if (!s) throw new NotFoundException({ error: 'not_found' });
    return s;
  }
}
