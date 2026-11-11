import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { normalizeEmail, randomToken, sha256 } from '../core/crypto';
import { truncateIp } from '../core/ip';
import { RateLimitService } from '../core/rate-limit.service';
import { DB, ENV } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { MailService } from '../mail/mail.service';
import { CAPTCHA, type Captcha } from '../providers/ports';

const Join = z.object({
  companyName: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  fleetSize: z.coerce.number().int().min(1).max(100_000),
  industry: z.string().trim().max(60).optional(),
  captcha: z.string().max(4096).optional(),
  locale: z.enum(['de', 'en']).default('de'),
});
const Confirm = z.object({ token: z.string().min(20).max(100) });

/** Business "coming soon" waitlist with double opt-in (US-04, AD-21). */
@Controller('v1/business-waitlist')
export class WaitlistController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CAPTCHA) private readonly captcha: Captcha,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  @Post()
  @HttpCode(202)
  async join(@Body(new ZodPipe(Join)) body: z.infer<typeof Join>, @Req() req: FastifyRequest) {
    if (!(await this.captcha.verify(body.captcha)))
      throw new BadRequestException({ error: 'captcha_failed' });
    const email = normalizeEmail(body.email);
    await this.limits.enforce('waitlist.ip', truncateIp(req.ip));
    await this.limits.enforce('waitlist.email', sha256(email).toString('hex'));

    const token = randomToken();
    const row = await this.db
      .insertInto('business_waitlist')
      .values({
        company_name: body.companyName,
        contact_email: email,
        fleet_size: body.fleetSize,
        industry: body.industry ?? null,
        confirm_token_hash: sha256(token),
      })
      .onConflict((oc) =>
        oc
          .column('contact_email')
          .doUpdateSet({
            company_name: body.companyName,
            fleet_size: body.fleetSize,
            industry: body.industry ?? null,
            confirm_token_hash: sha256(token),
          })
          .where('business_waitlist.confirmed_at', 'is', null),
      )
      .returning('id')
      .executeTakeFirst();
    if (row) {
      await this.mail.send({
        to: email,
        template: 'waitlist_confirm',
        locale: body.locale,
        values: { company: body.companyName },
        actionUrl: `${this.env.WEB_BASE_URL}/business/bestaetigen#t=${token}`,
      });
    }
    return { ok: true };
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body(new ZodPipe(Confirm)) body: z.infer<typeof Confirm>) {
    const r = await this.db
      .updateTable('business_waitlist')
      .set({ confirmed_at: sql`now()`, confirm_token_hash: null })
      .where('confirm_token_hash', '=', sha256(body.token))
      .where('confirmed_at', 'is', null)
      .executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new BadRequestException({ error: 'link_invalid_or_used' });
    return { ok: true };
  }
}
