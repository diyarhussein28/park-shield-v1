import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { sha256 } from '../core/crypto';
import { CRYPTO, DB, ENV } from '../core/tokens';
import { qrSvg } from '../letters/qr';
import { TagsService } from '../vehicles/tags.service';
import { normalizeCode, TokensService } from '../vehicles/tokens.service';
import { serialLabel } from './fulfilment.service';
import { StaffService, type StaffContext } from './staff.service';

export type NfcMethod = 'web_nfc' | 'nfc_tools';

/** Chip UIDs come as `04:A1:…` (NFC Tools) or `04:a1:…` (Web NFC): compared as plain lower-case hex. */
export const normalizeUid = (uid: string) => uid.replace(/[^0-9a-f]/gi, '').toLowerCase();

/** `PS-000123`, `ps123` or `123` → 123; anything else null. */
export function parseSerial(q: string): number | null {
  const m = /^(?:ps-?)?0*(\d{1,9})$/i.exec(q.trim());
  return m ? Number(m[1]) : null;
}

/**
 * NFC stickers, phase 2 (2026-11-27, docs/nfc-sticker-plan.md): find an in-house stock sticker by its
 * serial (or by scanning its QR code), write its chip, check that the chip carries exactly the
 * sticker's URL, lock the chip for good, or take a damaged sticker out of stock. Only a locked sticker
 * can be packed (`FulfilmentService.scanStockSticker`). Staff never see the code except as the URL
 * they write, and that read is audited.
 */
