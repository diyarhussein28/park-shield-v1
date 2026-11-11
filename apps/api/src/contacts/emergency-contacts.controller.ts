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
import { CurrentUser, SessionGuard, SkipCsrf } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { ZodPipe } from '../core/zod.pipe';
import { EmergencyContactsService } from './emergency-contacts.service';

const Invite = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.email().max(254),
  vehicleId: z.uuid().nullable().optional(),
  // Shown to the contact in the invitation, so they know who is asking.
  ownerName: z.string().trim().min(1).max(60),
});
const Token = z.object({ token: z.string().min(20).max(100) });
const Decision = Token.extend({ decision: z.enum(['accept', 'decline', 'withdraw']) });

@Controller('v1/emergency-contacts')
@UseGuards(SessionGuard)
export class EmergencyContactsController {
  constructor(
    @Inject(EmergencyContactsService) private readonly contacts: EmergencyContactsService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthContext) {
    return this.contacts.list(user.userId);
  }

  @Post()
  invite(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Invite)) body: z.infer<typeof Invite>,
  ) {
    return this.contacts.invite(user, body);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.contacts.remove(user.userId, id);
    return { ok: true };
  }
}

/** The invited person's side: no account, the link token authenticates (POST keeps it out of URLs). */
@Controller('v1/emergency-contact-invitations')
@SkipCsrf()
export class EmergencyContactInvitationsController {
  constructor(
    @Inject(EmergencyContactsService) private readonly contacts: EmergencyContactsService,
  ) {}

  @Post('view')
  @HttpCode(200)
  view(@Body(new ZodPipe(Token)) body: z.infer<typeof Token>) {
    return this.contacts.invitation(body.token);
  }

  @Post('decide')
  @HttpCode(200)
  decide(@Body(new ZodPipe(Decision)) body: z.infer<typeof Decision>) {
    return this.contacts.decide(body.token, body.decision);
  }
}
