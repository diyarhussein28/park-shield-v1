import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Db } from '../core/core.module';
import { sha256 } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';
import type { RenewalMode } from './rules';

export interface LegalText {
  key: string;
  version: number;
  locale: 'de' | 'en';
  body: string;
  hash: Buffer;
}

/**
 * Versioned legal wording (table legal_texts, append-only). The newest version per key and locale is
 * shown; consents store the version and the SHA-256 of exactly that text. Ops (or a migration) add a
 * new version to change a text without a deploy. TODO [LEGAL REVIEW]: every row is a draft.
 */
@Injectable()
export class LegalTextsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async current(key: string, locale: 'de' | 'en'): Promise<LegalText> {
    const row = await this.db
      .selectFrom('legal_texts')
      .select(['key', 'version', 'locale', 'body', 'sha256'])
      .where('key', '=', key)
      .where('locale', '=', locale)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    if (!row) throw new NotFoundException({ error: 'legal_text_not_found' });
    return { ...row, hash: row.sha256 };
  }

  async version(key: string, locale: 'de' | 'en', version: number): Promise<LegalText | null> {
    const row = await this.db
      .selectFrom('legal_texts')
      .select(['key', 'version', 'locale', 'body', 'sha256'])
      .where('key', '=', key)
      .where('locale', '=', locale)
      .where('version', '=', version)
      .executeTakeFirst();
    return row ? { ...row, hash: row.sha256 } : null;
  }

  /** Adds a new version (ops); the previous ones stay for the consents that refer to them. */
  async publish(key: string, locale: 'de' | 'en', body: string, by: string | null) {
    const latest = await this.db
      .selectFrom('legal_texts')
      .select((eb) => eb.fn.max('version').as('v'))
      .where('key', '=', key)
      .where('locale', '=', locale)
      .executeTakeFirst();
    const version = Number(latest?.v ?? 0) + 1;
    await this.db
      .insertInto('legal_texts')
      .values({ key, locale, version, body, sha256: sha256(body), created_by: by })
      .execute();
    return { key, locale, version };
  }

  async renewalMode(customerType: 'b2c' | 'b2b' = 'b2c'): Promise<RenewalMode> {
    return customerType === 'b2b'
      ? this.settings.get<RenewalMode>('renewal.mode_b2b', 'annual')
      : this.settings.get<RenewalMode>('renewal.mode_b2c', 'annual');
  }

  async withdrawalDays(): Promise<number> {
    return this.settings.get('refunds.withdrawal_days', 14);
  }
}
