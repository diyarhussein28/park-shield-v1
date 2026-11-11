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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { ZodPipe } from '../core/zod.pipe';
import { FairUseService } from '../notifications/fair-use.service';
import { MAX_MODE_MINUTES, PreferencesService } from './preferences.service';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Rule = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  start: time,
  end: time,
  urgentBypass: z.boolean().default(true),
  vehicleId: z.uuid().nullable().optional(),
});
const Mode = z.object({
  mode: z.enum(['sensitive_spot', 'short_stop']),
  minutes: z.number().int().min(15).max(MAX_MODE_MINUTES),
});

@Controller('v1')
@UseGuards(SessionGuard)
export class PreferencesController {
  constructor(
    @Inject(PreferencesService) private readonly prefs: PreferencesService,
    @Inject(FairUseService) private readonly fairUse: FairUseService,
  ) {}

  @Get('quiet-hours')
  rules(@CurrentUser() user: AuthContext) {
    return this.prefs.listRules(user.userId);
  }

  @Post('quiet-hours')
  addRule(@CurrentUser() user: AuthContext, @Body(new ZodPipe(Rule)) body: z.infer<typeof Rule>) {
    return this.prefs.addRule(user.userId, body);
  }

  @Delete('quiet-hours/:id')
  @HttpCode(200)
  async removeRule(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.prefs.removeRule(user.userId, id);
    return { ok: true };
  }

  @Get('vehicles/:id/mode')
  mode(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.prefs.getMode(user.userId, id);
  }

  @Post('vehicles/:id/mode')
  @HttpCode(200)
  startMode(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Mode)) body: z.infer<typeof Mode>,
  ) {
    return this.prefs.startMode(user.userId, id, body.mode, body.minutes);
  }

  @Delete('vehicles/:id/mode')
  @HttpCode(200)
  async endMode(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.prefs.endMode(user.userId, id);
    return { mode: null };
  }

  @Get('me/protection')
  protection(@CurrentUser() user: AuthContext) {
    return this.prefs.protection(user.userId);
  }

  @Get('me/usage')
  usage(@CurrentUser() user: AuthContext) {
    return this.fairUse.usage(user.userId);
  }
}
