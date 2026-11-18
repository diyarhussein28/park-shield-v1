import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB, ENV } from '../core/tokens';
import { TokensService } from '../vehicles/tokens.service';
import { renderQr, type QrFormat } from './qr';
import { zip } from './zip';

export interface QrFile {
  file: Buffer;
  type: string;
  name: string;
  userId: string;
  vehicleIds: string[];
}

interface VehicleCode {
  vehicleId: string;
  userId: string;
  number: number;
  codeEnc: Buffer | null;
}

/**
 * The decal QR code of a vehicle as a file for printing. Rendered on demand, never stored; the
 * plain code is decrypted only here and never logged. File names and images carry no plate, name
 * or other customer data.
 */
@Injectable()
export class QrExportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Vehicles of a customer with their number (01, 02 … by registration) and active code. */
  async vehicles(
    userId: string,
  ): Promise<{ vehicleId: string; number: number; active: boolean }[]> {
    return (await this.codes(userId)).map((v) => ({
      vehicleId: v.vehicleId,
      number: v.number,
      active: v.codeEnc !== null,
    }));
  }

  async vehicleQr(vehicleId: string, format: QrFormat): Promise<QrFile> {
    const owner = await this.db
      .selectFrom('vehicles')
      .select('owner_user_id')
      .where('id', '=', vehicleId)
      .executeTakeFirst();
    if (!owner?.owner_user_id) throw new NotFoundException({ error: 'vehicle_not_found' });
    const v = (await this.codes(owner.owner_user_id)).find((x) => x.vehicleId === vehicleId);
    if (!v?.codeEnc) throw new NotFoundException({ error: 'no_active_code' });
    const customerNo = await this.customerNo(owner.owner_user_id);
    const { file, type } = await renderQr(await this.input(v.codeEnc), format);
    return {
      file,
      type,
      name: fileName(customerNo, v.number, format),
      userId: v.userId,
      vehicleIds: [vehicleId],
    };
  }

  /** One vehicle with an active code: that file. Several: a ZIP with one file per vehicle. */
  async customerQr(userId: string, format: QrFormat): Promise<QrFile> {
    const active = (await this.codes(userId)).filter((v) => v.codeEnc);
    if (!active.length) throw new NotFoundException({ error: 'no_active_code' });
    const customerNo = await this.customerNo(userId);
    if (active.length === 1) {
      const v = active[0]!;
      const { file, type } = await renderQr(await this.input(v.codeEnc!), format);
      return {
        file,
        type,
        name: fileName(customerNo, v.number, format),
        userId,
        vehicleIds: [v.vehicleId],
      };
    }
    const files = [];
    for (const v of active) {
      const { file } = await renderQr(await this.input(v.codeEnc!), format);
      files.push({ name: fileName(customerNo, v.number, format), data: file });
    }
    return {
      file: zip(files),
      type: 'application/zip',
      name: `${safe(customerNo)}_QR.zip`,
      userId,
      vehicleIds: active.map((v) => v.vehicleId),
    };
  }

  private async input(codeEnc: Buffer) {
    const code = this.tokens.decrypt(codeEnc);
    const url = `${this.env.SCANNER_BASE_URL.replace(/\/$/, '')}/s/${code}`;
    const caption = (await this.settings.get('qr.caption', true))
      ? url.replace(/^https?:\/\//, '')
      : null;
    return { url, caption };
  }

  private async customerNo(userId: string): Promise<string> {
    const u = await this.db
      .selectFrom('users')
      .select('customer_no')
      .where('id', '=', userId)
      .executeTakeFirst();
    return u?.customer_no ?? `PS-${userId.slice(0, 8)}`;
  }

  /** Only codes with tag status "assigned" (on a vehicle, working); revoked codes never. */
  private async codes(userId: string): Promise<VehicleCode[]> {
    const rows = await this.db
      .selectFrom('vehicles as v')
      .leftJoin('qr_tokens as t', (j) =>
        j.onRef('t.vehicle_id', '=', 'v.id').on('t.status', '=', 'assigned'),
      )
      .select(['v.id as vehicleId', 'v.owner_user_id as userId', 't.code_enc as codeEnc'])
      .where('v.owner_user_id', '=', userId)
      .orderBy('v.created_at')
      .orderBy('v.id')
      .execute();
    const seen = new Map<string, VehicleCode>();
    for (const r of rows) {
      if (seen.has(r.vehicleId)) continue;
      seen.set(r.vehicleId, {
        vehicleId: r.vehicleId,
        userId: r.userId!,
        number: seen.size + 1,
        codeEnc: r.codeEnc,
      });
    }
    return [...seen.values()];
  }
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9-]/g, '');

/** e.g. PS-2026-000123_01_QR.svg — no plate in the file name. */
export const fileName = (customerNo: string, n: number, format: QrFormat) =>
  `${safe(customerNo)}_${String(n).padStart(2, '0')}_QR.${format}`;
