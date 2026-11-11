import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../core/zod.pipe';
import { WordListsService } from '../moderation/word-lists.service';
import { AbuseService } from './abuse.service';
import { RequirePermission, StaffOnly } from './access';
import { BreakGlassService, TARGETS, type Target } from './break-glass.service';
import { CustomersService } from './customers.service';
import { DsrService } from './dsr.service';
import { CurrentStaff } from './staff.guard';
import type { StaffContext } from './staff.service';

/** US-35: Customer 360 and the delivery trace. */
@Controller('ops/v1')
export class OpsCustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get('customers')
  @RequirePermission('customer.read_masked')
  search(@CurrentStaff() me: StaffContext, @Query('q') q = '') {
    return this.customers.search(me, q);
  }

  @Get('customers/:id')
  @RequirePermission('customer.read_masked')
  view(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.view(me, id);
  }

  @Get('alerts/:id/trace')
  @RequirePermission('alerts.read_metadata')
  trace(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.customers.trace(me, id);
  }
}

const BgRequest = z.object({
  target: z.enum(Object.keys(TARGETS) as [Target, ...Target[]]),
  targetId: z.uuid(),
  reason: z.string().trim().min(10).max(300),
  ticketRef: z.string().trim().min(3).max(40),
  notifyCustomer: z.boolean().default(true),
});

/** US-36: four-eyes break-glass decryption. */
@Controller('ops/v1/break-glass')
export class OpsBreakGlassController {
  constructor(@Inject(BreakGlassService) private readonly bg: BreakGlassService) {}

  /** Requesters see their own requests, approvers the open ones of others: either permission. */
  @Get()
  @StaffOnly()
  list(@CurrentStaff() me: StaffContext) {
    if (!me.permissions.has('pii.decrypt_request') && !me.permissions.has('pii.decrypt_approve')) {
      throw new ForbiddenException({
        error: 'permission_missing',
        missing: ['pii.decrypt_request'],
      });
    }
    return this.bg.list(me);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('pii.decrypt_request')
  request(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(BgRequest)) body: z.infer<typeof BgRequest>,
  ) {
    return this.bg.request(me, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('pii.decrypt_approve')
  async approve(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.bg.decide(me, id, true);
    return { ok: true };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('pii.decrypt_approve')
  async reject(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.bg.decide(me, id, false);
    return { ok: true };
  }

  @Post(':id/reveal')
  @HttpCode(200)
  @RequirePermission('pii.decrypt_request')
  reveal(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bg.reveal(me, id);
  }
}

const DsrCreate = z.object({
  type: z.enum(['access_export', 'erasure', 'rectification', 'restriction', 'objection']),
  email: z.email().max(254),
  note: z.string().max(500).optional(),
});
const Email = z.object({ email: z.email().max(254) });
const Note = z.object({ note: z.string().trim().min(5).max(500) });
const StepUpdate = z.object({
  status: z.enum(['done', 'not_applicable']),
  evidence: z.string().trim().min(3).max(200),
});

/** US-37: GDPR request queue. */
@Controller('ops/v1/dsr')
export class OpsDsrController {
  constructor(@Inject(DsrService) private readonly dsr: DsrService) {}

  @Get()
  @RequirePermission('dsr.process')
  list() {
    return this.dsr.list();
  }

  @Get(':id')
  @RequirePermission('dsr.process')
  get(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dsr.get(me, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('dsr.process')
  create(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(DsrCreate)) body: z.infer<typeof DsrCreate>,
  ) {
    return this.dsr.create(me, body);
  }

  @Post(':id/resend')
  @HttpCode(200)
  @RequirePermission('dsr.process')
  async resend(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Email)) body: z.infer<typeof Email>,
  ) {
    await this.dsr.resend(me, id, body.email);
    return { ok: true };
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('dsr.process')
  async verify(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Note)) body: z.infer<typeof Note>,
  ) {
    await this.dsr.verifyManually(me, id, body.note);
    return { ok: true };
  }

  @Post(':id/steps/:processor')
  @HttpCode(200)
  @RequirePermission('dsr.process')
  async step(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('processor') processor: string,
    @Body(new ZodPipe(StepUpdate)) body: z.infer<typeof StepUpdate>,
  ) {
    await this.dsr.setStep(me, id, processor, body.status, body.evidence);
    return { ok: true };
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('dsr.process')
  async close(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.dsr.close(me, id);
    return { ok: true };
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermission('dsr.process')
  async reject(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Note)) body: z.infer<typeof Note>,
  ) {
    await this.dsr.reject(me, id, body.note);
    return { ok: true };
  }
}

const ReportStatus = z.object({ status: z.enum(['actioned', 'dismissed']) });
const Block = z.object({
  ref: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().min(3).max(40),
});
const Unblock = z.object({
  ref: z.string().regex(/^[0-9a-f]{64}$/),
  tokenId: z.uuid().nullable().default(null),
});
const Revoke = z.object({ reason: z.string().trim().min(3).max(100) });
const Review = z.object({ decision: z.enum(['correct_block', 'false_positive', 'unclear']) });
const Words = z.object({
  words: z.object({
    insults: z.object({
      de: z.array(z.string().max(40)).max(1000),
      en: z.array(z.string().max(40)).max(1000),
    }),
    threats: z.object({
      de: z.array(z.string().max(40)).max(1000),
      en: z.array(z.string().max(40)).max(1000),
    }),
  }),
  note: z.string().trim().min(3).max(200),
});

/** US-38: abuse centre, block review and word lists. */
@Controller('ops/v1/abuse')
export class OpsAbuseController {
  constructor(
    @Inject(AbuseService) private readonly abuse: AbuseService,
    @Inject(WordListsService) private readonly words: WordListsService,
  ) {}

