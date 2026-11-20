import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB } from '../core/tokens';
import type { ProfileSource } from '../db/types.generated';
import type { PostalAddress } from '../providers/ports';

/** Letters, digits, spaces and the punctuation real names and addresses use; never < or >. */
const plain = (min: number, max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .regex(/^[^<>{}\\[\]`$|^~@#%*=+;]*$/u, 'invalid_characters')
        .regex(/\p{L}/u, 'needs_letter'),
    );

/**
 * The sign-up data (owner decisions 2026-11-20): name and postal address are required, the mobile
 * number is optional and set up separately (verified SMS channel). Germany is the default country;
 * a German postcode has exactly five digits.
 */
export const ProfileInput = z
  .object({
    firstName: plain(1, 60),
    lastName: plain(1, 60),
    street: plain(3, 100),
    postalCode: z.string().trim().max(10),
    city: plain(1, 60),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .default('DE'),
  })
  .superRefine((v, ctx) => {
    const ok =
      v.country === 'DE'
        ? // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored, fixed length 5, input ≤ 10 chars
          /^\d{5}$/.test(v.postalCode)
        : // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored single class, ≤ 10 chars, linear
          /^[A-Za-z0-9 -]{3,10}$/.test(v.postalCode);
    if (!ok) ctx.addIssue({ code: 'custom', path: ['postalCode'], message: 'postal_code_invalid' });
  });

export type ProfileInput = z.infer<typeof ProfileInput>;

export interface Profile extends ProfileInput {
  source: ProfileSource;
  completedAt: Date;
}

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
  ) {}

  async get(userId: string): Promise<Profile | null> {
    const row = await this.db
      .selectFrom('user_profiles')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row) return null;
    const d = (b: Buffer) => this.crypto.decrypt(b);
    return {
      firstName: d(row.first_name_enc),
      lastName: d(row.last_name_enc),
      street: d(row.street_enc),
      postalCode: d(row.postal_code_enc),
      city: d(row.city_enc),
      country: d(row.country_enc),
      source: row.source,
      completedAt: row.completed_at,
    };
  }

  async isComplete(userId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('user_profiles')
      .select('user_id')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return Boolean(row);
  }

  /**
   * Saves the profile. The first save decides the source once: an account that never had a contract
   * completes it as part of its sign-up (`signup`, gets the automatic welcome letter); an account
   * that already had one completes it later (`completed_later`, no automatic letter).
   */
  async save(userId: string, input: ProfileInput): Promise<Profile> {
    const e = (s: string) => this.crypto.encrypt(s);
    const fields = {
      first_name_enc: e(input.firstName),
      last_name_enc: e(input.lastName),
      street_enc: e(input.street),
      postal_code_enc: e(input.postalCode),
      city_enc: e(input.city),
      country_enc: e(input.country),
      key_version: this.crypto.keyVersion,
    };
    await this.db.transaction().execute(async (trx) => {
      const had = await trx
        .selectFrom('subscriptions')
        .select('id')
        .where('user_id', '=', userId)
        .limit(1)
        .executeTakeFirst();
      await trx
        .insertInto('user_profiles')
        .values({ user_id: userId, ...fields, source: had ? 'completed_later' : 'signup' })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ ...fields, updated_at: sql`now()` }))
        .execute();
    });
    return (await this.get(userId))!;
  }

  /** Name and postal address for Stripe and the welcome letter; null without a profile. */
  async postalAddress(userId: string): Promise<PostalAddress | null> {
    const p = await this.get(userId);
    if (!p) return null;
    return {
      name: `${p.firstName} ${p.lastName}`,
      line1: p.street,
      postalCode: p.postalCode,
      city: p.city,
      country: p.country,
    };
  }
}
