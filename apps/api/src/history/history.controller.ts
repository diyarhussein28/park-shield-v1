import {
  Body,
  Controller,
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
import { HistoryService, REPORT_REASONS } from './history.service';

const Report = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(500).optional(),
});

@Controller('v1')
@UseGuards(SessionGuard)
export class HistoryController {
  constructor(@Inject(HistoryService) private readonly history: HistoryService) {}

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

  @Get('me/deliveries')
  deliveries(@CurrentUser() user: AuthContext) {
    return this.history.deliveries(user.userId);
  }
}
