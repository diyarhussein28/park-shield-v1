import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TEST_WINDOW_MINUTES, type DecalTemplate } from '@parkshield/shared';
import { sql, type Transaction } from 'kysely';
import { EntitlementService } from '../billing/entitlements.service';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { sha256 } from '../core/crypto';
import { CRYPTO, DB } from '../core/tokens';
import type { DB as Database } from '../db/types.generated';
import {
  auditCodeReplaced,
  CodeRulesService,
  lockCodes,
  recordIssuance,
  type NewCodeEligibility,
} from './code-rules';
import { TagsService } from './tags.service';
import { normalizeCode, TokensService } from './tokens.service';
import { queueWelcomeLetterCheck } from '../letters/trigger';

export interface VehicleInput {
  nickname: string;
  plate: string;
  makeModel?: string | null;
  color?: string | null;
}

/** Display form of a plate: upper case, single spaces ("K-AB 1234"). */
export const formatPlate = (plate: string) => plate.trim().toUpperCase().replace(/\s+/g, ' ');
/** Blind-index form: letters and digits only, so "K-AB 1234" and "kab1234" match. */
export const plateKey = (plate: string) => plate.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');

@Injectable()
export class VehiclesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(TagsService) private readonly tags: TagsService,
    @Inject(CodeRulesService) private readonly rules: CodeRulesService,
  ) {}

  /** Current (newest non-revoked) decal of each vehicle, joined to the vehicle. */
  private base(userId: string) {
    return this.db
      .selectFrom('vehicles as v')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('qr_tokens')
            .distinctOn('vehicle_id')
            .select([
              'id',
              'vehicle_id',
              'code_hint',
              'status',
              'cta_header',
              'design_template_id',
              'activated_at',
              'last_test_at',
              'test_window_until',
              'serial_no',
            ])
            .where('status', '<>', 'revoked')
            .orderBy('vehicle_id')
            // Newest by assignment: a packed stock code (created long before) is the current one.
            .orderBy(sql`coalesce(assigned_at, created_at)`, 'desc')
            .as('t'),
        (join) => join.onRef('t.vehicle_id', '=', 'v.id'),
      )
      .select([
        'v.id',
        'v.nickname',
        'v.plate_enc',
        'v.make_model',
        'v.color',
        'v.created_at',
        't.id as tokenId',
        't.code_hint',
        't.status as tokenStatus',
        't.cta_header',
        't.design_template_id',
        't.activated_at',
        't.last_test_at',
        't.test_window_until',
        't.serial_no',
        // NFC stickers (2026-11-27): an older code that still works during a change-over.
        (eb) =>
          eb
            .selectFrom('qr_tokens as o')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('o.vehicle_id', '=', 'v.id')
            .where('o.status', '=', 'assigned')
            .whereRef('o.id', '<>', 't.id')
            .as('oldCodes'),
        (eb) =>
          eb
            .selectFrom('qr_tokens as o')
            .select((e) => e.fn.min('o.retire_after').as('at'))
            .whereRef('o.vehicle_id', '=', 'v.id')
            .where('o.status', '=', 'assigned')
            .whereRef('o.id', '<>', 't.id')
            .as('oldCodeUntil'),
      ])
      .where('v.owner_user_id', '=', userId);
  }

  private present(
    row: Awaited<ReturnType<ReturnType<VehiclesService['base']>['executeTakeFirstOrThrow']>>,
  ) {
    return {
      id: row.id,
      nickname: row.nickname,
      plate: row.plate_enc ? this.crypto.decrypt(row.plate_enc) : null,
      makeModel: row.make_model,
      color: row.color,
      createdAt: row.created_at,
      decal: row.tokenId
        ? {
            tokenId: row.tokenId,
            codeHint: row.code_hint,
            status: row.tokenStatus,
            cta: row.cta_header,
            template: row.design_template_id as DecalTemplate,
            activatedAt: row.activated_at,
            lastTestAt: row.last_test_at,
            testWindowUntil:
              row.test_window_until && row.test_window_until > new Date()
                ? row.test_window_until
                : null,
            // An in-house stock sticker: its printed serial number (`PS-000001`).
            serial: row.serial_no === null ? null : `PS-${String(row.serial_no).padStart(6, '0')}`,
            // Change-over: the old code still works until the new sticker is tested, at the latest
            // until `oldCodeUntil` (null while the sticker is not shipped yet).
            changeOver:
              Number(row.oldCodes ?? 0) > 0
                ? { oldCodeUntil: (row.oldCodeUntil as Date | null) ?? null }
                : null,
          }
        : null,
    };
  }

  async list(userId: string) {
    const rows = await this.base(userId).orderBy('v.created_at').execute();
    return rows.map((r) => this.present(r));
  }

  async get(userId: string, vehicleId: string) {
    const row = await this.base(userId).where('v.id', '=', vehicleId).executeTakeFirst();
    if (!row) throw new NotFoundException({ error: 'vehicle_not_found' });
    return this.present(row);
  }

  /** US-09: one vehicle per account for now (setting `limits.vehicles`). */
  async create(userId: string, input: VehicleInput) {
    const ent = await this.entitlements.require(userId);
    const id = await this.db.transaction().execute(async (trx) => {
      // Serialise concurrent creates for this user so the plan limit cannot be overshot.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`.execute(trx);
      const { n } = await trx
        .selectFrom('vehicles')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('owner_user_id', '=', userId)
        .executeTakeFirstOrThrow();
      if (Number(n) >= ent.limits.vehicles) {
        throw new ConflictException({
          error: 'vehicle_limit',
          limit: ent.limits.vehicles,
          plan: ent.plan,
        });
      }
      const v = await trx
        .insertInto('vehicles')
        .values({
          owner_user_id: userId,
          nickname: input.nickname.trim(),
          plate_enc: this.crypto.encrypt(formatPlate(input.plate)),
          plate_bidx: this.crypto.blindIndex(input.plate, plateKey),
          key_version: this.crypto.keyVersion,
          make_model: input.makeModel?.trim() || null,
          color: input.color?.trim() || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const first = await this.tokens.issue(trx, v.id);
      await recordIssuance(trx, {
        vehicleId: v.id,
        userId,
        tokenId: first.id,
        kind: 'initial',
        subscriptionId: ent.subscriptionId,
      });
      // The first vehicle may complete the welcome-letter conditions (paid + vehicle).
      if (Number(n) === 0) await queueWelcomeLetterCheck(trx, userId);
      return v.id;
    });
    return this.get(userId, id);
  }

  async update(userId: string, vehicleId: string, input: Partial<VehicleInput>) {
    await this.get(userId, vehicleId);
    await this.db
      .updateTable('vehicles')
      .set({
        ...(input.nickname !== undefined ? { nickname: input.nickname.trim() } : {}),
        ...(input.plate !== undefined
          ? {
              plate_enc: this.crypto.encrypt(formatPlate(input.plate)),
              plate_bidx: this.crypto.blindIndex(input.plate, plateKey),
              key_version: this.crypto.keyVersion,
            }
          : {}),
        ...(input.makeModel !== undefined ? { make_model: input.makeModel?.trim() || null } : {}),
        ...(input.color !== undefined ? { color: input.color?.trim() || null } : {}),
      })
      .where('id', '=', vehicleId)
      .where('owner_user_id', '=', userId)
      .execute();
    return this.get(userId, vehicleId);
  }

  /** Deleting a vehicle removes its codes too; a scanned old decal then shows "inactive" (SC-07). */
  async remove(userId: string, vehicleId: string): Promise<void> {
    const r = await this.db
      .deleteFrom('vehicles')
      .where('id', '=', vehicleId)
      .where('owner_user_id', '=', userId)
      .executeTakeFirst();
    if (!Number(r.numDeletedRows)) throw new NotFoundException({ error: 'vehicle_not_found' });
  }

  /** Raw current token row of an owned vehicle (for rendering decals). */
  async currentToken(userId: string, vehicleId: string) {
    const v = await this.get(userId, vehicleId);
    if (!v.decal) throw new NotFoundException({ error: 'no_decal' });
    const t = await this.db
      .selectFrom('qr_tokens')
      .select(['id', 'code_enc', 'cta_header', 'design_template_id', 'status'])
      .where('id', '=', v.decal.tokenId)
      .executeTakeFirstOrThrow();
    return { vehicle: v, token: t, code: this.tokens.decrypt(t.code_enc) };
  }

  /**
   * „Sperren“ (owner decision 2026-11-21): the current code stops working at once and NO new code is
   * created. The vehicle then shows „Kein aktiver Code“ until the owner creates one (free, explicit).
   */
  async revoke(userId: string, vehicleId: string, reason: string) {
    const v = await this.get(userId, vehicleId);
    if (!v.decal) throw new ConflictException({ error: 'no_active_code' });
    await this.db.transaction().execute(async (trx) => {
      // Every live code of the vehicle: during a change-over the old one works too (2026-11-27).
      const live = await trx
        .selectFrom('qr_tokens')
        .select('id')
        .where('vehicle_id', '=', vehicleId)
        .where('status', '<>', 'revoked')
        .execute();
      for (const t of live) await this.tags.transition(trx, t.id, 'revoked', 'owner', reason);
    });
    return this.get(userId, vehicleId);
  }

  /** `GET /v1/vehicles/:id/new-code`: what the vehicle screen offers (free, 3 €, or the date). */
  async newCodeOptions(userId: string, vehicleId: string): Promise<NewCodeEligibility> {
    await this.get(userId, vehicleId);
    const {
      subscriptionId: _s,
      yearStart: _y,
      ...e
    } = await this.rules.eligibility(this.db, userId, vehicleId);
    return e;
  }

  /**
   * „Neuen Code erstellen“ (2026-11-24): free once per subscription year after a „Sperren“, and only
   * outside the cooldown. The new code keeps the design of the last one, so it can be printed or
   * downloaded right away. Errors: 409 `code_cooldown` (+ `nextEligibleAt`), 409 `code_active`,
   * 402 `payment_required` (the free one is used: a new code comes with the 3 € printed sticker).
   */
  async createCode(userId: string, vehicleId: string) {
    await this.entitlements.require(userId);
    await this.get(userId, vehicleId);
    await this.db.transaction().execute(async (trx) => {
      await lockCodes(trx, userId);
      const e = await this.rules.eligibility(trx, userId, vehicleId);
      if (e.reason === 'cooldown')
        throw new ConflictException({
          error: 'code_cooldown',
          nextEligibleAt: e.nextEligibleAt,
          cooldownDays: e.cooldownDays,
        });
      if (e.reason === 'code_active') throw new ConflictException({ error: 'code_active' });
      if (e.reason === 'free_used')
        throw new HttpException(
          { error: 'payment_required', priceCents: e.priceCents },
          HttpStatus.PAYMENT_REQUIRED,
        );
      const fresh = await this.issueKeepingDesign(trx, vehicleId);
      await recordIssuance(trx, {
        vehicleId,
        userId,
        tokenId: fresh.id,
        kind: 'free',
        subscriptionId: e.subscriptionId,
        subscriptionYearStart: e.yearStart,
      });
      await auditCodeReplaced(
        trx,
        { id: userId, kind: 'customer' },
        { vehicleId, tokenId: fresh.id, kind: 'free' },
      );
    });
    return this.get(userId, vehicleId);
  }

  /**
   * Back office (`codes.override_cooldown`): a new code at once, whatever the cooldown and the free
   * quota say (e.g. a stolen sticker). The active code, if any, stops working. Free of charge.
   */
  async overrideNewCode(staffId: string, vehicleId: string, reason: string) {
    const v = await this.db
      .selectFrom('vehicles')
      .select('owner_user_id')
      .where('id', '=', vehicleId)
      .executeTakeFirst();
    if (!v?.owner_user_id) throw new NotFoundException();
    const userId = v.owner_user_id;
    return this.db.transaction().execute(async (trx) => {
      await lockCodes(trx, userId);
      const year = await this.rules.subscriptionYear(trx, userId);
      if (!year) throw new ConflictException({ error: 'subscription_required' });
      const active = await trx
        .selectFrom('qr_tokens')
        .select('id')
        .where('vehicle_id', '=', vehicleId)
        .where('status', '<>', 'revoked')
        .execute();
      for (const t of active)
        await this.tags.transition(trx, t.id, 'revoked', 'admin', 'ops_override');
      const fresh = await this.issueKeepingDesign(trx, vehicleId, 'admin');
      await recordIssuance(trx, {
        vehicleId,
        userId,
        tokenId: fresh.id,
        kind: 'ops_override',
        subscriptionId: year.subscriptionId,
        subscriptionYearStart: year.yearStart,
      });
      await auditCodeReplaced(
        trx,
        { id: staffId, kind: 'staff' },
        { vehicleId, tokenId: fresh.id, kind: 'ops_override', reason },
      );
      return { tokenId: fresh.id, codeHint: fresh.code.slice(-4) };
    });
  }

  /** A new code for the vehicle with the design (template, headline) of its newest code. */
  private async issueKeepingDesign(
    trx: Transaction<Database>,
    vehicleId: string,
    actor?: 'owner' | 'admin' | 'system',
  ) {
    const last = await trx
      .selectFrom('qr_tokens')
      .select(['cta_header', 'design_template_id'])
      .where('vehicle_id', '=', vehicleId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const fresh = await this.tokens.issue(trx, vehicleId, null, actor);
    if (last) {
      await trx
        .updateTable('qr_tokens')
        .set({ cta_header: last.cta_header, design_template_id: last.design_template_id })
        .where('id', '=', fresh.id)
        .execute();
    }
    return fresh;
  }

  /** Ops abuse centre: revoke and issue in one step (AD-08; not offered to owners any more). */
  async revokeAndReissue(userId: string, vehicleId: string, reason: string) {
    const { token } = await this.currentToken(userId, vehicleId);
    await this.db.transaction().execute(async (trx) => {
      await lockCodes(trx, userId);
      const live = await trx
        .selectFrom('qr_tokens')
        .select('id')
        .where('vehicle_id', '=', vehicleId)
        .where('status', '<>', 'revoked')
        .execute();
      for (const t of live) await this.tags.transition(trx, t.id, 'revoked', 'owner', reason);
      const fresh = await this.tokens.issue(trx, vehicleId);
      await trx
        .updateTable('qr_tokens')
        .set({ cta_header: token.cta_header, design_template_id: token.design_template_id })
        .where('id', '=', fresh.id)
        .execute();
      await recordIssuance(trx, { vehicleId, userId, tokenId: fresh.id, kind: 'ops_reissue' });
    });
    return this.get(userId, vehicleId);
  }

  /**
   * AD-07: a pre-printed partner decal that is not yet anyone's. Unknown, revoked and already
   * claimed codes all return null.
   */
  async claimable(rawCode: string) {
    const code = normalizeCode(rawCode);
    if (!code) return null;
    return (
      (await this.db
        .selectFrom('qr_tokens as t')
        .innerJoin('token_batches as b', 'b.id', 't.batch_id')
        .leftJoin('partners as p', 'p.id', 'b.partner_id')
        .leftJoin('promo_codes as c', (j) =>
          j
            .onRef('c.id', '=', 'b.promo_code_id')
            .on('c.is_active', '=', true)
            .on((eb) =>
              eb.or([eb('c.valid_until', 'is', null), eb('c.valid_until', '>', sql<Date>`now()`)]),
            ),
        )
        .select(['t.id', 'p.name as partner', 'c.code as promoCode'])
        .where('t.code_hash', '=', sha256(code))
        .where('t.vehicle_id', 'is', null)
        .where('t.status', '=', 'in_stock')
        // In-house NFC stock is assigned by staff when packing, never claimed by a customer.
        .where('b.kind', '=', 'partner')
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * Partner channel only (AD-07): the owner sticks a pre-printed partner decal on this vehicle. It
   * becomes the vehicle's code at once and the previous one stops working. Regular customers never
   * do this: their code is assigned when they register the vehicle.
   */
  async claim(userId: string, vehicleId: string, rawCode: string) {
    await this.entitlements.require(userId);
    await this.get(userId, vehicleId);
    const token = await this.claimable(rawCode);
    if (!token) throw new NotFoundException({ error: 'code_not_claimable' });
    await this.db.transaction().execute(async (trx) => {
      const old = await trx
        .selectFrom('qr_tokens')
        .select('id')
        .where('vehicle_id', '=', vehicleId)
        .where('status', '=', 'assigned')
        .execute();
      try {
        await this.tags.transition(trx, token.id, 'assigned', 'owner', 'partner_claim', vehicleId);
      } catch {
        throw new ConflictException({ error: 'code_not_claimable' });
      }
      for (const o of old) {
        await this.tags.transition(trx, o.id, 'revoked', 'owner', 'replaced_by_preprinted');
      }
      await recordIssuance(trx, { vehicleId, userId, tokenId: token.id, kind: 'partner_claim' });
    });
    return this.get(userId, vehicleId);
  }

  /** US-12: "Aufkleber testen" — the next scan of this code within the window is the owner's test. */
  async openTestWindow(userId: string, vehicleId: string): Promise<{ until: Date; code: string }> {
    const { token, code } = await this.currentToken(userId, vehicleId);
    const until = new Date(Date.now() + TEST_WINDOW_MINUTES * 60_000);
    await this.db
      .updateTable('qr_tokens')
      .set({ test_window_until: until })
      .where('id', '=', token.id)
      .execute();
    return { until, code };
  }

  async saveDesign(
    userId: string,
    vehicleId: string,
    design: { template: DecalTemplate; cta: string },
  ) {
    const { token } = await this.currentToken(userId, vehicleId);
    await this.db
      .updateTable('qr_tokens')
      .set({ design_template_id: design.template, cta_header: design.cta.trim() })
      .where('id', '=', token.id)
      .execute();
    return this.get(userId, vehicleId);
  }
}
