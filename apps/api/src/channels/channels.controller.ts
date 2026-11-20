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
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { validTwilioSignature } from '../providers/twilio-signature';
import { twilioSmsWebhookUrl } from '../providers/twilio-sms';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, SessionGuard, SkipCsrf } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import { ENV } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { ORDERABLE } from '../notifications/channel-order';
import { SmsStatusService } from '../notifications/sms-status.service';
import { ChannelsService } from './channels.service';

const PushSubscription = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  label: z.string().max(60).optional(),
});
// NT-07: explicit opt-in before anything is sent by SMS; SMS are service messages only, never advertising.
const SmsStart = z.object({
  phone: z.string().min(5).max(30),
  consent: z.literal(true),
});
const SmsVerify = z.object({ code: z.string().regex(/^\d{6}$/) });
// One number, one code (NT-07). Only SMS since WhatsApp was removed; kept for the portal's phone set-up.
const PhoneStart = z.object({
  phone: z.string().min(5).max(30),
  channels: z.array(z.literal('sms')).min(1).max(1),
  consent: z.literal(true),
});
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

  @Post('channels/sms')
  @HttpCode(200)
  async startSms(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(SmsStart)) body: z.infer<typeof SmsStart>,
  ) {
    const { phone } = await this.channels.startPhone(user, 'sms', body.phone);
    return { phone };
  }

  @Post('channels/sms/verify')
  @HttpCode(200)
  async verifySms(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(SmsVerify)) body: z.infer<typeof SmsVerify>,
  ) {
    await this.channels.verifyPhone(user, body.code);
    return { ok: true };
  }

  @Post('channels/phone')
  @HttpCode(200)
  startPhone(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(PhoneStart)) body: z.infer<typeof PhoneStart>,
  ) {
    return this.channels.startPhone(user, body.channels, body.phone);
  }

  @Post('channels/phone/verify')
  @HttpCode(200)
  verifyPhone(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(SmsVerify)) body: z.infer<typeof SmsVerify>,
  ) {
    return this.channels.verifyPhone(user, body.code);
  }

  @Delete('channels/sms')
  @HttpCode(200)
  async unlinkSms(@CurrentUser() user: AuthContext) {
    await this.channels.unlinkPhone(user.userId, 'sms');
    return { ok: true };
  }
}

/** Twilio SMS status callbacks (NT-04). Every request must carry a valid X-Twilio-Signature. */
@Controller('v1/webhooks')
@SkipCsrf()
export class TwilioWebhookController {
  constructor(
    @Inject(SmsStatusService) private readonly status: SmsStatusService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Replies by SMS are not used: the text links to the alert's view page. */
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
    await this.status.handleTwilio(params);
    return EMPTY_TWIML;
  }
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
