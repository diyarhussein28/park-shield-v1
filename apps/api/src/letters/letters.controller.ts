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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/guards';
import type { AuthContext } from '../auth/session.service';
import { ZodPipe } from '../core/zod.pipe';
import { RequirePermission } from '../ops/access';
import { CurrentStaff } from '../ops/staff.guard';
import { StaffService, type StaffContext } from '../ops/staff.service';
import { CompanyService, IMAGE_MAX_BYTES, type CompanyImage } from './company.service';
import { QR_FORMATS, type QrFormat } from './qr';
import { QrExportService } from './qr-export.service';
import { BATCH_MAX, WelcomeLettersService } from './welcome-letters.service';

const STATUSES = ['new', 'downloaded', 'sent'] as const;
const Ids = z.object({ ids: z.array(z.uuid()).min(1).max(BATCH_MAX) });
const MarkSent = z.object({ status: z.literal('sent') });
const CompanyInput = z.object({ data: z.unknown(), version: z.number().int().min(0) });

function send(
  reply: FastifyReply,
  file: Buffer,
  type: string,
  name: string,
  disposition: 'attachment' | 'inline' = 'attachment',
) {
  return reply
    .header('content-type', type)
    .header('content-disposition', `${disposition}; filename="${name}"`)
    .header('cache-control', 'no-store')
    .send(file);
}

const format = (raw: string | undefined): QrFormat => {
  const f = (raw ?? 'svg').toLowerCase();
  if (!(QR_FORMATS as readonly string[]).includes(f)) {
    throw new BadRequestException({ error: 'invalid_format' });
  }
  return f as QrFormat;
};

const letterName = (customerNo: string | null, version: number) =>
  `${(customerNo ?? 'ParkShield').replace(/[^A-Za-z0-9-]/g, '')}_Willkommensbrief_v${version}.pdf`;

/**
 * Welcome letters and decal QR files in the back office. letters.print shows full names,
 * addresses, plates and codes (an audited exception to the masked back office): every list,
 * preview and download writes an audit entry.
 */
@Controller('ops/v1')
export class OpsLettersController {
  constructor(
    @Inject(WelcomeLettersService) private readonly letters: WelcomeLettersService,
    @Inject(QrExportService) private readonly qr: QrExportService,
    @Inject(CompanyService) private readonly company: CompanyService,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  /** Letter versions and QR availability for the customer page (header buttons, section). */
  @Get('customers/:id/welcome-letters')
  @RequirePermission('letters.print')
  async forCustomer(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    const [letters, vehicles] = await Promise.all([
      this.letters.listForCustomer(id),
      this.qr.vehicles(id),
    ]);
    await this.staff.auditRead(me.userId, 'welcome_letter.list', 'users', id);
    return { letters, vehicles };
  }

  @Get('customers/:id/welcome-letter/latest.pdf')
  @RequirePermission('letters.print')
  async latest(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    const letterId = await this.letters.latestId(id);
    if (!letterId) throw new NotFoundException({ error: 'letter_not_found' });
    return this.download(me, letterId, false, reply);
  }

  @Post('customers/:id/welcome-letters')
  @HttpCode(201)
  @RequirePermission('letters.manage')
  async recreate(@CurrentStaff() me: StaffContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.letters.recreate(id, me.userId);
  }

  @Get('customers/:id/qr')
  @RequirePermission('letters.print')
  async customerQr(
    @CurrentStaff() me: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') raw: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.qr.customerQr(id, format(raw));
    await this.staff.auditRead(me.userId, 'qr.download', 'users', id, {
      format: format(raw),
      vehicles: f.vehicleIds,
    });
    return send(reply, f.file, f.type, f.name);
  }

  @Get('vehicles/:vehicleId/qr')
  @RequirePermission('letters.print')
  async vehicleQr(
    @CurrentStaff() me: StaffContext,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Query('format') raw: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.qr.vehicleQr(vehicleId, format(raw));
    await this.staff.auditRead(me.userId, 'qr.download', 'vehicles', vehicleId, {
      format: format(raw),
      userId: f.userId,
    });
    return send(reply, f.file, f.type, f.name);
  }

  /** Overview: the latest letter of every customer, newest first. */
  @Get('welcome-letters')
  @RequirePermission('letters.print')
  async list(@CurrentStaff() me: StaffContext, @Query('status') status: string | undefined) {
    const s = (STATUSES as readonly string[]).includes(status ?? '')
      ? (status as (typeof STATUSES)[number])
      : null;
    const rows = await this.letters.list(s);
    await this.staff.auditRead(me.userId, 'welcome_letter.overview', 'welcome_letters', null, {
      status: s,
      count: rows.length,
    });
    return { letters: rows };
  }

  /** ?inline=1: preview in the browser (no status change); otherwise a download. */
  @Get('welcome-letters/:letterId/pdf')
  @RequirePermission('letters.print')
  async pdf(
    @CurrentStaff() me: StaffContext,
    @Param('letterId', ParseUUIDPipe) letterId: string,
    @Query('inline') inline: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    return this.download(me, letterId, inline === '1', reply);
  }

  @Patch('welcome-letters/:letterId')
  @RequirePermission('letters.print')
  async markSent(
    @CurrentStaff() me: StaffContext,
    @Param('letterId', ParseUUIDPipe) letterId: string,
    @Body(new ZodPipe(MarkSent)) _body: z.infer<typeof MarkSent>,
  ) {
    await this.letters.row(letterId);
    await this.letters.markSent([letterId]);
    await this.staff.audit(me.userId, 'welcome_letter.sent', 'welcome_letters', letterId);
    return this.letters.row(letterId);
  }

  @Post('welcome-letters/sent')
  @HttpCode(200)
  @RequirePermission('letters.print')
  async markSentBatch(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(Ids)) body: z.infer<typeof Ids>,
  ) {
    const updated = await this.letters.markSent(body.ids);
    await this.staff.audit(me.userId, 'welcome_letter.sent', 'welcome_letters', null, {
      ids: body.ids,
    });
    return { updated };
  }

