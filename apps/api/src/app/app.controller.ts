import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { CurrentUser, SessionGuard, SkipCsrf } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { AlertMediaService } from '../alert-media/alert-media.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';
import { truncateIp } from '../core/ip';
import { RateLimitService } from '../core/rate-limit.service';
import { ZodPipe } from '../core/zod.pipe';
import { AckService, OWNER_REPLIES } from '../notifications/ack.service';
import type { Redis } from 'ioredis';
import type { Db } from '../core/core.module';
import { DB, VALKEY } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { AppAlertsService } from './app-alerts.service';
import { DevicesService } from './devices.service';
import { HistoryService } from '../history/history.service';

const MagicLink = z.object({
  email: z.email().max(254),
  locale: z.enum(['de', 'en']).default('de'),
});
const Consume = z.object({
  token: z.string().min(20).max(100),
  platform: z.enum(['ios', 'android']).optional(),
});
const Device = z.object({
  fcmToken: z.string().min(20).max(4096),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().max(20).optional(),
  locale: z.enum(['de', 'en']).optional(),
});
const Ack = z.object({ reply: z.enum(OWNER_REPLIES).default('coming') });
const PushDenied = z.object({ platform: z.enum(['ios', 'android']) });

/** Sign-in for the native app: the session token comes back in the body (Keychain/Keystore), no cookie. */
@Controller('v1/app/auth')
@SkipCsrf()
export class AppAuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Post('magic-link')
  @HttpCode(202)
  async magicLink(
    @Body(new ZodPipe(MagicLink)) body: z.infer<typeof MagicLink>,
    @Req() req: FastifyRequest,
  ) {
    await this.auth.requestMagicLink({ ...body, ipPrefix: truncateIp(req.ip), app: true });
    return { ok: true };
  }

  @Post('consume')
  @HttpCode(200)
  async consume(
    @Body(new ZodPipe(Consume)) body: z.infer<typeof Consume>,
    @Req() req: FastifyRequest,
  ) {
    await this.limits.enforce('auth.ip', truncateIp(req.ip));
    const label = `ParkShield App${body.platform === 'ios' ? ' (iOS)' : body.platform === 'android' ? ' (Android)' : ''}`;
    const session = await this.auth.consumeMagicLink(body.token, label);
    if (!session) throw new UnauthorizedException({ error: 'link_invalid_or_used' });
    return { token: session.token, expiresAt: session.expiresAt };
  }
}

@Controller('v1/app')
@UseGuards(SessionGuard)
export class AppController {
  constructor(
    @Inject(DevicesService) private readonly devices: DevicesService,
    @Inject(AppAlertsService) private readonly alerts: AppAlertsService,
    @Inject(AckService) private readonly ack: AckService,
    @Inject(AlertMediaService) private readonly media: AlertMediaService,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(ChatGateway) private readonly gateway: ChatGateway,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(DB) private readonly db: Db,
    @Inject(HistoryService) private readonly history: HistoryService,
  ) {}

