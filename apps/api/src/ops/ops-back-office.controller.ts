import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { RefundsService } from '../billing/refunds.service';
import { ZodPipe } from '../core/zod.pipe';
import { Address } from '../orders/orders.controller';
import { RequirePermission, StaffOnly } from './access';
import { AuditStreamService, AuditViewService } from './audit.service';
import { CustomersService } from './customers.service';
import {
  FulfilmentService,
  MAX_BATCH,
  ORDER_FILTERS,
  type OrderFilter,
} from './fulfilment.service';
import { PromoService } from './promo.service';
import { ProviderHealthService } from './provider-health.service';
import { SettingsAdminService } from './settings-admin.service';
import { CurrentStaff } from './staff.guard';
import type { StaffContext } from './staff.service';

function requireAny(me: StaffContext, ...perms: string[]) {
  if (!perms.some((p) => me.permissions.has(p)))
    throw new ForbiddenException({ error: 'permission_missing', missing: [perms[0]] });
}

const pdf = (reply: FastifyReply, file: Buffer, name: string) =>
  reply
    .header('content-type', 'application/pdf')
    .header('content-disposition', `attachment; filename="${name}"`)
    .header('cache-control', 'no-store')
    .send(file);

const Tracking = z.object({ trackingNumber: z.string().trim().min(6).max(64) });
const Note = z.object({ note: z.string().trim().min(3).max(200) });
const Reprint = z.object({
  reason: z.string().trim().min(3).max(200),
  address: Address.optional(),
});

/** US-39: the order pipeline (fulfilment). */
@Controller('ops/v1/orders')
export class OpsOrdersController {
  constructor(@Inject(FulfilmentService) private readonly f: FulfilmentService) {}

  @Get()
  @RequirePermission('orders.manage')
  list(@CurrentStaff() me: StaffContext, @Query('filter') filter = 'open') {
    const ok = (ORDER_FILTERS as readonly string[]).includes(filter);
    return this.f.listOrders(me, ok ? (filter as OrderFilter) : 'open');
  }

  @Get(':id')
  @RequirePermission('orders.manage')
  get(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.f.getOrder(me, id);
  }

  @Post(':id/shipped')
  @HttpCode(200)
  @RequirePermission('orders.manage')
  async shipped(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Tracking)) body: z.infer<typeof Tracking>,
  ) {
    await this.f.markShipped(me, id, body.trackingNumber);
    return { ok: true };
  }

  @Post(':id/delivered')
  @HttpCode(200)
  @RequirePermission('orders.manage')
  async delivered(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.f.markDelivered(me, id);
    return { ok: true };
  }

  @Post(':id/returned')
  @HttpCode(200)
  @RequirePermission('orders.manage')
  async returned(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Note)) body: z.infer<typeof Note>,
  ) {
    await this.f.markReturned(me, id, body.note);
    return { ok: true };
  }

  @Post(':id/reprint')
  @HttpCode(201)
  @RequirePermission('orders.manage')
  reprint(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Reprint)) body: z.infer<typeof Reprint>,
  ) {
    return this.f.reprint(me, id, body);
  }
}

const Partner = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['hausverwaltung', 'driving_school', 'dealer', 'rental', 'insurer', 'other']),
  contactEmail: z.email().max(254).optional().or(z.literal('')),
  commissionPct: z.number().min(0).max(100).default(0),
});
const Active = z.object({ active: z.boolean() });
const Batch = z.object({
  partnerId: z.uuid(),
  promoCodeId: z.uuid().optional(),
  quantity: z.number().int().min(1).max(MAX_BATCH),
  note: z.string().trim().max(200).optional(),
});

/** US-39: partners and pre-printed batches (AD-07). */
@Controller('ops/v1')
export class OpsPartnersController {
  constructor(@Inject(FulfilmentService) private readonly f: FulfilmentService) {}

  /** Fulfilment picks a partner for a batch without being allowed to edit partners. */
  @Get('partners')
  @StaffOnly()
  partners(@CurrentStaff() me: StaffContext) {
    requireAny(me, 'partners.manage', 'tokens.manage');
    return this.f.partners();
  }

