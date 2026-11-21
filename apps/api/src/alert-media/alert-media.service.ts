import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { Logger } from 'pino';
import { PhoneBansService } from '../abuse/phone-bans.service';
import { ProtectionService } from '../abuse/protection.service';
import { EntitlementService } from '../billing/entitlements.service';
import { alertMediaDir, type Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { RateLimitedException, RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB, ENV, LOGGER } from '../core/tokens';
import type { DB as Schema } from '../db/types.generated';
import { AckService } from '../notifications/ack.service';
import { PhotoRejectedError, processPhoto, PHOTO_LIMITS } from './image';
import { decryptFile, encryptFile } from './media-crypto';
import { MediaStore } from './media-store';
import { ViewTokenService } from './view-token.service';

/** Photos and their view link are deleted 30 days after the alert (docs/04-legal-privacy.md). */
export const PHOTO_RETENTION_DAYS = 30;
/** The per-vehicle scanner block may not exceed 30 days (CHECK on scanner_blocks, OW-08). */
const MAX_BLOCK_DAYS = 30;
/** A file without a database row is removed after this grace period (crashed upload, deleted account). */
const ORPHAN_GRACE_MS = 3_600_000;
const PURGE_BATCH = 500;

export type ReportSource = 'view_page' | 'portal' | 'email_link';

export interface StoredPhoto {
  storageKey: string;
  wrappedKey: Buffer;
  sizeBytes: number;
  width: number;
  height: number;
}

/** What happened to the photos of one alert submission (the alert itself is never blocked by them). */
export interface PhotoOutcome {
  stored: number;
  rejected: number;
  reason?: 'not_available' | 'rate_limited' | 'invalid';
}

/**
 * Alert photos (Phase 2): validation, re-encoding, envelope encryption, storage, the view page data,
 * "Missbrauch melden" and the 30-day retention rule. Behind ALERT_PHOTOS_ENABLED and an active
 * subscription.
 */
@Injectable()
export class AlertMediaService {
  private readonly store: MediaStore;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(ViewTokenService) private readonly tokens: ViewTokenService,
    @Inject(AckService) private readonly ack: AckService,
    @Inject(PhoneBansService) private readonly phoneBans: PhoneBansService,
    @Inject(ProtectionService) private readonly protection: ProtectionService,
  ) {
    this.store = new MediaStore(alertMediaDir(env));
  }

  /** Feature flag plus an active subscription (single plan since 2026-11-21: photos included). */
  async available(ownerId: string | null): Promise<boolean> {
    if (!this.env.ALERT_PHOTOS_ENABLED || !ownerId) return false;
    return Boolean(await this.entitlements.current(ownerId));
  }

  // --- upload -----------------------------------------------------------------------------------

  /**
   * Called by ScanService after captcha, blocks, text filter and the three scanner limits passed.
   * Checks plan, upload block and the per-vehicle photo limit, then decodes, re-encodes, encrypts and
   * writes each photo. Problems only drop photos; they never stop the alert.
   */
  async prepare(input: {
    ownerId: string | null;
    vehicleId: string;
    isTest: boolean;
    photos: Buffer[];
  }): Promise<{ items: StoredPhoto[]; outcome: PhotoOutcome }> {
    const photos = input.photos.slice(0, PHOTO_LIMITS.files);
    if (!photos.length) return { items: [], outcome: { stored: 0, rejected: 0 } };
    const drop = (reason: PhotoOutcome['reason']) => ({
      items: [],
      outcome: { stored: 0, rejected: photos.length, reason },
    });
    if (!(await this.available(input.ownerId))) return drop('not_available');
    // After an abuse report: no photos for this vehicle for a while. Same answer as "not available".
    const block = await this.db
      .selectFrom('vehicle_photo_upload_blocks')
      .select('until')
      .where('vehicle_id', '=', input.vehicleId)
      .where('until', '>', sql<Date>`now()`)
      .executeTakeFirst();
    if (block) return drop('not_available');
    if (!input.isTest) {
      try {
        await this.limits.enforce('photos.vehicle', input.vehicleId);
      } catch (err) {
        if (err instanceof RateLimitedException) return drop('rate_limited');
        throw err;
      }
    }

    const items: StoredPhoto[] = [];
    let rejected = 0;
    for (const photo of photos) {
      try {
        const p = await processPhoto(photo);
        const storageKey = randomUUID();
        const { blob, wrappedKey } = encryptFile(p.data, storageKey, this.crypto);
        await this.store.write(storageKey, blob);
        items.push({
          storageKey,
          wrappedKey,
          sizeBytes: p.data.length,
          width: p.width,
          height: p.height,
        });
      } catch (err) {
        if (!(err instanceof PhotoRejectedError)) {
          this.logger.warn({ err: String(err) }, 'alert photo could not be stored');
        }
        rejected++;
      }
    }
    return {
      items,
      outcome: { stored: items.length, rejected, ...(rejected ? { reason: 'invalid' } : {}) },
    };
  }

  /**
   * In the alert's transaction: the one view link for all channels (/v/<token>). Every alert has one
   * since the tiered notifications (e-mail and SMS link to it, with or without photos); it expires with
   * the photos (30 days).
   */
  async issueViewLink(trx: Transaction<Schema>, alertId: string): Promise<void> {
    await trx
      .insertInto('alert_view_tokens')
      .values({
        alert_id: alertId,
        token_hash: this.tokens.hashFor(alertId),
        expires_at: sql<Date>`now() + make_interval(days => ${PHOTO_RETENTION_DAYS})`,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /** In the alert's transaction: the media rows. */
  async attach(trx: Transaction<Schema>, alertId: string, items: StoredPhoto[]): Promise<void> {
    if (!items.length) return;
    const expires = sql<Date>`now() + make_interval(days => ${PHOTO_RETENTION_DAYS})`;
    await trx
      .insertInto('alert_media')
      .values(
        items.map((p, i) => ({
          alert_id: alertId,
          position: i + 1,
          storage_key: p.storageKey,
          wrapped_key: p.wrappedKey,
          mime_type: 'image/jpeg',
          size_bytes: p.sizeBytes,
          width: p.width,
          height: p.height,
          expires_at: expires,
        })),
      )
      .execute();
  }

  /** The alert could not be saved: remove the files written by prepare(). */
  async discard(items: StoredPhoto[]): Promise<void> {
    await Promise.all(items.map((p) => this.store.remove(p.storageKey).catch(() => undefined)));
  }

  // --- view page ---------------------------------------------------------------------------------

  private async alertFor(alertId: string) {
    return this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .innerJoin('alert_types as t', 't.code', 'a.alert_type')
      .select([
        'a.id',
        'a.alert_type',
        'a.status',
        'a.is_test',
        'a.created_at',
        'a.expires_at',
        'a.owner_reply',
        'a.custom_message_enc',
        'a.content_hidden',
        'a.block_ref',
        'a.qr_token_id',
        'a.vehicle_id',
        'a.verified_phone_hash',
        'v.owner_user_id as ownerId',
        'v.nickname',
        't.label_de',
        't.label_en',
      ])
      .where('a.id', '=', alertId)
      .executeTakeFirst();
  }

  /**
   * Data for /v/<token>. In Protected Mode (content of an unconfirmed sender) text and photos are only
   * returned when the owner asks for them (`reveal`, the "Anzeigen" button), like in the portal.
   */
  async view(token: string, reveal: boolean) {
    const alertId = await this.tokens.resolve(token);
    const a = alertId ? await this.alertFor(alertId) : undefined;
    if (!a) throw new NotFoundException({ error: 'not_found' });
    const [media, report, replyToken] = await Promise.all([
      this.db
        .selectFrom('alert_media')
        .select([
          'id',
          'position',
          'width',
          'height',
          'deleted_at',
          'deleted_reason',
          'wrapped_key',
        ])
        .where('alert_id', '=', a.id)
        .orderBy('position')
        .execute(),
      this.db
        .selectFrom('abuse_reports')
        .select('id')
        .where('alert_id', '=', a.id)
        .where('reason', '=', 'photo_abuse')
        .executeTakeFirst(),
      this.ack.openToken(a.id),
    ]);
    const live = media.filter((m) => !m.deleted_at && m.wrapped_key);
    const gone =
      media.length && !live.length
        ? media.some((m) => m.deleted_reason === 'abuse_report')
          ? 'abuse_report'
          : 'retention'
        : null;
    const shown = !a.content_hidden || reveal;
    const open = ['created', 'dispatched', 'delivered'].includes(a.status);
    return {
      type: { code: a.alert_type, de: a.label_de, en: a.label_en },
      nickname: a.nickname,
      createdAt: a.created_at,
      isTest: a.is_test,
      status: open && a.expires_at < new Date() ? 'expired' : a.status,
      ownerReply: a.owner_reply,
      contentHidden: a.content_hidden,
      revealed: shown,
      // The scanner's text already passed the filter (SC-04); it is gone after 7 days or a report.
      message: shown && a.custom_message_enc ? this.crypto.decrypt(a.custom_message_enc) : null,
      photoCount: live.length,
      photos: shown
        ? live.map((m) => ({ id: m.id, position: m.position, width: m.width, height: m.height }))
        : [],
      photosGone: gone,
      reported: Boolean(report),
      replyToken,
    };
  }

  /** One decrypted photo for a valid view token, or null (unknown, other alert, deleted). */
  async photo(token: string, mediaId: string): Promise<{ data: Buffer; position: number } | null> {
    const alertId = await this.tokens.resolve(token);
    if (!alertId) return null;
    return this.readPhoto(alertId, mediaId);
  }

  /** The native app: the owner's session proves access (vehicle owner), no view token needed. */
  async photoForOwner(
    ownerId: string,
    alertId: string,
    mediaId: string,
  ): Promise<{ data: Buffer; position: number } | null> {
    const own = await this.db
      .selectFrom('alerts as a')
      .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
      .select('a.id')
      .where('a.id', '=', alertId)
      .where('v.owner_user_id', '=', ownerId)
      .executeTakeFirst();
    return own ? this.readPhoto(alertId, mediaId) : null;
  }

  private async readPhoto(
    alertId: string,
    mediaId: string,
  ): Promise<{ data: Buffer; position: number } | null> {
    const m = await this.db
      .selectFrom('alert_media')
      .select(['storage_key', 'wrapped_key', 'position'])
      .where('id', '=', mediaId)
      .where('alert_id', '=', alertId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!m?.storage_key || !m.wrapped_key) return null;
    try {
      const blob = await this.store.read(m.storage_key);
      return {
        data: decryptFile(blob, m.storage_key, m.wrapped_key, this.crypto),
        position: m.position,
      };
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'alert photo could not be read');
      return null;
    }
  }

  // --- "Missbrauch melden" -------------------------------------------------------------------------

  async reportFromView(token: string, source: 'view_page' | 'email_link') {
    const alertId = await this.tokens.resolve(token);
    const a = alertId ? await this.alertFor(alertId) : undefined;
    if (!a) throw new NotFoundException({ error: 'not_found' });
    return this.report(a, source);
  }

  async reportFromPortal(userId: string, alertId: string) {
    const a = await this.alertFor(alertId);
    if (!a || a.ownerId !== userId || a.status === 'blocked') throw new NotFoundException();
    return this.report(a, 'portal');
  }

  /**
   * 1. delete the photos at once (key, then file, then row) and the alert text, 2. block the scanner for
   * this vehicle (OW-08, block_ref) and ban a confirmed number, 3. no photo uploads for this vehicle for
   * a while (the scanner reference may change), 4. an abuse report for the review queue in ops.
   * Stores no photo and no free text. Idempotent: a second report deletes nothing more.
   */
  private async report(
    a: NonNullable<Awaited<ReturnType<AlertMediaService['alertFor']>>>,
    source: ReportSource,
  ) {
    const blockDays = Math.min(
      MAX_BLOCK_DAYS,
      Math.max(1, Number(await this.settings.get('photos.abuse_block_days', 30))),
    );
    const uploadHours = Math.max(
      1,
      Number(await this.settings.get('photos.abuse_upload_block_hours', 24)),
    );
    const result = await this.db.transaction().execute(async (trx) => {
      // Crypto-shredding first: without the wrapped key no copy of the file can be read any more.
      const shredded = await trx
        .updateTable('alert_media')
        .set({ wrapped_key: null })
        .where('alert_id', '=', a.id)
        .where('deleted_at', 'is', null)
        .returning(['id', 'storage_key'])
        .execute();
      await trx
        .updateTable('alerts')
        .set({ custom_message_enc: null })
        .where('id', '=', a.id)
        .execute();
      const existing = await trx
        .selectFrom('abuse_reports')
        .select('id')
        .where('alert_id', '=', a.id)
        .where('reason', '=', 'photo_abuse')
        .executeTakeFirst();
      if (!existing) {
        await trx
          .insertInto('abuse_reports')
          .values({
            kind: 'owner_report',
            alert_id: a.id,
            reported_by: a.ownerId,
            qr_token_id: a.qr_token_id,
            reason: 'photo_abuse',
            source,
          })
          .execute();
      }
      let blocked = false;
      if (!a.is_test) {
        const recent = a.created_at.getTime() > Date.now() - MAX_BLOCK_DAYS * 86_400_000;
        if (a.block_ref && recent) {
          const active = await trx
            .selectFrom('scanner_blocks')
            .select('ref')
            .where('ref', '=', a.block_ref)
            .where('qr_token_id', '=', a.qr_token_id)
            .where('expires_at', '>', sql<Date>`now()`)
            .executeTakeFirst();
          if (!active) {
            await trx
              .insertInto('scanner_blocks')
              .values({
                ref: a.block_ref,
                qr_token_id: a.qr_token_id,
                reason: 'photo_abuse',
                expires_at: sql`now() + make_interval(days => ${blockDays})`,
              })
              .execute();
          }
          blocked = true;
        }
        if (a.verified_phone_hash) {
          await this.phoneBans.banForVehicle(trx, a.verified_phone_hash, a.vehicle_id);
          blocked = true;
        }
        if (!existing) await this.protection.afterReport(trx, a.vehicle_id);
        await trx
          .insertInto('vehicle_photo_upload_blocks')
          .values({
            vehicle_id: a.vehicle_id,
            until: sql`now() + make_interval(hours => ${uploadHours})`,
          })
          .onConflict((oc) =>
            oc.column('vehicle_id').doUpdateSet({
              until: sql`greatest(vehicle_photo_upload_blocks.until, excluded.until)`,
            }),
          )
          .execute();
      }
      return { shredded, blocked };
    });
    await this.finishDeletion(result.shredded, 'abuse_report');
    return { deleted: result.shredded.length, blocked: result.blocked };
  }

  /** Steps 2 and 3 of a deletion: the file, then the row (key already gone). Safe to repeat. */
  private async finishDeletion(
    rows: { id: string; storage_key: string | null }[],
    reason: 'retention' | 'abuse_report' | 'owner_deleted',
  ): Promise<number> {
    const done: string[] = [];
    for (const r of rows) {
      try {
        if (r.storage_key) await this.store.remove(r.storage_key);
        done.push(r.id);
      } catch (err) {
        // The key is already gone, so the file is unreadable; the next retention run tries again.
        this.logger.warn({ err: String(err) }, 'alert photo file could not be removed');
      }
    }
    if (!done.length) return 0;
    await this.db
      .updateTable('alert_media')
      .set({
        storage_key: null,
        wrapped_key: null,
        deleted_at: sql`now()`,
        deleted_reason: reason,
      })
      .where('id', 'in', done)
      .where('deleted_at', 'is', null)
      .execute();
    return done.length;
  }

  // --- retention ----------------------------------------------------------------------------------

  /**
   * Rule of the hourly retention job (US-33): photos older than 30 days lose their key, then their
   * file, then their row data; their view links go with them. Also finishes deletions a crash left
   * half done, removes expired upload blocks, and deletes files without a row (e.g. after an account
   * was deleted, which removes the rows and keys by cascade). Idempotent; returns counts only.
   */
  async purgeExpired(): Promise<{ photos: number; links: number; orphans: number }> {
    let photos = 0;
    for (;;) {
      const due = await this.db
        .updateTable('alert_media')
        .set({ wrapped_key: null })
        .where(
          'id',
          'in',
          this.db
            .selectFrom('alert_media')
            .select('id')
            .where('deleted_at', 'is', null)
            .where((eb) =>
              eb.or([eb('expires_at', '<', sql<Date>`now()`), eb('wrapped_key', 'is', null)]),
            )
            .limit(PURGE_BATCH),
        )
        .returning(['id', 'storage_key'])
        .execute();
      if (!due.length) break;
      photos += await this.finishDeletion(due, 'retention');
      if (due.length < PURGE_BATCH) break;
    }
    const links = await this.db
      .deleteFrom('alert_view_tokens')
      .where('expires_at', '<', sql<Date>`now()`)
      .executeTakeFirst();
    await this.db
      .deleteFrom('vehicle_photo_upload_blocks')
      .where('until', '<', sql<Date>`now()`)
      .execute();

    let orphans = 0;
    const old = await this.store.listOlderThan(ORPHAN_GRACE_MS);
    for (let i = 0; i < old.length; i += PURGE_BATCH) {
      const chunk = old.slice(i, i + PURGE_BATCH);
      const known = await this.db
        .selectFrom('alert_media')
        .select('storage_key')
        .where('storage_key', 'in', chunk)
        .execute();
      const keep = new Set(known.map((k) => k.storage_key));
      for (const name of chunk.filter((n) => !keep.has(n))) {
        await this.store.remove(name).catch(() => undefined);
        orphans++;
      }
    }
    return { photos, links: Number(links.numDeletedRows), orphans };
  }
}
