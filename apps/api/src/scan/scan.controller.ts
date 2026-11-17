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
import { ScannerVerificationService } from '../abuse/verification.service';
import { scannerIpPrefix, truncateIp } from '../core/ip';
import { RateLimitService } from '../core/rate-limit.service';
import { ZodPipe } from '../core/zod.pipe';
import { CAPTCHA, type Captcha } from '../providers/ports';
import { readAlertMultipart } from '../alert-media/multipart';
import { ScanService } from './scan.service';
import { captchaSolution } from '../providers/captcha';

const ReportFake = z.object({
  note: z.string().max(500).optional(),
  captcha: captchaSolution,
});
const CreateAlert = z.object({
  type: z.enum(ALERT_TYPE_CODES),
  message: z.string().max(CUSTOM_MESSAGE_MAX).optional(),
  lang: z.enum(['de', 'en']).default('de'),
  captcha: captchaSolution,
  /** Signed token from verify/check, kept in page memory only (abuse protection §4). */
  verification: z.string().max(400).optional(),
});
const VerifyStart = z.object({
  phone: z.string().min(3).max(30),
  lang: z.enum(['de', 'en']).default('de'),
  captcha: captchaSolution,
});
const VerifyCheck = z.object({
  phone: z.string().min(3).max(30),
  code: z.string().regex(/^\d{4,10}$/),
});

/** Captcha first, before any limit is counted or any file is processed (abuse protection §1). */
const CAPTCHA_FAILED = {
  error: 'captcha_failed',
  message: 'Die Sicherheitsprüfung hat nicht geklappt. Bitte versuchen Sie es erneut.',
} as const;

const context = (req: FastifyRequest) => ({
  ipPrefix: truncateIp(req.ip),
  refPrefix: scannerIpPrefix(req.ip),
  userAgent: String(req.headers['user-agent'] ?? ''),
  ip: req.ip,
});

/** Scanner endpoints: no account, no cookies, no session (SC-01–SC-07). */
@Controller('v1')
@SkipCsrf()
export class ScanController {
  constructor(
    @Inject(ScanService) private readonly scan: ScanService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(CAPTCHA) private readonly captcha: Captcha,
    @Inject(ScannerVerificationService) private readonly verification: ScannerVerificationService,
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

  /**
   * JSON, or multipart/form-data with the same JSON in the field `alert` plus up to two `photos`
   * (Phase 2, ALERT_PHOTOS_ENABLED). The captcha is verified before any photo is decoded.
   */
  @Post('scan/:code/alerts')
  async create(@Param('code') code: string, @Req() req: FastifyRequest) {
    const raw = req.isMultipart() ? await readAlertMultipart(req) : { body: req.body, photos: [] };
    const body: z.infer<typeof CreateAlert> = new ZodPipe(CreateAlert).transform(raw.body);
    if (!(await this.captcha.verify(body.captcha))) throw new BadRequestException(CAPTCHA_FAILED);
    const token = await this.resolve(code, req);
    return this.scan.createAlert(token, body, context(req), raw.photos);
  }

  /** Abuse protection §4: Lookup (mobile only) and an SMS code, only while Protected Mode is on. */
  @Post('scan/:code/verify/start')
  @HttpCode(202)
  async verifyStart(
    @Param('code') code: string,
    @Body(new ZodPipe(VerifyStart)) body: z.infer<typeof VerifyStart>,
    @Req() req: FastifyRequest,
  ) {
    if (!(await this.captcha.verify(body.captcha))) throw new BadRequestException(CAPTCHA_FAILED);
    const token = await this.resolve(code, req);
    const refs = await this.scan.scannerRefs(token, context(req));
    await this.verification.start(token, body.phone, body.lang, refs.scannerRef);
    return { ok: true };
  }

  @Post('scan/:code/verify/check')
  @HttpCode(200)
  async verifyCheck(
    @Param('code') code: string,
    @Body(new ZodPipe(VerifyCheck)) body: z.infer<typeof VerifyCheck>,
    @Req() req: FastifyRequest,
  ) {
    const token = await this.resolve(code, req);
    return this.verification.check(token, body.phone, body.code);
  }

  @Post('scan/:code/report-fake')
  @HttpCode(202)
  async reportFake(
    @Param('code') code: string,
    @Body(new ZodPipe(ReportFake)) body: z.infer<typeof ReportFake>,
    @Req() req: FastifyRequest,
  ) {
    if (!(await this.captcha.verify(body.captcha))) throw new BadRequestException(CAPTCHA_FAILED);
    const token = await this.resolve(code, req);
    await this.scan.reportFake(token, body.note, context(req));
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
