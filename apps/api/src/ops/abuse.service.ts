import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB, ENV } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { StaffService, type StaffContext } from './staff.service';

/** A scanner ref is shown and sent back as hex; only a prefix is ever displayed. */
const REF_HEX = /^[0-9a-f]{64}$/;

/**
 * Abuse centre (AD-08, AD-09, US-38): reports, blocks, automatic pattern alerts, revoking a code on
 * the owner's behalf, and the review sample of blocked messages.
 */
@Injectable()
export class AbuseService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(VehiclesService) private readonly vehicles: VehiclesService,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  /** AD-08 pattern alerts, computed live from the last hour / day. */
  async patterns() {
    const perHour = Number(await this.settings.get('abuse.code_alerts_per_hour', 10));
    const vehiclesPerDay = Number(await this.settings.get('abuse.scanner_vehicles_per_day', 3));
    const reportsPerDay = Number(await this.settings.get('abuse.scanner_reports_per_day', 2));
    const [busyCodes, roamingScanners, reportedScanners, fakeDecals] = await Promise.all([
      // A decal photo leaked online?
      sql<{ token_id: string; code_hint: string; nickname: string; owner_id: string; n: number }>`
        SELECT t.id AS token_id, t.code_hint, v.nickname, v.owner_user_id AS owner_id, count(*)::int AS n
          FROM alerts a JOIN qr_tokens t ON t.id = a.qr_token_id JOIN vehicles v ON v.id = a.vehicle_id
         WHERE a.created_at > now() - interval '1 hour' AND NOT a.is_test
         GROUP BY t.id, t.code_hint, v.nickname, v.owner_user_id HAVING count(*) > ${perHour}
         ORDER BY n DESC LIMIT 50`.execute(this.db),
      // One person alerting many cars in a day.
      sql<{ ref: Buffer; vehicles: number; alerts: number }>`
        SELECT a.scanner_ref AS ref, count(DISTINCT a.vehicle_id)::int AS vehicles, count(*)::int AS alerts
          FROM alerts a
         WHERE a.scanner_ref IS NOT NULL AND a.created_at > now() - interval '24 hours'
         GROUP BY a.scanner_ref HAVING count(DISTINCT a.vehicle_id) >= ${vehiclesPerDay}
         ORDER BY vehicles DESC LIMIT 50`.execute(this.db),
      // One person reported by several owners in a day.
      sql<{ ref: Buffer; owners: number }>`
        SELECT a.scanner_ref AS ref, count(DISTINCT r.reported_by)::int AS owners
          FROM abuse_reports r JOIN alerts a ON a.id = r.alert_id
         WHERE r.kind = 'owner_report' AND a.scanner_ref IS NOT NULL AND r.created_at > now() - interval '24 hours'
         GROUP BY a.scanner_ref HAVING count(DISTINCT r.reported_by) >= ${reportsPerDay}
         ORDER BY owners DESC LIMIT 50`.execute(this.db),
      sql<{
        token_id: string;
        code_hint: string;
        nickname: string | null;
        owner_id: string | null;
        n: number;
      }>`
        SELECT t.id AS token_id, t.code_hint, v.nickname, v.owner_user_id AS owner_id, count(*)::int AS n
          FROM abuse_reports r JOIN qr_tokens t ON t.id = r.qr_token_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
         WHERE r.kind = 'fake_decal' AND r.status = 'open'
         GROUP BY t.id, t.code_hint, v.nickname, v.owner_user_id ORDER BY n DESC LIMIT 50`.execute(
        this.db,
      ),
    ]);
    const blocked = new Set(
      (
        await this.db
          .selectFrom('scanner_blocks')
          .select('ref')
          .where('qr_token_id', 'is', null)
          .where('expires_at', '>', sql<Date>`now()`)
          .execute()
      ).map((b) => b.ref.toString('hex')),
    );
    const ref = (r: Buffer) => ({
      ref: r.toString('hex'),
      refShort: r.toString('hex').slice(0, 8),
      blocked: blocked.has(r.toString('hex')),
    });
    return {
      thresholds: { perHour, vehiclesPerDay, reportsPerDay },
      busyCodes: busyCodes.rows.map((r) => ({
        tokenId: r.token_id,
        codeHint: r.code_hint,
        nickname: r.nickname,
        customerId: r.owner_id,
        alerts: r.n,
      })),
      roamingScanners: roamingScanners.rows.map((r) => ({
        ...ref(r.ref),
        vehicles: r.vehicles,
        alerts: r.alerts,
      })),
      reportedScanners: reportedScanners.rows.map((r) => ({ ...ref(r.ref), owners: r.owners })),
      fakeDecals: fakeDecals.rows.map((r) => ({
        tokenId: r.token_id,
        codeHint: r.code_hint,
        nickname: r.nickname,
        customerId: r.owner_id,
        reports: r.n,
      })),
    };
  }

  async reports(status: 'open' | 'actioned' | 'dismissed') {
    const rows = await this.db
      .selectFrom('abuse_reports as r')
      .leftJoin('alerts as a', 'a.id', 'r.alert_id')
      .leftJoin('qr_tokens as t', 't.id', 'r.qr_token_id')
      .leftJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .select([
        'r.id',
        'r.kind',
        'r.reason',
        'r.note',
        'r.status',
        'r.created_at',
        'r.handled_at',
        'a.alert_type',
        'a.id as alertId',
        'a.scanner_ref',
        't.id as tokenId',
        't.code_hint',
        'v.nickname',
        'v.owner_user_id',
      ])
      .where('r.status', '=', status)
      .orderBy('r.created_at', 'desc')
      .limit(200)
      .execute();
    return {
      reports: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        reason: r.reason,
        note: r.note,
        status: r.status,
        createdAt: r.created_at,
        handledAt: r.handled_at,
        alertId: r.alertId,
        alertType: r.alert_type,
        tokenId: r.tokenId,
        codeHint: r.code_hint,
        nickname: r.nickname,
        customerId: r.owner_user_id,
        scannerRef: r.scanner_ref?.toString('hex') ?? null,
        scannerRefShort: r.scanner_ref?.toString('hex').slice(0, 8) ?? null,
      })),
    };
  }

  async handleReport(by: StaffContext, id: string, status: 'actioned' | 'dismissed') {
    const r = await this.db
      .updateTable('abuse_reports')
      .set({ status, handled_by: by.userId, handled_at: sql`now()` })
      .where('id', '=', id)
      .where('status', '=', 'open')
      .executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new ConflictException({ error: 'not_open' });
    await this.staff.audit(by.userId, `abuse.report_${status}`, 'abuse_reports', id);
  }

  async blocks() {
    const rows = await this.db
      .selectFrom('scanner_blocks as b')
      .leftJoin('qr_tokens as t', 't.id', 'b.qr_token_id')
      .leftJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .select([
        'b.ref',
        'b.qr_token_id',
        'b.reason',
        'b.expires_at',
        'b.created_at',
        't.code_hint',
        'v.nickname',
      ])
      .where('b.expires_at', '>', sql<Date>`now()`)
      .orderBy('b.created_at', 'desc')
      .limit(200)
      .execute();
    return {
      blocks: rows.map((b) => ({
        ref: b.ref.toString('hex'),
        refShort: b.ref.toString('hex').slice(0, 8),
        scope: b.qr_token_id ? 'vehicle' : 'global',
        tokenId: b.qr_token_id,
        codeHint: b.code_hint,
        nickname: b.nickname,
        reason: b.reason,
        expiresAt: b.expires_at,
        createdAt: b.created_at,
      })),
    };
  }

  /** Global block: the daily scanner ref only lives until the day ends, so the block does too. */
  async blockGlobally(by: StaffContext, refHex: string, reason: string) {
    if (!REF_HEX.test(refHex)) throw new BadRequestException({ error: 'ref_invalid' });
    const ref = Buffer.from(refHex, 'hex');
    const inserted = await sql<{ expires_at: Date }>`
      INSERT INTO scanner_blocks (ref, qr_token_id, reason, expires_at)
      SELECT ${ref}, NULL, ${reason.slice(0, 40)},
             least(now() + interval '24 hours',
                   (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') + interval '1 day') AT TIME ZONE 'Europe/Berlin')
       WHERE NOT EXISTS (SELECT 1 FROM scanner_blocks WHERE ref = ${ref} AND qr_token_id IS NULL AND expires_at > now())
      RETURNING expires_at`.execute(this.db);
    if (!inserted.rows.length) throw new ConflictException({ error: 'already_blocked' });
    await this.staff.audit(by.userId, 'abuse.block_global', 'scanner_blocks', null, {
      ref: refHex.slice(0, 8),
      reason,
    });
    return { expiresAt: inserted.rows[0]!.expires_at };
  }

  async unblock(by: StaffContext, refHex: string, tokenId: string | null) {
    if (!REF_HEX.test(refHex)) throw new BadRequestException({ error: 'ref_invalid' });
    let q = this.db.deleteFrom('scanner_blocks').where('ref', '=', Buffer.from(refHex, 'hex'));
    q = tokenId ? q.where('qr_token_id', '=', tokenId) : q.where('qr_token_id', 'is', null);
    const r = await q.executeTakeFirst();
    if (!Number(r.numDeletedRows)) throw new NotFoundException();
    await this.staff.audit(by.userId, 'abuse.unblock', 'scanner_blocks', tokenId, {
      ref: refHex.slice(0, 8),
    });
  }

  /** AD-08: revoke on the owner's behalf, tell them, and make the replacement decal free. */
  async revokeOnBehalf(by: StaffContext, tokenId: string, reason: string) {
    const t = await this.db
      .selectFrom('qr_tokens as t')
      .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .innerJoin('users as u', 'u.id', 'v.owner_user_id')
      .select([
        't.status',
        'v.id as vehicleId',
        'v.nickname',
        'u.id as userId',
        'u.email',
        'u.preferred_lang',
      ])
      .where('t.id', '=', tokenId)
      .executeTakeFirst();
    if (!t) throw new NotFoundException();
    if (t.status === 'revoked') throw new ConflictException({ error: 'already_revoked' });
    await this.vehicles.revokeAndReissue(t.userId, t.vehicleId, `ops:${reason}`.slice(0, 120));
    await this.db
      .updateTable('users')
      .set({ free_replacements: sql`least(free_replacements + 1, 5)` })
      .where('id', '=', t.userId)
      .execute();
    await this.mail.send({
      to: t.email,
      template: 'code_revoked_by_us',
      locale: t.preferred_lang,
      values: { nickname: t.nickname },
      actionUrl: `${this.env.WEB_BASE_URL}/konto/fahrzeuge/${t.vehicleId}`,
    });
    await this.staff.audit(by.userId, 'abuse.revoke_on_behalf', 'qr_tokens', tokenId, { reason });
  }

  // --- AD-09 review sample ---------------------------------------------------------------------

  /** Blocked messages in the sample, while the text still exists (7 days). Each view is logged. */
  async reviewQueue(by: StaffContext) {
    const rows = await this.db
      .selectFrom('moderation_reviews as m')
      .innerJoin('alerts as a', 'a.id', 'm.alert_id')
      .select(['m.id', 'm.rule_hit', 'm.created_at', 'a.custom_message_enc', 'a.scanner_lang'])
      .where('m.decision', 'is', null)
      .where('a.custom_message_enc', 'is not', null)
      .orderBy('m.created_at')
      .limit(50)
      .execute();
    if (rows.length) {
      await this.staff.auditRead(by.userId, 'moderation.review_view', 'moderation_reviews', null, {
        ids: rows.map((r) => r.id),
      });
    }
    const stats = await sql<{ reviewed: number; false_positive: number }>`
      SELECT count(*)::int AS reviewed, count(*) FILTER (WHERE decision = 'false_positive')::int AS false_positive
        FROM moderation_reviews WHERE reviewed_at > now() - interval '7 days'`.execute(this.db);
    const s = stats.rows[0] ?? { reviewed: 0, false_positive: 0 };
    return {
      items: rows.map((r) => ({
        id: r.id,
        rule: r.rule_hit,
        createdAt: r.created_at,
        language: r.scanner_lang,
        text: this.crypto.decrypt(r.custom_message_enc!),
      })),
      week: {
        reviewed: s.reviewed,
        falsePositive: s.false_positive,
        rate: s.reviewed ? s.false_positive / s.reviewed : null,
      },
    };
  }

  async decideReview(
    by: StaffContext,
    id: string,
    decision: 'correct_block' | 'false_positive' | 'unclear',
  ) {
    const r = await this.db
      .updateTable('moderation_reviews')
      .set({ decision, reviewer_id: by.userId, reviewed_at: sql`now()` })
      .where('id', '=', id)
      .where('decision', 'is', null)
      .executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new ConflictException({ error: 'already_reviewed' });
    await this.staff.audit(by.userId, 'moderation.review', 'moderation_reviews', id, { decision });
  }
}