@Injectable()
export class StickersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(TagsService) private readonly tags: TagsService,
  ) {}

  private base() {
    return this.db
      .selectFrom('qr_tokens as t')
      .innerJoin('token_batches as b', 'b.id', 't.batch_id')
      .leftJoin('nfc_tags as n', 'n.qr_token_id', 't.id')
      .select([
        't.id',
        't.serial_no as serialNo',
        't.status',
        't.revoke_reason as revokeReason',
        't.assigned_at as assignedAt',
        'b.id as batchId',
        'b.chip',
        'n.method',
        'n.written_at as writtenAt',
        'n.verified_at as verifiedAt',
        'n.locked_at as lockedAt',
      ])
      .where('b.kind', '=', 'inhouse_nfc');
  }

  private present(r: Awaited<ReturnType<ReturnType<StickersService['base']>['execute']>>[number]) {
    const { serialNo, ...rest } = r;
    return {
      ...rest,
      serial: serialLabel(serialNo!),
      ready: r.status === 'in_stock' && r.lockedAt !== null,
    };
  }

  /** By serial (`PS-000123`) or by the scanned QR code / URL of the sticker. At most 20 rows. */
  async search(q: string) {
    const serial = parseSerial(q);
    if (serial !== null) {
      const rows = await this.base().where('t.serial_no', '=', serial).limit(20).execute();
      return { stickers: rows.map((r) => this.present(r)) };
    }
    const code = normalizeCode(q.trim().split('/').filter(Boolean).pop() ?? '');
    if (!code) return { stickers: [] };
    const rows = await this.base().where('t.code_hash', '=', sha256(code)).limit(20).execute();
    return { stickers: rows.map((r) => this.present(r)) };
  }

  async get(id: string) {
    const r = await this.base().where('t.id', '=', id).executeTakeFirst();
    if (!r) throw new NotFoundException({ error: 'sticker_not_found' });
    return { sticker: this.present(r) };
  }

  /** The sticker's URL: what is printed in its QR code and what its chip must carry. */
  private async url(id: string): Promise<string> {
    const t = await this.db
      .selectFrom('qr_tokens')
      .select('code_enc')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return `${this.env.SCANNER_BASE_URL.replace(/\/$/, '')}/s/${this.tokens.decrypt(t.code_enc)}`;
  }

  /** Only stock stickers that are not locked yet can be (re)written or checked. */
  private async workable(id: string) {
    const { sticker } = await this.get(id);
    if (sticker.status !== 'in_stock') throw new ConflictException({ error: 'not_in_stock' });
    return sticker;
  }

  /** The URL to write, with the NDEF payload and the QR image. Shows a code: an audited read. */
  async target(by: StaffContext, id: string) {
    const sticker = await this.workable(id);
    const url = await this.url(id);
    await this.staff.auditRead(by.userId, 'sticker.nfc_url', 'qr_tokens', id, {
      serial: sticker.serial,
    });
    const https = url.startsWith('https://');
    const rest = url.replace(/^https?:\/\//, '');
    return {
      url,
      ndefPayloadHex: `${https ? '04' : '03'}${Buffer.from(rest, 'utf8').toString('hex')}`,
      qrSvg: qrSvg({ url, caption: null }),
    };
  }

  /** The chip was written (Web NFC or NFC Tools). Writing again resets an earlier check. */
  async written(by: StaffContext, id: string, method: NfcMethod) {
    const sticker = await this.workable(id);
    if (sticker.lockedAt) throw new ConflictException({ error: 'nfc_locked' });
    await this.db
      .insertInto('nfc_tags')
      .values({
        qr_token_id: id,
        chip: sticker.chip ?? 'NTAG215',
        method,
        written_at: sql<Date>`now()`,
        written_by: by.userId,
      })
      .onConflict((oc) =>
        oc.column('qr_token_id').doUpdateSet({
          method,
          written_at: sql<Date>`now()`,
          written_by: by.userId,
          verified_at: null,
          verified_by: null,
          updated_at: sql<Date>`now()`,
        }),
      )
      .execute();
    await this.staff.audit(by.userId, 'sticker.nfc_written', 'qr_tokens', id, { method });
    return this.get(id);
  }

  /**
   * The chip was read back: its URL must be exactly the sticker's URL, and a chip already known for
   * this sticker must be the same chip. A mismatch blocks the sticker until it is written again.
   */
  async verify(by: StaffContext, id: string, input: { readUrl: string; uid?: string }) {
    const sticker = await this.workable(id);
    if (!sticker.writtenAt) throw new ConflictException({ error: 'nfc_not_written' });
    if (sticker.lockedAt) throw new ConflictException({ error: 'nfc_locked' });
    const expected = await this.url(id);
    if (input.readUrl.trim() !== expected) {
      await this.staff.audit(by.userId, 'sticker.nfc_mismatch', 'qr_tokens', id);
      throw new ConflictException({ error: 'nfc_mismatch' });
    }
    const uid = input.uid ? normalizeUid(input.uid) : '';
    const bidx = uid ? this.crypto.blindIndex(uid, (v) => v) : null;
    if (bidx) {
      const other = await this.db
        .selectFrom('nfc_tags')
        .select('qr_token_id')
        .where('uid_bidx', '=', bidx)
        .where('qr_token_id', '<>', id)
        .executeTakeFirst();
      if (other) throw new ConflictException({ error: 'nfc_uid_in_use' });
      const own = await this.db
        .selectFrom('nfc_tags')
        .select('uid_bidx')
        .where('qr_token_id', '=', id)
        .executeTakeFirst();
      if (own?.uid_bidx && !own.uid_bidx.equals(bidx))
        throw new ConflictException({ error: 'nfc_other_chip' });
    }
    await this.db
      .updateTable('nfc_tags')
      .set({
        verified_at: sql<Date>`now()`,
        verified_by: by.userId,
        ...(bidx ? { uid_bidx: bidx } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('qr_token_id', '=', id)
      .execute();
    await this.staff.audit(by.userId, 'sticker.nfc_verified', 'qr_tokens', id, {
      uid: Boolean(bidx),
    });
    return this.get(id);
  }

  /** The chip was locked for good (irreversible, confirmed on the page). Only after a passed check. */
  async locked(by: StaffContext, id: string) {
    const sticker = await this.workable(id);
    if (sticker.lockedAt) return this.get(id);
    if (!sticker.verifiedAt) throw new ConflictException({ error: 'nfc_not_verified' });
    await this.db
      .updateTable('nfc_tags')
      .set({ locked_at: sql<Date>`now()`, locked_by: by.userId, updated_at: sql<Date>`now()` })
      .where('qr_token_id', '=', id)
      .execute();
    await this.staff.audit(by.userId, 'sticker.nfc_locked', 'qr_tokens', id);
    return this.get(id);
  }

  /** A damaged or misprinted sticker leaves the stock for good; its code never works. */
  async damaged(by: StaffContext, id: string, note: string) {
    await this.workable(id);
    await this.db.transaction().execute(async (trx) => {
      await this.tags.transition(trx, id, 'revoked', 'admin', 'damaged');
    });
    await this.staff.audit(by.userId, 'sticker.damaged', 'qr_tokens', id, { note });
    return this.get(id);
  }
}
