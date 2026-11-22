import { Body, Controller, Headers, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import { ipHash, truncateIp } from '../core/ip';
import { ENV } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { StoreSyncService, type RcEvent } from './store-sync.service';

const Prepare = z.object({
  platform: z.enum(['ios', 'android']),
  immediateStartVersion: z.number().int().positive(),
  termsVersion: z.number().int().positive(),
});

/** In-app subscriptions (App Store / Google Play via RevenueCat), docs/billing-unified.md. */
@Controller('v1/billing/store')
@UseGuards(SessionGuard)
export class StoreController {
  constructor(
    @Inject(StoreSyncService) private readonly store: StoreSyncService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Before the store purchase sheet: the checkout gates and the immediate-start consent (A2). */
  @Post('prepare')
  @HttpCode(200)
  prepare(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Prepare)) body: z.infer<typeof Prepare>,
    @Req() req: FastifyRequest,
  ) {
    return this.store.prepare(user, body, ipHash(this.env.SESSION_SECRET, truncateIp(req.ip)));
  }

  /** After a purchase or „Käufe wiederherstellen“: read RevenueCat now instead of waiting. */
  @Post('sync')
  @HttpCode(200)
  async sync(@CurrentUser() user: AuthContext) {
    return { status: await this.store.sync(user.userId) };
  }
}

/** RevenueCat webhook: Authorization header secret, every event id stored once, synced in the worker. */
@Controller('v1/webhooks')
export class RevenueCatWebhookController {
  constructor(@Inject(StoreSyncService) private readonly store: StoreSyncService) {}

  @Post('revenuecat')
  @HttpCode(200)
  async revenuecat(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { event?: RcEvent },
  ) {
    await this.store.receive(authorization, body ?? {});
    return { received: true };
  }
}