  @Post('partners')
  @HttpCode(201)
  @RequirePermission('partners.manage')
  createPartner(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(Partner)) body: z.infer<typeof Partner>,
  ) {
    return this.f.createPartner(me, { ...body, contactEmail: body.contactEmail || undefined });
  }

  @Post('partners/:id/active')
  @HttpCode(200)
  @RequirePermission('partners.manage')
  async partnerActive(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Active)) body: z.infer<typeof Active>,
  ) {
    await this.f.setPartnerActive(me, id, body.active);
    return { ok: true };
  }

  @Get('batches')
  @RequirePermission('tokens.manage')
  batches() {
    return this.f.batches();
  }

  @Post('batches')
  @HttpCode(201)
  @RequirePermission('tokens.manage')
  createBatch(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(Batch)) body: z.infer<typeof Batch>,
  ) {
    return this.f.createBatch(me, body);
  }

  @Get('batches/:id/print.pdf')
  @RequirePermission('tokens.manage')
  async printFile(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    return pdf(
      reply,
      await this.f.batchPrintFile(me, id),
      `parkshield-batch-${id.slice(0, 8)}.pdf`,
    );
  }

  @Post('batches/:id/printed')
  @HttpCode(200)
  @RequirePermission('tokens.manage')
  async printed(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.f.advanceBatch(me, id, 'printed');
    return { ok: true };
  }

  @Post('batches/:id/shipped')
  @HttpCode(200)
  @RequirePermission('tokens.manage')
  async batchShipped(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.f.advanceBatch(me, id, 'shipped');
    return { ok: true };
  }
}

const RefundTarget = z.union([
  z.object({ kind: z.enum(['withdrawal', 'proration']), subscriptionId: z.uuid() }),
  z.object({
    kind: z.literal('goodwill'),
    subscriptionId: z.uuid(),
    amountCents: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal('goodwill'),
    orderId: z.uuid(),
    amountCents: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('decal_defect'), orderId: z.uuid() }),
]);
const Refund = z.object({ refund: RefundTarget, reason: z.string().trim().min(10).max(300) });

/** US-40 / AD-12: withdrawal and refund tool (billing.refund). */
@Controller('ops/v1/refunds')
export class OpsRefundsController {
  constructor(@Inject(RefundsService) private readonly refunds: RefundsService) {}

  @Get()
  @RequirePermission('billing.refund')
  async list(@Query('subscriptionId') subscriptionId?: string, @Query('orderId') orderId?: string) {
    const uuid = z.uuid();
    return {
      refunds: await this.refunds.list({
        subscriptionId:
          subscriptionId && uuid.safeParse(subscriptionId).success ? subscriptionId : undefined,
        orderId: orderId && uuid.safeParse(orderId).success ? orderId : undefined,
      }),
    };
  }

  @Post('quote')
  @HttpCode(200)
  @RequirePermission('billing.refund')
  quote(@Body(new ZodPipe(RefundTarget)) body: z.infer<typeof RefundTarget>) {
    return this.refunds.quote(body);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('billing.refund')
  execute(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(Refund)) body: z.infer<typeof Refund>,
  ) {
    return this.refunds.execute(me.userId, body.refund, body.reason);
  }

  @Get(':id/credit-note.pdf')
  @RequirePermission('billing.refund')
  async creditNote(@Param('id', ParseUUIDPipe) id: string, @Res() reply: FastifyReply) {
    const { file, number } = await this.refunds.creditNotePdf(id);
    return pdf(reply, file, `${number}.pdf`);
  }
}

const Promo = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,40}$/),
  kind: z.enum(['percent_off', 'amount_off', 'extra_months']),
  value: z.number().int().min(1).max(100_000),
  appliesTo: z.array(z.enum(['plus', 'premium'])).optional(),
  priceLockMonths: z.number().int().min(1).max(120).nullish(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullish(),
  validUntil: z.coerce.date().nullish(),
  partnerId: z.uuid().nullish(),
});