  @Get('patterns')
  @RequirePermission('abuse.moderate')
  patterns() {
    return this.abuse.patterns();
  }

  @Get('reports')
  @RequirePermission('abuse.moderate')
  reports(@Query('status') status = 'open') {
    return this.abuse.reports(status === 'actioned' || status === 'dismissed' ? status : 'open');
  }

  @Post('reports/:id')
  @HttpCode(200)
  @RequirePermission('abuse.moderate')
  async handle(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ReportStatus)) body: z.infer<typeof ReportStatus>,
  ) {
    await this.abuse.handleReport(me, id, body.status);
    return { ok: true };
  }

  @Get('blocks')
  @RequirePermission('abuse.moderate')
  blocks() {
    return this.abuse.blocks();
  }

  @Post('blocks')
  @HttpCode(201)
  @RequirePermission('abuse.moderate')
  block(@CurrentStaff() me: StaffContext, @Body(new ZodPipe(Block)) body: z.infer<typeof Block>) {
    return this.abuse.blockGlobally(me, body.ref, body.reason);
  }

  @Delete('blocks')
  @HttpCode(200)
  @RequirePermission('abuse.moderate')
  async unblock(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(Unblock)) body: z.infer<typeof Unblock>,
  ) {
    await this.abuse.unblock(me, body.ref, body.tokenId);
    return { ok: true };
  }

  @Post('tokens/:id/revoke')
  @HttpCode(200)
  @RequirePermission('abuse.moderate', 'tokens.manage')
  async revoke(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Revoke)) body: z.infer<typeof Revoke>,
  ) {
    await this.abuse.revokeOnBehalf(me, id, body.reason);
    return { ok: true };
  }

  @Get('reviews')
  @RequirePermission('moderation.review')
  reviews(@CurrentStaff() me: StaffContext) {
    return this.abuse.reviewQueue(me);
  }

  @Post('reviews/:id')
  @HttpCode(200)
  @RequirePermission('moderation.review')
  async review(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Review)) body: z.infer<typeof Review>,
  ) {
    await this.abuse.decideReview(me, id, body.decision);
    return { ok: true };
  }

  @Get('word-lists')
  @RequirePermission('abuse.moderate')
  async wordLists() {
    return { versions: await this.words.versions() };
  }

  @Post('word-lists')
  @HttpCode(201)
  @RequirePermission('abuse.moderate')
  async publish(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(Words)) body: z.infer<typeof Words>,
  ) {
    return { version: await this.words.publish(me.userId, body.words, body.note) };
  }

  @Post('word-lists/:version/rollback')
  @HttpCode(201)
  @RequirePermission('abuse.moderate')
  async rollback(
    @CurrentStaff() me: StaffContext,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return { version: await this.words.rollback(me.userId, version) };
  }
}
