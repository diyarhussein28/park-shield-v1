import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { renewalRule } from '@parkshield/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import { ipHash, truncateIp } from '../core/ip';
import { ENV } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { BillingService } from '../billing/billing.service';
import { CancellationsService } from './cancellations.service';
import { LegalTextsService } from './legal-texts.service';
import { WithdrawalsService } from './withdrawals.service';

const locale = z.enum(['de', 'en']).default('de');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((s) => new Date(`${s}T00:00:00Z`));

// § 356a BGB: exactly these fields, never a reason.
const Withdrawal = z.object({
  name: z.string().trim().min(2).max(120),
  contractRef: z.string().trim().min(4).max(254),
  email: z.email().max(254),
  locale,
});

const CancelBase = z.object({
  type: z.enum(['ordinary', 'extraordinary']).default('ordinary'),
  reason: z.string().trim().max(1000).optional(),
  effective: z.enum(['next', 'date']).default('next'),
  date: isoDate.optional(),
  confirmationEmail: z.email().max(254).optional(),
});
const PublicCancel = CancelBase.extend({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  contractNo: z.string().trim().min(4).max(12).optional(),
  plate: z.string().trim().min(2).max(16).optional(),
  locale,
}).refine((b) => b.contractNo || b.plate, { message: 'contract_or_plate' });
const Revoke = z.object({ token: z.string().min(20).max(100) });

const Renew = z.object({
  plan: z.enum(['plus', 'premium']),
  promoCode: z.string().trim().min(1).max(40).optional(),
  immediateStart: z.literal(true),
  immediateStartVersion: z.number().int().positive(),
  termsVersion: z.number().int().positive(),
  stickerStillAttached: z.boolean(),
});

const requestedDate = (b: z.infer<typeof CancelBase>) => {
  if (b.effective !== 'date') return null;
  if (!b.date) throw new BadRequestException({ error: 'date_required' });
  return b.date;
};

/** § 312j / § 312k / § 356a BGB flows, public (rate-limited by IP hash) and in the portal. */
@Controller('v1')
export class LegalController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LegalTextsService) private readonly texts: LegalTextsService,
    @Inject(WithdrawalsService) private readonly withdrawals: WithdrawalsService,
    @Inject(CancellationsService) private readonly cancellations: CancellationsService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  private ip(req: FastifyRequest) {
    return ipHash(this.env.SESSION_SECRET, truncateIp(req.ip));
  }

  /** Renewal rule and withdrawal period in force, for the AGB, the checkout and the e-mails. */
  @Get('legal/context')
  async context() {
    return {
      renewalMode: await this.texts.renewalMode('b2c'),
      withdrawalDays: await this.texts.withdrawalDays(),
    };
  }

  /** The exact texts the checkout shows; their versions come back with the order. */
  @Get('legal/checkout-texts')
  async checkoutTexts(@Query('locale') raw?: string) {
    const l = raw === 'en' ? 'en' : 'de';
    const [immediate, terms, mode] = await Promise.all([
      this.texts.current('checkout.immediate_start', l),
      this.texts.current('checkout.terms_ack', l),
      this.texts.renewalMode('b2c'),
    ]);
    return {
      immediateStart: { version: immediate.version, text: immediate.body },
      terms: { version: terms.version, text: terms.body },
      renewalMode: mode,
      renewalRule: renewalRule(l, { renewalMode: mode }),
    };
  }

  @Post('legal/withdrawals')
  @HttpCode(200)
  async withdraw(
    @Body(new ZodPipe(Withdrawal)) b: z.infer<typeof Withdrawal>,
    @Req() req: FastifyRequest,
  ) {
    const r = await this.withdrawals.submit({
      channel: 'public_form',
      name: b.name,
      contractRef: b.contractRef,
      receiptEmail: b.email,
      locale: b.locale,
      ipHash: this.ip(req),
    });
    return { receivedAt: r.receivedAt };
  }

  @Post('portal/withdrawals')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async withdrawSignedIn(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Withdrawal)) b: z.infer<typeof Withdrawal>,
    @Req() req: FastifyRequest,
  ) {
    const r = await this.withdrawals.submit({
      channel: 'portal',
      userId: user.userId,
      name: b.name,
      contractRef: b.contractRef,
      receiptEmail: b.email,
      locale: b.locale,
      ipHash: this.ip(req),
    });
    return { receivedAt: r.receivedAt };
  }

  @Get('portal/withdrawals/open')
  @UseGuards(SessionGuard)
  async withdrawalOpen(@CurrentUser() user: AuthContext) {
    return { openUntil: await this.withdrawals.openFor(user.userId) };
  }

  /** Same answer whether or not a contract matched; the result goes to the e-mail address. */
  @Post('legal/cancellations')
  @HttpCode(200)
  async cancel(
    @Body(new ZodPipe(PublicCancel)) b: z.infer<typeof PublicCancel>,
    @Req() req: FastifyRequest,
  ) {
    const r = await this.cancellations.submit({
      channel: 'public_form',
      type: b.type,
      reason: b.type === 'extraordinary' ? b.reason : undefined,
      name: b.name,
      email: b.email,
      contractNo: b.contractNo,
      plate: b.contractNo ? undefined : b.plate,
      requestedDate: requestedDate(b),
      confirmationEmail: b.confirmationEmail,
      locale: b.locale,
      ipHash: this.ip(req),
    });
    return { receivedAt: r.receivedAt };
  }

  @Post('portal/cancellations')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async cancelSignedIn(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(CancelBase)) b: z.infer<typeof CancelBase>,
    @Req() req: FastifyRequest,
  ) {
    const r = await this.cancellations.submit({
      channel: 'portal',
      userId: user.userId,
      type: b.type,
      reason: b.type === 'extraordinary' ? b.reason : undefined,
      email: user.email,
      requestedDate: requestedDate(b),
      confirmationEmail: b.confirmationEmail,
      locale: user.preferredLang,
      ipHash: this.ip(req),
    });
    if (!r.matched) throw new BadRequestException({ error: 'no_subscription' });
    return { receivedAt: r.receivedAt, endsAt: r.endsAt, contractNo: r.contractNo };
  }

  @Post('legal/cancellations/revoke')
  @HttpCode(200)
  revoke(@Body(new ZodPipe(Revoke)) b: z.infer<typeof Revoke>) {
    return this.cancellations.revoke(b.token);
  }

  /** Section 4: renew after an ended subscription, answering whether the old sticker is still on. */
  @Post('portal/subscriptions/renew')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  renew(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Renew)) b: z.infer<typeof Renew>,
    @Req() req: FastifyRequest,
  ) {
    return this.billing.checkout(user, b, this.ip(req));
  }
}
