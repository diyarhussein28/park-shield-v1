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
import { z } from 'zod';
import { CurrentUser, SessionGuard, SkipCsrf } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { ZodPipe } from '../core/zod.pipe';
import { ContactLinkService } from './contact-link.service';
import { EmergencyContactsService } from './emergency-contacts.service';

const Invite = z.object({
  // First name: the contact sees it in the invitation, the owner sees it in the app.
  name: z.string().trim().min(1).max(60),
  // Contacts do not have the app: SMS (PREMIUM) is the main channel, e-mail optional.
  phone: z.string().trim().min(5).max(30),
  email: z.email().max(254).optional(),
  vehicleId: z.uuid().nullable().optional(),
  // Shown to the contact in the invitation, so they know who is asking.
  ownerName: z.string().trim().min(1).max(60),
});
const Order = z.object({ ids: z.array(z.uuid()).min(1).max(3) });
const Escalation = z.object({
  enabled: z.boolean().optional(),
  delayMinutes: z.number().int().min(3).max(30).optional(),
  vehicles: z
    .array(z.object({ id: z.uuid(), enabled: z.boolean().nullable() }))
    .max(20)
    .optional(),
});
const Token = z.object({ token: z.string().min(20).max(100) });
const Decision = Token.extend({ decision: z.enum(['accept', 'decline', 'withdraw']) });

/** The owner's emergency contacts (PREMIUM). Same routes for the web portal and the app. */
@Controller(['v1/emergency-contacts', 'v1/app/emergency-contacts'])
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

  @Put('order')
  reorder(@CurrentUser() user: AuthContext, @Body(new ZodPipe(Order)) body: z.infer<typeof Order>) {
    return this.contacts.reorder(user.userId, body.ids);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.contacts.remove(user.userId, id);
    return { ok: true };
  }
}

/** Escalation on/off (globally, per vehicle) and the delay. PREMIUM; PLUS gets 403 premium_required. */
@Controller(['v1/escalation', 'v1/app/escalation'])
@UseGuards(SessionGuard)
export class EscalationSettingsController {
  constructor(
    @Inject(EmergencyContactsService) private readonly contacts: EmergencyContactsService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthContext) {
    await this.contacts.requirePremium(user.userId);
    return this.contacts.escalationSettings(user.userId);
  }

  @Put()
  save(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Escalation)) body: z.infer<typeof Escalation>,
  ) {
    return this.contacts.saveEscalationSettings(user.userId, body);
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

  @Post('accept')
  @HttpCode(200)
  accept(@Body(new ZodPipe(Token)) body: z.infer<typeof Token>) {
    return this.contacts.decide(body.token, 'accept');
  }

  @Post('decline')
  @HttpCode(200)
  decline(@Body(new ZodPipe(Token)) body: z.infer<typeof Token>) {
    return this.contacts.decide(body.token, 'decline');
  }
}

/**
 * An escalation message's link (/k/<token>): "Ich komme" and opt-out for the emergency contact. The
 * token alone authenticates; POST only, so opening the link (mail scanners) changes nothing.
 */
@Controller('v1/contacts')
@SkipCsrf()
export class ContactLinkController {
  constructor(@Inject(ContactLinkService) private readonly links: ContactLinkService) {}

  @Post('alert/preview')
  @HttpCode(200)
  preview(@Body(new ZodPipe(Token)) body: z.infer<typeof Token>) {
    return this.links.preview(body.token);
  }

  @Post('alert/ack')
  @HttpCode(200)
  ack(@Body(new ZodPipe(Token)) body: z.infer<typeof Token>) {
    return this.links.acknowledge(body.token);
  }

  @Post('opt-out')
  @HttpCode(200)
  optOut(@Body(new ZodPipe(Token)) body: z.infer<typeof Token>) {
    return this.links.optOut(body.token);
  }
}
