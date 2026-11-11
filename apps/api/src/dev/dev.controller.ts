import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { BillingService } from '../billing/billing.service';
import type { Db } from '../core/core.module';
import { DB, VALKEY } from '../core/tokens';
import { OrdersService } from '../orders/orders.service';
import { ZodPipe } from '../core/zod.pipe';
import type { FakePayments, FakeSession } from '../providers/fake-payments';
import { DEV_MAILBOX_KEY } from '../providers/mailer';
import { simplePdf } from '../providers/pdf';
import { PAYMENTS } from '../providers/ports';
import { DEV_TICKETS_KEY } from '../providers/support-desk';
import { DEV_WHATSAPP_KEY } from '../providers/whatsapp';
import { TokensService } from '../vehicles/tokens.service';

export const DEV_PUSH_KEY = 'dev:push';

const Complete = z.object({ sessionId: z.string().startsWith('cs_fake_').max(64) });
const Fail = z.object({ email: z.email(), final: z.boolean().default(false) });
const Ship = z.object({ trackingNumber: z.string().max(64).optional() });

/**
 * Local-only helpers for the fake providers: dev inbox, simulated Stripe checkout, fake invoices.
 * Registered only when at least one provider is faked and NODE_ENV is not production (see apps.ts).
 */
@Controller('v1/dev')
export class DevController {
  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(PAYMENTS) private readonly payments: FakePayments,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get('mailbox')
  async mailbox() {
    const rows = await this.valkey.lrange(DEV_MAILBOX_KEY, 0, 49);
    return { mails: rows.map((r) => JSON.parse(r) as unknown) };
  }

  @Get('whatsapp')
  async whatsappInbox() {
    const rows = await this.valkey.lrange(DEV_WHATSAPP_KEY, 0, 49);
    return { messages: rows.map((r) => JSON.parse(r) as unknown) };
  }

  /** Tickets the contact form created while Zammad is faked (US-44). */
  @Get('zammad/tickets')
  async tickets() {
    const rows = await this.valkey.lrange(DEV_TICKETS_KEY, 0, 49);
    return { tickets: rows.map((r) => JSON.parse(r) as unknown) };
  }

  /** Stands in for reading the printed batch decals (US-39): the unclaimed codes of a batch. */
  @Get('batches/:id/codes')
  async batchCodes(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.db
      .selectFrom('qr_tokens')
      .select('code_enc')
      .where('batch_id', '=', id)
      .where('vehicle_id', 'is', null)
      .orderBy('created_at')
      .execute();
    return { codes: rows.map((r) => this.tokens.decrypt(r.code_enc)) };
  }

  /**
   * A local stand-in for a browser push service: register http://127.0.0.1:4000/v1/dev/push/<name>
   * as an endpoint. Names starting with "gone" answer 410, "fail" answer 500 (NT-06).
   * Only the delivery headers are kept; the body is encrypted for the browser anyway.
   */
  @Post('push/:name')
  async pushReceiver(
    @Param('name') name: string,
    @Headers('urgency') urgency: string | undefined,
    @Headers('ttl') ttl: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const status = name.startsWith('gone') ? 410 : name.startsWith('fail') ? 500 : 201;
    await this.valkey
      .multi()
      .lpush(
        DEV_PUSH_KEY,
        JSON.stringify({
          name: name.slice(0, 40),
          status,
          urgency,
          ttl,
          at: new Date().toISOString(),
        }),
      )
      .ltrim(DEV_PUSH_KEY, 0, 49)
      .exec();
    return reply.status(status).send();
  }

  @Get('push')
  async pushInbox() {
    const rows = await this.valkey.lrange(DEV_PUSH_KEY, 0, 49);
    return { pushes: rows.map((r) => JSON.parse(r) as unknown) };
  }

  private amount(s: FakeSession) {
    return s.kind === 'payment'
      ? Promise.resolve(s.amountCents)
      : this.billing.priceFor(s.plan, s.metadata.promoCodeId);
  }

  @Get('payments/sessions/:id')
  async session(@Param('id') id: string) {
    const s = await this.payments.getSession(id);
    if (!s) throw new NotFoundException();
    return {
      id: s.id,
      title:
        s.kind === 'payment'
          ? s.description
          : `ParkShield ${s.plan === 'plus' ? 'Plus' : 'Premium'}`,
      amountCents: await this.amount(s),
      cancelUrl: s.cancelUrl,
      successUrl: s.successUrl,
    };
  }

  @Post('payments/complete')
  @HttpCode(200)
  async complete(@Body(new ZodPipe(Complete)) body: z.infer<typeof Complete>) {
    const s = await this.payments.getSession(body.sessionId);
    if (!s) throw new NotFoundException();
    const amount = await this.amount(s);
    const event = await this.payments.complete(body.sessionId, amount);
    if (!event) throw new NotFoundException();
    await this.billing.handle(event);
    return { redirectUrl: s.successUrl };
  }

  /** Simulates a failed renewal charge (Stripe invoice.payment_failed). */
  @Post('payments/fail')
  @HttpCode(200)
  async fail(@Body(new ZodPipe(Fail)) body: z.infer<typeof Fail>) {
    const sub = await this.db
      .selectFrom('subscriptions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select('s.stripe_subscription_id')
      .where('u.email', '=', body.email.toLowerCase())
      .where('s.status', 'in', ['active', 'past_due'])
      .executeTakeFirst();
    if (!sub?.stripe_subscription_id) throw new NotFoundException();
    await this.billing.handle({
      kind: 'payment_failed',
      eventId: `evt_fake_fail_${Date.now()}`,
      subscriptionId: sub.stripe_subscription_id,
      attemptCount: body.final ? 4 : 1,
      nextAttemptAt: body.final ? null : new Date(Date.now() + 3 * 86_400_000),
    });
    return { ok: true };
  }

  /** Simulates the print partner's shipping and delivery callbacks. */
  @Post('print/:orderId/ship')
  @HttpCode(200)
  async ship(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodPipe(Ship)) body: z.infer<typeof Ship>,
  ) {
    const ok = await this.orders.markShipped(
      orderId,
      body.trackingNumber ?? `00340434${Date.now()}`,
    );
    if (!ok) throw new NotFoundException();
    return { ok };
  }

  @Post('print/:orderId/deliver')
  @HttpCode(200)
  async deliver(@Param('orderId', ParseUUIDPipe) orderId: string) {
    if (!(await this.orders.markDelivered(orderId))) throw new NotFoundException();
    return { ok: true };
  }

  @Get('payments/invoices/:file')
  async invoice(@Param('file') file: string, @Res() reply: FastifyReply) {
    const invoice = await this.payments.findInvoice(file.replace(/\.pdf$/, ''));
    if (!invoice) throw new NotFoundException();
    const euros = (invoice.totalCents / 100).toFixed(2).replace('.', ',');
    const pdf = simplePdf([
      'ParkShield - Rechnung (lokale Testrechnung)',
      `Rechnungsnummer: ${invoice.number}`,
      `Datum: ${invoice.createdAt.toISOString().slice(0, 10)}`,
      `Betrag: ${euros} EUR inkl. 19 % MwSt.`,
      'Diese Rechnung wurde vom lokalen Test-Zahlungsanbieter erzeugt.',
    ]);
    return reply.header('content-type', 'application/pdf').send(pdf);
  }
}
