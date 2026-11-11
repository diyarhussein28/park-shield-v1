import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE } from '../auth/cookies';
import { SessionService } from '../auth/session.service';
import { truncateIp } from '../core/ip';
import { ZodPipe } from '../core/zod.pipe';
import { SUPPORT_TOPICS, SupportService } from './support.service';

const Contact = z.object({
  email: z.email().max(254),
  name: z.string().trim().max(80).optional(),
  topic: z.enum(SUPPORT_TOPICS),
  message: z.string().trim().min(10).max(4000),
  captcha: z.string().max(4096).optional(),
  locale: z.enum(['de', 'en']).default('de'),
});

@Controller('v1/support')
export class SupportController {
  constructor(
    @Inject(SupportService) private readonly support: SupportService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  /** Works signed in or not; with a session cookie the CSRF guard applies as everywhere. */
  @Post('contact')
  @HttpCode(201)
  async contact(
    @Body(new ZodPipe(Contact)) body: z.infer<typeof Contact>,
    @Req() req: FastifyRequest,
  ) {
    const auth = await this.sessions.resolve(req.cookies?.[SESSION_COOKIE]);
    return this.support.contact(body, { ipPrefix: truncateIp(req.ip), auth });
  }
}
