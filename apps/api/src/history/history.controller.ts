import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { ZodPipe } from '../core/zod.pipe';
import { ProtectionService } from '../abuse/protection.service';
import { HistoryService, REPORT_REASONS } from './history.service';

const Protection = z.object({ active: z.boolean() });

const Report = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(500).optional(),
});

@Controller('v1')
@UseGuards(SessionGuard)
export class HistoryController {
  constructor(
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(ProtectionService) private readonly protection: ProtectionService,
  ) {}

  @Get('alerts')
  list(@CurrentUser() user: AuthContext) {
    return this.history.list(user.userId);
  }

  @Post('alerts/:id/report')
  @HttpCode(200)
  report(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Report)) body: z.infer<typeof Report>,
  ) {
    return this.history.report(user.userId, id, body.reason, body.note);
  }

  /** Abuse protection §4: hidden content of an unconfirmed sender, shown on request ("Anzeigen"). */
  @Get('alerts/:id/hidden-content')
  hiddenContent(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.history.hiddenContent(user.userId, id);
  }

  @Get('vehicles/:id/protection')
  protectionStatus(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.protection.statusFor(user.userId, id);
  }

  /** Protected Mode on (no end date) or off, at any time (abuse protection §4). */
  @Put('vehicles/:id/protection')
  setProtection(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Protection)) body: z.infer<typeof Protection>,
  ) {
    return this.protection.setManual(user.userId, id, body.active);
  }

  @Get('me/deliveries')
  deliveries(@CurrentUser() user: AuthContext) {
    return this.history.deliveries(user.userId);
  }
}
