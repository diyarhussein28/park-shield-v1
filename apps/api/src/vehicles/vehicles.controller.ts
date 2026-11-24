import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CTA_MAX, DECAL_PRODUCTS, DECAL_TEMPLATES } from '@parkshield/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import { truncateIp } from '../core/ip';
import { RateLimitService } from '../core/rate-limit.service';
import { ENV } from '../core/tokens';
import { ZodPipe } from '../core/zod.pipe';
import { layoutDecal } from '../decal/layout';
import { renderHomePdf } from '../decal/pdf';
import { renderSvg } from '../decal/svg';
import sharp from 'sharp';
import { filterText } from '../moderation/text-filter';
import { VehiclesService } from './vehicles.service';

const plate = z
  .string()
  .trim()
  .min(2)
  .max(12)
  .regex(/^[A-Za-zÄÖÜäöü0-9 -]+$/);
const Vehicle = z.object({
  // Printed on the personalised sticker (Part B): 2–20 characters, basic punctuation, no bad words.
  nickname: z.string().trim().refine(vehicleLabelOk, { message: 'label_invalid' }),
  plate,
  makeModel: z.string().trim().max(80).nullish(),
  color: z.string().trim().max(30).nullish(),
});
const Design = z.object({
  template: z.enum(DECAL_TEMPLATES),
  cta: z.string().trim().min(1).max(CTA_MAX),
});
const Reissue = z.object({
  // "Explicit confirmation" (02-architecture §10): the client must state that the old decal stops working.
  confirm: z.literal(true),
  reason: z.enum(['leaked', 'car_sold', 'damaged', 'other']).default('other'),
});
const Claim = z.object({ code: z.string().trim().min(10).max(16) });
const Preview = Design.partial().extend({
  product: z.enum(DECAL_PRODUCTS).default('uv_vinyl_sticker'),
});

import { vehicleLabelOk } from './vehicle-label';

function checkCta(cta: string | undefined) {
  if (cta === undefined) return;
  const r = filterText(cta);
  if (!r.ok) throw new BadRequestException({ error: 'cta_not_allowed', reason: r.reason });
}

@Controller('v1/vehicles')
@UseGuards(SessionGuard)
export class VehiclesController {
  constructor(
    @Inject(VehiclesService) private readonly vehicles: VehiclesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    return { vehicles: await this.vehicles.list(user.userId) };
  }

