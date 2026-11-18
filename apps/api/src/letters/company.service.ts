import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';
import { CompanyData, DEFAULT_COMPANY } from './company';

export interface CompanyProfile {
  /** 0: the built-in defaults (nothing saved yet). */
  version: number;
  data: CompanyData;
  logoPng: Buffer | null;
  signaturePng: Buffer | null;
  createdAt: Date | null;
}

export type CompanyImage = 'logo' | 'signature';
export const IMAGE_MAX_BYTES = 512 * 1024;

/** Versioned company data for letters. Saving never changes a version a letter already used. */
@Injectable()
export class CompanyService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async current(): Promise<CompanyProfile> {
    const row = await this.db
      .selectFrom('company_profiles')
      .selectAll()
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row ? this.toProfile(row) : this.defaults();
  }

  /** The exact version a letter was created with (for its logo and signature). */
  async version(version: number): Promise<CompanyProfile> {
    if (version === 0) return this.defaults();
    const row = await this.db
      .selectFrom('company_profiles')
      .selectAll()
      .where('version', '=', version)
      .executeTakeFirst();
    return row ? this.toProfile(row) : this.defaults();
  }

  /** Optimistic: the editor sends the version it saw; images carry over unless replaced. */
  async save(
    staffId: string,
    input: { data: unknown; version: number },
    images: Partial<Record<CompanyImage, Buffer | null>> = {},
  ): Promise<CompanyProfile> {
    const parsed = CompanyData.safeParse(input.data);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'invalid_company', issues: parsed.error.issues });
    }
    const cur = await this.current();
    if (cur.version !== input.version) throw new ConflictException({ error: 'version_conflict' });
    const row = await this.db
      .insertInto('company_profiles')
      .values({
        version: cur.version + 1,
        data: JSON.stringify(parsed.data),
        logo_png: images.logo !== undefined ? images.logo : cur.logoPng,
        signature_png: images.signature !== undefined ? images.signature : cur.signaturePng,
        created_by: staffId,
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException({ error: 'version_conflict' });
    return this.toProfile(row);
  }

  /** SVG or PNG in, a PNG without metadata out (pdfkit draws PNG; SVG is rasterised sharply). */
  async normaliseImage(file: Buffer, kind: CompanyImage): Promise<Buffer> {
    if (file.length > IMAGE_MAX_BYTES) throw new BadRequestException({ error: 'image_too_large' });
    const head = file.subarray(0, 512).toString('utf8');
    const isPng = file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isSvg = /<svg[\s>]/i.test(head) || /<svg[\s>]/i.test(file.toString('utf8', 0, 4096));
    if (!isPng && !isSvg) throw new BadRequestException({ error: 'image_type' });
    try {
      // Scripts or external references in an SVG are never executed: librsvg only rasterises.
      return await sharp(file, { density: isSvg ? 300 : undefined, limitInputPixels: 25e6 })
        .resize({
          width: kind === 'logo' ? 1200 : 900,
          height: 400,
          fit: 'inside',
          withoutEnlargement: !isSvg,
        })
        .png()
        .toBuffer();
    } catch {
      throw new BadRequestException({ error: 'image_unreadable' });
    }
  }

  private defaults(): CompanyProfile {
    return {
      version: 0,
      data: DEFAULT_COMPANY,
      logoPng: null,
      signaturePng: null,
      createdAt: null,
    };
  }

  private toProfile(row: {
    version: number;
    data: unknown;
    logo_png: Buffer | null;
    signature_png: Buffer | null;
    created_at: Date;
  }): CompanyProfile {
    // Older versions may lack fields added later: defaults fill the gaps.
    const raw = row.data as Partial<CompanyData>;
    const data = CompanyData.parse({
      ...DEFAULT_COMPANY,
      ...raw,
      footer: { ...DEFAULT_COMPANY.footer, ...raw.footer },
      texts: { ...DEFAULT_COMPANY.texts, ...raw.texts },
    });
    return {
      version: row.version,
      data,
      logoPng: row.logo_png,
      signaturePng: row.signature_png,
      createdAt: row.created_at,
    };
  }
}
