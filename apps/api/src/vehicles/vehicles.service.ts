import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TEST_WINDOW_MINUTES, type DecalTemplate } from '@parkshield/shared';
import { sql } from 'kysely';
import { EntitlementService } from '../billing/entitlements.service';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { sha256 } from '../core/crypto';
import { CRYPTO, DB } from '../core/tokens';
import { normalizeCode, TokensService } from './tokens.service';

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
            ])
            .where('status', '<>', 'revoked')
            .orderBy('vehicle_id')
            .orderBy('created_at', 'desc')
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

  /** US-09: count limited by plan, with the limit returned so the UI can show the upgrade prompt. */
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
      await this.tokens.issue(trx, v.id);
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
   * US-13: revoke a leaked code and issue a new one in one step. The old decal immediately shows
   * "inactive"; the new code keeps the saved design so a replacement can be printed or downloaded.
   */
  async revokeAndReissue(userId: string, vehicleId: string, reason: string) {
    const { token } = await this.currentToken(userId, vehicleId);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('qr_tokens')
        .set({
          status: 'revoked',
          revoked_at: sql`now()`,
          revoke_reason: reason,
          test_window_until: null,
        })
        .where('id', '=', token.id)
        .execute();
      const fresh = await this.tokens.issue(trx, vehicleId);
      await trx
        .updateTable('qr_tokens')
        .set({ cta_header: token.cta_header, design_template_id: token.design_template_id })
        .where('id', '=', fresh.id)
        .execute();
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
        .where('t.status', 'in', ['generated', 'printed', 'shipped'])
        .executeTakeFirst()) ?? null
    );
  }

  /**
   * The owner sticks a pre-printed decal on this vehicle: it becomes the vehicle's code and the
   * previous one stops working. Like any decal it is active after the owner's test scan (US-12).
   */
  async claim(userId: string, vehicleId: string, rawCode: string) {
    await this.entitlements.require(userId);
    const v = await this.get(userId, vehicleId);
    const token = await this.claimable(rawCode);
    if (!token) throw new NotFoundException({ error: 'code_not_claimable' });
    await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .updateTable('qr_tokens')
        .set({ vehicle_id: vehicleId, status: 'shipped' })
        .where('id', '=', token.id)
        .where('vehicle_id', 'is', null)
        .executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw new ConflictException({ error: 'code_not_claimable' });
      if (v.decal) {
        await trx
          .updateTable('qr_tokens')
          .set({
            status: 'revoked',
            revoked_at: sql`now()`,
            revoke_reason: 'replaced_by_preprinted',
            test_window_until: null,
          })
          .where('vehicle_id', '=', vehicleId)
          .where('id', '<>', token.id)
          .where('status', '<>', 'revoked')
          .execute();
      }
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