  /** One PDF with the selected letters, each starting on a new page, for printing. */
  @Post('welcome-letters/batch.pdf')
  @HttpCode(200)
  @RequirePermission('letters.print')
  async batch(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(Ids)) body: z.infer<typeof Ids>,
    @Res() reply: FastifyReply,
  ) {
    const { file, rows } = await this.letters.batchPdf(body.ids);
    await this.staff.auditRead(me.userId, 'welcome_letter.download', 'welcome_letters', null, {
      ids: rows.map((r) => r.id),
      customers: rows.map((r) => r.userId),
    });
    const day = new Date().toISOString().slice(0, 10);
    return send(reply, file, 'application/pdf', `Willkommensbriefe_${day}.pdf`);
  }

  @Get('settings/company')
  @RequirePermission('letters.manage')
  async getCompany() {
    const c = await this.company.current();
    return {
      version: c.version,
      data: c.data,
      hasLogo: Boolean(c.logoPng),
      hasSignature: Boolean(c.signaturePng),
      updatedAt: c.createdAt,
    };
  }

  @Get('settings/company/:image.png')
  @RequirePermission('letters.manage')
  async image(@Param('image') image: string, @Res() reply: FastifyReply) {
    const c = await this.company.current();
    const file = image === 'logo' ? c.logoPng : image === 'signature' ? c.signaturePng : null;
    if (!file) throw new NotFoundException();
    return send(reply, file, 'image/png', `${image}.png`, 'inline');
  }

  @Put('settings/company')
  @RequirePermission('letters.manage')
  async putCompany(
    @CurrentStaff() me: StaffContext,
    @Body(new ZodPipe(CompanyInput)) body: z.infer<typeof CompanyInput>,
  ) {
    const saved = await this.company.save(me.userId, body);
    await this.staff.audit(me.userId, 'company.updated', 'company_profiles', null, {
      version: saved.version,
    });
    return this.getCompany();
  }

  /** multipart/form-data: `file` (SVG or PNG, at most 512 KB) and `version` (optimistic lock). */
  @Post('settings/company/images/:kind')
  @HttpCode(200)
  @RequirePermission('letters.manage')
  async upload(
    @CurrentStaff() me: StaffContext,
    @Param('kind') kind: string,
    @Req() req: FastifyRequest,
  ) {
    const k = imageKind(kind);
    let file: Buffer | null = null;
    let version: number | null = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const data = await part.toBuffer();
          if (part.fieldname === 'file') file = data;
        } else if (part.fieldname === 'version') {
          version = Number(part.value);
        }
      }
    } catch {
      throw new BadRequestException({ error: 'image_too_large' });
    }
    if (!file || version === null || !Number.isInteger(version)) {
      throw new BadRequestException({ error: 'invalid_request' });
    }
    const png = await this.company.normaliseImage(file, k);
    const cur = await this.company.current();
    const saved = await this.company.save(me.userId, { data: cur.data, version }, { [k]: png });
    await this.staff.audit(me.userId, `company.${k}_uploaded`, 'company_profiles', null, {
      version: saved.version,
    });
    return this.getCompany();
  }

  @Delete('settings/company/images/:kind')
  @RequirePermission('letters.manage')
  async removeImage(
    @CurrentStaff() me: StaffContext,
    @Param('kind') kind: string,
    @Query('version') version: string,
  ) {
    const k = imageKind(kind);
    const cur = await this.company.current();
    const saved = await this.company.save(
      me.userId,
      { data: cur.data, version: Number(version) },
      { [k]: null },
    );
    await this.staff.audit(me.userId, `company.${k}_removed`, 'company_profiles', null, {
      version: saved.version,
    });
    return this.getCompany();
  }

  private async download(me: StaffContext, letterId: string, inline: boolean, reply: FastifyReply) {
    const { file, row } = await this.letters.pdf(letterId, { download: !inline });
    await this.staff.auditRead(
      me.userId,
      inline ? 'welcome_letter.preview' : 'welcome_letter.download',
      'welcome_letters',
      letterId,
      { userId: row.userId, version: row.version },
    );
    return send(
      reply,
      file,
      'application/pdf',
      letterName(await this.letters.customerNo(row.userId), row.version),
      inline ? 'inline' : 'attachment',
    );
  }
}

function imageKind(kind: string): CompanyImage {
  if (kind !== 'logo' && kind !== 'signature') throw new NotFoundException();
  return kind;
}

export const COMPANY_IMAGE_MULTIPART = {
  limits: { files: 1, fileSize: IMAGE_MAX_BYTES, fields: 2, fieldSize: 64, parts: 3 },
  throwFileSizeLimit: true,
} as const;

/** Customer portal „Dokumente“: the welcome letter, only while welcome_letter.in_portal is on. */
@Controller('v1/portal/documents')
@UseGuards(SessionGuard)
export class PortalDocumentsController {
  constructor(@Inject(WelcomeLettersService) private readonly letters: WelcomeLettersService) {}

  @Get()
  async list(@CurrentUser() user: AuthContext) {
    return { welcomeLetter: await this.letters.portalAvailable(user.userId) };
  }

  @Get('welcome-letter')
  async welcomeLetter(@CurrentUser() user: AuthContext, @Res() reply: FastifyReply) {
    const file = await this.letters.portalPdf(user.userId);
    return send(reply, file, 'application/pdf', 'ParkShield_Willkommensbrief.pdf');
  }
}