  @Post()
  create(
    @CurrentUser() user: AuthContext,
    @Body(new ZodPipe(Vehicle)) body: z.infer<typeof Vehicle>,
  ) {
    return this.vehicles.create(user.userId, body);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.get(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Vehicle.partial())) body: Partial<z.infer<typeof Vehicle>>,
  ) {
    return this.vehicles.update(user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.vehicles.remove(user.userId, id);
    return { ok: true };
  }

  /** „Sperren“: the current code stops working at once; no new code is created (2026-11-21). */
  @Post(':id/tokens/revoke')
  @HttpCode(200)
  revoke(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Reissue)) body: z.infer<typeof Reissue>,
  ) {
    return this.vehicles.revoke(user.userId, id, body.reason);
  }

  /**
   * What „Neuer Code“ offers right now (2026-11-24): free after a „Sperren“ (once per subscription
   * year), else with the 3 € printed sticker; within the cooldown neither, with `nextEligibleAt`.
   */
  @Get(':id/new-code')
  newCode(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.newCodeOptions(user.userId, id);
  }

  /** „Neuen Code erstellen (kostenlos)“: 409 `code_cooldown` / `code_active`, 402 `payment_required`. */
  @Post(':id/tokens')
  createCode(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.createCode(user.userId, id);
  }

  /** AD-07: put a pre-printed partner decal on this vehicle. */
  @Post(':id/claim')
  @HttpCode(200)
  claim(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Claim)) body: z.infer<typeof Claim>,
  ) {
    return this.vehicles.claim(user.userId, id, body.code);
  }

  /** US-12: "Aufkleber testen". */
  @Post(':id/test-window')
  @HttpCode(200)
  async testWindow(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const { until, code } = await this.vehicles.openTestWindow(user.userId, id);
    // The owner's own decal URL, so they can also open the test on this device.
    return { until, scanUrl: `${this.env.SCANNER_BASE_URL}/s/${code}` };
  }

  @Put(':id/decal')
  saveDesign(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Design)) body: z.infer<typeof Design>,
  ) {
    checkCta(body.cta);
    return this.vehicles.saveDesign(user.userId, id, body);
  }

  /** Live preview (OW-03): unsaved template/header from the query, real code of the owner's decal. */
  @Get(':id/decal.svg')
  async preview(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(Preview)) q: z.infer<typeof Preview>,
    @Res() reply: FastifyReply,
  ) {
    checkCta(q.cta);
    const { token, code, vehicle } = await this.vehicles.currentToken(user.userId, id);
    const spec = layoutDecal({
      code,
      scannerBaseUrl: this.env.SCANNER_BASE_URL,
      template: q.template ?? (token.design_template_id as never),
      cta: q.cta ?? token.cta_header,
      product: q.product,
      label: vehicle.nickname,
    });
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(renderSvg(spec, 'ParkShield-Aufkleber'));
  }

  /** Self-printing (free, any time): the decal as SVG file to download. */
  @Get(':id/decal-download.svg')
  async downloadSvg(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    const spec = await this.homeSpec(user.userId, id);
    return reply
      .header('content-type', 'image/svg+xml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="parkshield-aufkleber.svg"')
      .header('cache-control', 'no-store')
      .send(renderSvg(spec, 'ParkShield-Aufkleber'));
  }

  /** Self-printing (free, any time): the decal as PNG, 300 dpi at 80 × 80 mm (945 px). */
  @Get(':id/decal.png')
  async png(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    const spec = await this.homeSpec(user.userId, id);
    const px = Math.round((spec.width / 25.4) * 300);
    const png = await sharp(Buffer.from(renderSvg(spec, 'ParkShield-Aufkleber')), { density: 300 })
      .resize(px, Math.round((spec.height / spec.width) * px))
      .png()
      .toBuffer();
    return reply
      .header('content-type', 'image/png')
      .header('content-disposition', 'attachment; filename="parkshield-aufkleber.png"')
      .header('cache-control', 'no-store')
      .send(png);
  }

  private async homeSpec(userId: string, id: string) {
    const { token, code, vehicle } = await this.vehicles.currentToken(userId, id);
    return layoutDecal({
      code,
      scannerBaseUrl: this.env.SCANNER_BASE_URL,
      template: token.design_template_id as never,
      cta: token.cta_header,
      product: 'uv_vinyl_sticker',
      label: vehicle.nickname,
    });
  }

  /** Free print-at-home PDF at any time (OW-04). */
  @Get(':id/decal.pdf')
  async homePdf(
    @CurrentUser() user: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    const { token, code, vehicle } = await this.vehicles.currentToken(user.userId, id);
    const spec = layoutDecal({
      code,
      scannerBaseUrl: this.env.SCANNER_BASE_URL,
      template: token.design_template_id as never,
      cta: token.cta_header,
      product: 'uv_vinyl_sticker',
      label: vehicle.nickname,
    });
    const pdf = await renderHomePdf(spec, 'ParkShield-Aufkleber', user.preferredLang);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', 'attachment; filename="parkshield-aufkleber.pdf"')
      .header('cache-control', 'no-store')
      .send(pdf);
  }
}

/**
 * "Set up this decal" for a pre-printed partner decal (AD-07): who handed it out and which promo
 * code comes with it. Misses are rate-limited like scans of unknown codes.
 */
@Controller('v1/claim')
export class ClaimController {
  constructor(
    @Inject(VehiclesService) private readonly vehicles: VehiclesService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  @Get(':code')
  async info(@Param('code') code: string, @Req() req: FastifyRequest) {
    const t = await this.vehicles.claimable(code);
    if (!t) {
      await this.limits.enforce('scan.not_found', truncateIp(req.ip));
      throw new NotFoundException({ error: 'code_not_claimable' });
    }
    return { partner: t.partner, promoCode: t.promoCode };
  }
}
