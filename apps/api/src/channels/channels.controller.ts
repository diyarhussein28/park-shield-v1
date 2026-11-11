import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { twilioWebhookUrl, validTwilioSignature } from '../providers/twilio-whatsapp';
import { twilioSmsWebhookUrl } from '../providers/twilio-sms';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, SessionGuard, SkipCsrf } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import { ENV } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { ORDERABLE } from '../notifications/channel-order';
import { WhatsAppWebhookService } from '../notifications/whatsapp-webhook.service';
import { ChannelsService } from './channels.service';

const PushSubscription = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  label: z.string().max(60).optional(),
});
const WhatsAppStart = z.object({
  phone: z.string().min(5).max(30),
  // Explicit opt-in before anything is sent over WhatsApp (US-21, §7 UWG not affected: service messages).
  consent: z.literal(true),
});
const WhatsAppVerify = z.object({ code: z.string().regex(/^\d{6}$/) });
// NT-07: same opt-in as WhatsApp; SMS are service messages only, never advertising.
const SmsStart = WhatsAppStart;
const SmsVerify = WhatsAppVerify;
const ChannelOrder = z.object({ order: z.array(z.enum(ORDERABLE)).length(ORDERABLE.length) });

@Controller('v1')
@UseGuards(SessionGuard)
export class ChannelsController {
  constructor(@Inject(ChannelsService) private readonly channels: ChannelsService) {}

  @Get('channels')
  overview(@CurrentUser() user: AuthContext) {
    return this.channels.overview(user);
  }

  @Put('channels/order')
  async saveOrder(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(ChannelOrder)) body: z.infer<typeof ChannelOrder>,
  ) {
    return { order: await this.channels.saveOrder(user.userId, body.order) };
  }

  @Post('push-subscriptions')
  register(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(PushSubscription)) body: z.infer<typeof PushSubscription>,
    @Req() req: FastifyRequest,
  ) {
    return this.channels.registerPush(
      user.userId,
      {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        label: body.label,
      },
      req.headers['user-agent'],
    );
  }

  @Delete('push-subscriptions/:id')
  @HttpCode(200)
  async removePush(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.channels.removePush(user.userId, id);
    return { ok: true };
  }

  @Post('channels/whatsapp')
  @HttpCode(200)
  startWhatsApp(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(WhatsAppStart)) body: z.infer<typeof WhatsAppStart>,
  ) {
    return this.channels.startWhatsApp(user, body.phone);
  }

  @Post('channels/whatsapp/verify')
  @HttpCode(200)
  async verifyWhatsApp(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(WhatsAppVerify)) body: z.infer<typeof WhatsAppVerify>,
  ) {
    await this.channels.verifyWhatsApp(user, body.code);
    return { ok: true };
  }

  @Delete('channels/whatsapp')
  @HttpCode(200)
  async unlinkWhatsApp(@CurrentUser() user: AuthContext) {
    await this.channels.unlinkWhatsApp(user.userId);
    return { ok: true };
  }

  @Post('channels/sms')
  @HttpCode(200)
  startSms(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(SmsStart)) body: z.infer<typeof SmsStart>,
  ) {
    return this.channels.startPhone(user, 'sms', body.phone);
  }

  @Post('channels/sms/verify')
  @HttpCode(200)
  async verifySms(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(SmsVerify)) body: z.infer<typeof SmsVerify>,
  ) {
    await this.channels.verifyPhone(user, 'sms', body.code);
    return { ok: true };
  }

  @Delete('channels/sms')
  @HttpCode(200)
  async unlinkSms(@CurrentUser() user: AuthContext) {
    await this.channels.unlinkPhone(user.userId, 'sms');
    return { ok: true };
  }
}

/** Delivery statuses from 360dialog (Meta Cloud API format). The path carries a shared secret. */
@Controller('v1/webhooks')
@SkipCsrf()
export class WhatsAppWebhookController {
  constructor(
    @Inject(WhatsAppWebhookService) private readonly webhook: WhatsAppWebhookService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('whatsapp/:secret')
  @HttpCode(200)
  async receive(@Param('secret') secret: string, @Body() body: unknown) {
    // Constant-time comparison of SHA-256 digests (equal length, no timing leak; ASVS 6.2.x).
    const expected = this.env.D360_WEBHOOK_SECRET;
    if (
      !expected ||
      !timingSafeEqual(
        createHash('sha256').update(secret).digest(),
        createHash('sha256').update(expected).digest(),
      )
    )
      throw new NotFoundException();
    await this.webhook.handle(body);
    return { received: true };
  }
}

/**
 * Twilio WhatsApp: status callbacks and quick-reply taps (both form-encoded) on one URL. Every request
 * must carry a valid X-Twilio-Signature (HMAC-SHA1 with the auth token over URL + parameters).
 */
@Controller('v1/webhooks')
@SkipCsrf()
export class TwilioWebhookController {
  constructor(
    @Inject(WhatsAppWebhookService) private readonly webhook: WhatsAppWebhookService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('twilio/whatsapp')
  @HttpCode(200)
  @Header('content-type', 'text/xml; charset=utf-8')
  async receive(
    @Body() body: unknown,
    @Headers('x-twilio-signature') signature: string | undefined,
  ) {
    const params = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (
      !validTwilioSignature(
        this.env.TWILIO_AUTH_TOKEN,
        twilioWebhookUrl(this.env),
        params,
        signature,
      )
    )
      throw new ForbiddenException();
    await this.webhook.handleTwilio(params);
    // Empty TwiML: acknowledge without sending an automatic reply to the owner.
    return EMPTY_TWIML;
  }

  /** SMS status callbacks (NT-04). Replies by SMS are not used: the text links to the reply page. */
  @Post('twilio/sms')
  @HttpCode(200)
  @Header('content-type', 'text/xml; charset=utf-8')
  async receiveSms(
    @Body() body: unknown,
    @Headers('x-twilio-signature') signature: string | undefined,
  ) {
    const params = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (
      !validTwilioSignature(
        this.env.TWILIO_AUTH_TOKEN,
        twilioSmsWebhookUrl(this.env),
        params,
        signature,
      )
    )
      throw new ForbiddenException();
    await this.webhook.handleTwilio(params, 'sms');
    return EMPTY_TWIML;
  }
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