/** US-40 / AD-13: promo codes (promo.manage); fulfilment sees the list to link a batch. */
@Controller('ops/v1/promo-codes')
export class OpsPromoController {
  constructor(@Inject(PromoService) private readonly promos: PromoService) {}

  @Get()
  @StaffOnly()
  list(@CurrentStaff() me: StaffContext) {
    requireAny(me, 'promo.manage', 'tokens.manage');
    return this.promos.list();
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('promo.manage')
  create(@CurrentStaff() me: StaffContext, @Body(new ZodPipe(Promo)) body: z.infer<typeof Promo>) {
    return this.promos.create(me, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('promo.manage')
  async deactivate(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.promos.deactivate(me, id);
    return { ok: true };
  }
}

const SettingUpdate = z.object({
  value: z.unknown(),
  version: z.number().int().min(0),
  reason: z.string().trim().max(200).optional(),
});
const AlertTypeUpdate = z.object({
  active: z.boolean().optional(),
  severity: z.enum(['info', 'normal', 'urgent']).optional(),
  escalates: z.boolean().optional(),
  labelDe: z.string().trim().min(2).max(80).optional(),
  labelEn: z.string().trim().min(2).max(80).optional(),
});

/** US-41: settings, kill switches and provider health (settings.edit). */
@Controller('ops/v1')
export class OpsSettingsController {
  constructor(
    @Inject(SettingsAdminService) private readonly settings: SettingsAdminService,
    @Inject(ProviderHealthService) private readonly health: ProviderHealthService,
  ) {}

  @Get('settings')
  @RequirePermission('settings.edit')
  list() {
    return this.settings.list();
  }

  @Put('settings/:key')
  @RequirePermission('settings.edit')
  update(
    @CurrentStaff() me: StaffContext,
    @Param('key') key: string,
    @Body(new ZodPipe(SettingUpdate)) body: z.infer<typeof SettingUpdate>,
  ) {
    return this.settings.update(me, key, body);
  }

  @Get('settings/:key/history')
  @RequirePermission('settings.edit')
  history(@Param('key') key: string) {
    return this.settings.history(key);
  }

  @Patch('alert-types/:code')
  @RequirePermission('settings.edit')
  async alertType(
    @CurrentStaff() me: StaffContext,
    @Param('code') code: string,
    @Body(new ZodPipe(AlertTypeUpdate)) body: z.infer<typeof AlertTypeUpdate>,
  ) {
    await this.settings.updateAlertType(me, code, body);
    return { ok: true };
  }

  @Get('providers/health')
  @RequirePermission('settings.edit')
  async providerHealth() {
    return { checks: await this.health.checks() };
  }
}

/** US-42: the audit trail and the state of its copy in the locked bucket (audit.read). */
@Controller('ops/v1/audit')
export class OpsAuditController {
  constructor(
    @Inject(AuditViewService) private readonly view: AuditViewService,
    @Inject(AuditStreamService) private readonly stream: AuditStreamService,
  ) {}

  @Get()
  @RequirePermission('audit.read')
  list(
    @CurrentStaff() me: StaffContext,
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('before') before?: string,
    @Query('reads') reads?: string,
  ) {
    return this.view.list(me, {
      action: action?.slice(0, 64) || undefined,
      entity: entity?.slice(0, 40) || undefined,
      entityId: entityId && z.uuid().safeParse(entityId).success ? entityId : undefined,
      before: before && /^\d{1,18}$/.test(before) ? before : undefined,
      reads: reads === 'false' ? false : undefined,
    });
  }

  @Post('verify')
  @HttpCode(200)
  @RequirePermission('audit.read')
  verify() {
    return this.stream.verify();
  }
}

/** AD-20: summary for the Zammad ticket sidebar link. */
@Controller('ops/v1/customers')
export class OpsCustomerSummaryController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get('summary')
  @RequirePermission('customer.read_masked')
  summary(@CurrentStaff() me: StaffContext, @Query('email') email = '') {
    if (!z.email().safeParse(email.trim()).success) return { found: false };
    return this.customers.summary(me, email);
  }
}