  @Post('devices/register')
  @HttpCode(200)
  register(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Device)) body: z.infer<typeof Device>,
  ) {
    return this.devices.register(user.userId, body);
  }

  /** Called on logout, so a signed-out phone gets no more alerts. */
  @Delete('devices/:token')
  @HttpCode(200)
  async unregister(@CurrentUser() user: AuthContext, @Param('token') token: string) {
    await this.devices.remove(user.userId, token);
    return { ok: true };
  }

  /**
   * The owner denied notifications in the app: an e-mail hint, at most once a day (the app also shows a
   * persistent banner). Valkey keeps the "already told today" marker.
   */
  @Post('push-denied')
  @HttpCode(200)
  async pushDenied(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(PushDenied)) body: z.infer<typeof PushDenied>,
  ) {
    const fresh = await this.valkey.set(`push-denied:${user.userId}`, '1', 'EX', 86_400, 'NX');
    if (fresh) {
      const sms = await this.db
        .selectFrom('contact_channels')
        .select('id')
        .where('user_id', '=', user.userId)
        .where('type', '=', 'sms')
        .where('verified_at', 'is not', null)
        .executeTakeFirst();
      const device =
        user.preferredLang === 'en'
          ? body.platform === 'ios'
            ? 'your iPhone'
            : 'your Android phone'
          : body.platform === 'ios'
            ? 'Ihrem iPhone'
            : 'Ihrem Android-Gerät';
      await this.mail.send({
        to: user.email,
        template: 'push_denied',
        locale: user.preferredLang,
        values: { device, sms: sms ? 'yes' : 'no' },
      });
    }
    return { mailed: Boolean(fresh) };
  }

  @Get('alerts')
  list(@CurrentUser() user: AuthContext, @Query('before') before?: string) {
    const d = before ? new Date(before) : undefined;
    return this.alerts.list(user.userId, d && !Number.isNaN(d.getTime()) ? d : undefined);
  }

  @Get('alerts/:alertId')
  detail(
    @CurrentUser() user: AuthContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Query('reveal') reveal?: string,
  ) {
    return this.alerts.detail(user.userId, alertId, reveal === '1');
  }

  /** "Seen" (≠ acknowledged): the scanner sees „Fahrzeughalter hat die Nachricht gesehen". */
  @Post('alerts/:alertId/seen')
  @HttpCode(200)
  async seen(@CurrentUser() user: AuthContext, @Param('alertId', ParseUUIDPipe) alertId: string) {
    const r = await this.alerts.seen(user.userId, alertId);
    this.gateway.alertChanged(alertId);
    return { seenAt: r.seenAt };
  }

  /** „Ich komme" (button in the app or the action on the push notification). */
  @Post('alerts/:alertId/ack')
  @HttpCode(200)
  async acknowledge(
    @CurrentUser() user: AuthContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Body(new ZodPipe(Ack)) body: z.infer<typeof Ack>,
  ) {
    const r = await this.ack.replyAsOwner(alertId, user.userId, body.reply);
    this.gateway.alertChanged(alertId);
    return r;
  }

  /** „Absender blockieren“ on the alert card, the detail and in the chat (Stage 3). */
  @Post('alerts/:alertId/block')
  @HttpCode(200)
  async block(@CurrentUser() user: AuthContext, @Param('alertId', ParseUUIDPipe) alertId: string) {
    const r = await this.history.block(user.userId, alertId);
    this.gateway.closed(alertId, 'blocked');
    this.gateway.alertChanged(alertId);
    return r;
  }

  /**
   * „Blockierung aufheben“ (2026-11-22): ends the owner's active block of this alert's sender for this
   * vehicle (audited). New alerts from the sender arrive again; the closed chat stays closed.
   * Idempotent; other owners get 404.
   */
  @Post('alerts/:alertId/unblock-sender')
  @HttpCode(200)
  async unblockSender(
    @CurrentUser() user: AuthContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    const r = await this.history.unblock(user.userId, alertId);
    this.gateway.alertChanged(alertId);
    return r;
  }

  /** „Erledigt“: marks the alert resolved; a stop condition for the reminder and the SMS. */
  @Post('alerts/:alertId/resolve')
  @HttpCode(200)
  async resolve(
    @CurrentUser() user: AuthContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    const r = await this.alerts.resolve(user.userId, alertId);
    this.gateway.alertChanged(alertId);
    return r;
  }

  /** A photo, decrypted on the fly and streamed; never cached (the app keeps it in memory only). */
  @Get('alerts/:alertId/media/:mediaId')
  async photo(
    @CurrentUser() user: AuthContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Res() reply: FastifyReply,
  ) {
    const p = await this.media.photoForOwner(user.userId, alertId, mediaId);
    if (!p) throw new NotFoundException({ error: 'not_found' });
    return reply
      .header('content-type', 'image/jpeg')
      .header('content-length', String(p.data.length))
      .header('cache-control', 'no-store')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(p.data);
  }

  /** „Rückfrage stellen / Chat öffnen": only the owner can unlock the chat. */
  @Post('alerts/:alertId/chat/open')
  @HttpCode(200)
  async openChat(
    @CurrentUser() user: AuthContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    const state = await this.chat.open(alertId, user.userId);
    this.gateway.opened(alertId, await this.chat.state(alertId, 'scanner'));
    return state;
  }

  /** „Erledigt / Chat schließen": both sides become read-only. */
  @Post('alerts/:alertId/chat/close')
  @HttpCode(200)
  async closeChat(
    @CurrentUser() user: AuthContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    const closed = await this.chat.close(alertId, 'owner', user.userId);
    if (closed) this.gateway.closed(alertId, 'owner');
    return this.chat.state(alertId, 'owner');
  }
}
