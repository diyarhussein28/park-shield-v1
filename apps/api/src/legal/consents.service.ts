import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Kysely, Transaction } from 'kysely';
import type { Db } from '../core/core.module';
import { DB } from '../core/tokens';
import type { DB as Schema } from '../db/types.generated';
import { LegalTextsService } from './legal-texts.service';

export type ConsentType =
  'immediate_start' | 'agb' | 'privacy_notice' | 'marketing_doi' | 'emergency_contact';

/**
 * Append-only proof of what someone agreed to: the exact text version and its hash, when, in which
 * language and from which (hashed, truncated) network. Never updated; a later decision is a new row.
 */
@Injectable()
export class ConsentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LegalTextsService) private readonly texts: LegalTextsService,
  ) {}

  /** Records consent to the text version the person saw; refuses versions that do not exist. */
  async record(
    input: {
      userId: string | null;
      subscriptionId?: string | null;
      type: ConsentType;
      textKey: string;
      textVersion: number;
      locale: 'de' | 'en';
      accepted: boolean;
      ipHash: Buffer | null;
      source: 'checkout' | 'portal' | 'admin';
    },
    trx: Kysely<Schema> | Transaction<Schema> = this.db,
  ): Promise<string> {
    const text = await this.texts.version(input.textKey, input.locale, input.textVersion);
    if (!text) throw new BadRequestException({ error: 'legal_text_outdated' });
    const row = await trx
      .insertInto('consent_records')
      .values({
        user_id: input.userId,
        subscription_id: input.subscriptionId ?? null,
        type: input.type,
        text_key: input.textKey,
        text_version: input.textVersion,
        text_hash: text.hash,
        locale: input.locale,
        accepted: input.accepted,
        ip_hash: input.ipHash,
        source: input.source,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async get(id: string) {
    return this.db
      .selectFrom('consent_records')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }
}
