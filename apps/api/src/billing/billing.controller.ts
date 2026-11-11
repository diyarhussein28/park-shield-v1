import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import type { Db } from '../core/core.module';
import { truncateIp } from '../core/ip';
import { DB, LOGGER } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { PAYMENTS, type Payments } from '../providers/ports';
import { BillingService } from './billing.service';
import { RefundsService } from './refunds.service';

const Checkout = z.object({
  plan: z.enum(['plus', 'premium']),
  promoCode: z.string().trim().min(1).max(40).optional(),
  // §356(4)/§357a BGB: the customer must expressly request the immediate start (US-06).
  immediateStart: z.literal(true),
});
const CancelKind = z.object({
  kind: z.enum(['ordinary', 'extraordinary']).default('ordinary'),
  reason: z.string().trim().max(1000).optional(),
});
const CancelWithoutLogin = CancelKind.extend({
  email: z.email().max(254),
  contractNo: z.string().trim().min(4).max(12),
  captcha: z.string().max(4096).optional(),
  locale: z.enum(['de', 'en']).default('de'),
});

@Controller('v1')
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(RefundsService) private readonly refunds: RefundsService,
  ) {}

  @Get('plans')
  plans() {
    return this.billing.plans();
  }

  @Get('billing/subscription')
  @UseGuards(SessionGuard)
  async subscription(@CurrentUser() user: AuthContext) {
    return { subscription: await this.billing.summary(user.userId) };
  }

  @Post('billing/checkout')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  checkout(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Checkout)) body: z.infer<typeof Checkout>,
  ) {
    return this.billing.checkout(user, body);
  }

  @Post('billing/portal')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  portal(@CurrentUser() user: AuthContext) {
    return this.billing.portal(user.userId);
  }

  @Get('billing/invoices')
  @UseGuards(SessionGuard)
  async invoices(@CurrentUser() user: AuthContext) {
    return { invoices: await this.billing.invoices(user.userId) };
  }

  /** US-40: credit notes (Gutschriften) for refunds, next to the invoices. */
  @Get('billing/credit-notes')
  @UseGuards(SessionGuard)
  async creditNotes(@CurrentUser() user: AuthContext) {
    const rows = await this.refunds.list({ userId: user.userId });
    return {
      creditNotes: rows.map((r) => ({
        id: r.id,
        number: r.creditNoteNo,
        kind: r.kind,
        amountCents: r.refundCents,
        createdAt: r.createdAt,
      })),
    };
  }

  @Get('billing/credit-notes/:id/pdf')
  @UseGuards(SessionGuard)
  async creditNotePdf(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    const { file, number } = await this.refunds.creditNotePdf(id, user.userId);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${number}.pdf"`)
      .header('cache-control', 'no-store')
      .send(file);
  }

  @Post('billing/cancel')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async cancel(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(CancelKind)) body: z.infer<typeof CancelKind>,
  ) {
    const r = await this.billing.cancel(user.userId, body);
    return { receivedAt: r.receivedAt, endsAt: r.endsAt, contractNo: r.contractNo };
  }

  /** Same response whether or not a contract matched; the result goes to the e-mail address. */
  @Post('billing/cancel-request')
  @HttpCode(200)
  async cancelWithoutLogin(
    @Body(new ZodPipe(CancelWithoutLogin)) body: z.infer<typeof CancelWithoutLogin>,
    @Req() req: FastifyRequest,
  ) {
    const r = await this.billing.cancelWithoutLogin({ ...body, ipPrefix: truncateIp(req.ip) });
    return { receivedAt: r.receivedAt };
  }
}

@Controller('v1/webhooks')
export class StripeWebhookController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  async stripe(
    @Req() req: FastifyRequest & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    let event;
    try {
      event = await this.payments.parseWebhook(req.rawBody ?? Buffer.alloc(0), signature);
    } catch {
      await this.failure('invalid_signature');
      throw new BadRequestException({ error: 'invalid_signature' });
    }
    try {
      await this.billing.handle(event);
    } catch (err) {
      this.logger.error({ eventId: event.eventId, err: String(err) }, 'billing event failed');
      await this.failure('handler_error');
      throw new InternalServerErrorException(); // non-2xx makes Stripe retry
    }
    return { received: true };
  }

  /** AD-16: provider health counts webhook failures per day. */
  private async failure(value: string) {
    await this.db
      .insertInto('provider_status_events')
      .values({ provider: 'stripe', metric: 'webhook_failure', value })
      .execute()
      .catch(() => undefined);
  }
}
