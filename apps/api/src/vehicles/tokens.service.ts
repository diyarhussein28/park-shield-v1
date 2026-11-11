import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { FieldCrypto } from '../core/crypto';
import { randomCrockford, sha256 } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import type { DB } from '../db/types.generated';

export const CODE_LENGTH = 10; // Crockford Base32, 50 random bits (SC-01)
const CROCKFORD_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** Crockford decoding is forgiving about look-alikes: O→0, I/L→1, case and hyphens ignored. */
export function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/-/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return CROCKFORD_CODE.test(code) ? code : null;
}

/**
 * Decal codes. Lookups only ever use `code_hash`; `code_enc` exists solely so decal files can be
 * re-rendered (README hard rule 1), and ops only ever see `code_hint`.
 */
@Injectable()
export class TokensService {
  constructor(@Inject(CRYPTO) private readonly crypto: FieldCrypto) {}

  /** A code for a vehicle, or (vehicleId null) a pre-printed batch code that waits to be claimed. */
  async issue(
    trx: Transaction<DB>,
    vehicleId: string | null,
    batchId: string | null = null,
  ): Promise<{ id: string; code: string }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCrockford(CODE_LENGTH);
      const row = await trx
        .insertInto('qr_tokens')
        .values({
          vehicle_id: vehicleId,
          batch_id: batchId,
          code_hash: sha256(code),
          code_enc: this.crypto.encrypt(code),
          key_version: this.crypto.keyVersion,
          code_hint: code.slice(-4),
        })
        .onConflict((oc) => oc.column('code_hash').doNothing())
        .returning('id')
        .executeTakeFirst();
      if (row) return { id: row.id, code };
    }
    throw new Error('could not issue a unique decal code');
  }

  decrypt(codeEnc: Buffer): string {
    return this.crypto.decrypt(codeEnc);
  }
}
