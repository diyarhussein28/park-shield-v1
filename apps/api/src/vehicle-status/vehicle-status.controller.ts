import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  STATUS_DEFAULT_DURATION,
  STATUS_DURATIONS,
  STATUS_EXTEND_MINUTES,
  STATUS_PRESETS,
  STATUS_TEXT_MAX,
} from '@parkshield/shared';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { ZodPipe } from '../core/zod.pipe';
import { VehicleStatusService } from './vehicle-status.service';

const durations = STATUS_DURATIONS.map(String) as [string, ...string[]];
const SetStatus = z
  .object({
    presetKey: z.enum(STATUS_PRESETS).optional(),
    // The real check (graphemes, line breaks, contact data) runs in the service; this is the bound.
    customText: z
      .string()
      .max(STATUS_TEXT_MAX * 8)
      .optional(),
    durationMin: z
      .number()
      .int()
      .refine((n) => durations.includes(String(n)), { message: 'duration_invalid' })
      .default(STATUS_DEFAULT_DURATION),
  })
  .refine((b) => (b.presetKey === undefined) !== (b.customText === undefined), {
    message: 'preset_or_text',
  });
const Extend = z.object({
  minutes: z.literal(STATUS_EXTEND_MINUTES).default(STATUS_EXTEND_MINUTES),
});

/** „Bin gleich zurück“ (owner spec 2026-11-26): the owner's endpoints, behind VEHICLE_STATUS_ENABLED. */
@Controller('v1/vehicles/:id/status')
@UseGuards(SessionGuard)
export class VehicleStatusController {
  constructor(@Inject(VehicleStatusService) private readonly status: VehicleStatusService) {}

  /** `enabled` tells the app whether to offer the button at all. */
  @Get()
  async get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    // Ownership is checked first, also while the feature is off (404 for someone else's vehicle).
    const status = await this.status.get(user.userId, id);
    return { enabled: this.status.enabled, status };
  }

  @Put()
  async set(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(SetStatus)) body: z.infer<typeof SetStatus>,
  ) {
    return {
      status: await this.status.set(user.userId, id, {
        presetKey: body.presetKey,
        customText: body.customText,
        durationMin: body.durationMin as 5 | 10 | 15 | 30 | 60,
      }),
    };
  }

  @Post('extend')
  @HttpCode(200)
  async extend(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Extend)) body: z.infer<typeof Extend>,
  ) {
    return { status: await this.status.extend(user.userId, id, body.minutes) };
  }

  @Delete()
  @HttpCode(200)
  async end(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.status.end(user.userId, id);
    return { ok: true };
  }
}
