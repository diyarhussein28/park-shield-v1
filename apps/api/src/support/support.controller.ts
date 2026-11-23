import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE } from '../auth/cookies';
import { CurrentUser, SessionGuard } from '../auth/guards';
import { SessionService, type AuthContext } from '../auth/session.service';
import { truncateIp } from '../core/ip';
import { ZodPipe } from '../core/zod.pipe';
import { SUPPORT_TOPICS, SupportService } from './support.service';
import { captchaSolution } from '../providers/captcha';

const Contact = z.object({
  email: z.email().max(254),
  name: z.string().trim().max(80).optional(),
  topic: z.enum(SUPPORT_TOPICS),
  message: z.string().trim().min(10).max(5000),
  captcha: captchaSolution,
  locale: z.enum(['de', 'en']).default('de'),
  /** Which app or website version sent the form (shown to support), e.g. „web“ or „app 1.0.0“. */
  client: z
    .string()
    .trim()
    .max(40)
    .regex(/^[\w .\-+()/]*$/)
    .optional(),
});

/** The in-app contact form: free subject, a reply address (pre-filled, editable) and the message. */
const AppContact = z.object({
  subject: z.string().trim().min(3).max(120),
  email: z.email().max(254),
  message: z.string().trim().min(10).max(5000),
  locale: z.enum(['de', 'en']).default('de'),
  client: Contact.shape.client,
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

/** The app's contact form, signed in with the app session (bearer); the session replaces the captcha. */
@Controller('v1/app/support')
@UseGuards(SessionGuard)
export class AppSupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Post('contact')
  @HttpCode(201)
  contact(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(AppContact)) body: z.infer<typeof AppContact>,
    @Req() req: FastifyRequest,
  ) {
    return this.support.appContact(body, { ipPrefix: truncateIp(req.ip), auth: user });
  }
}
