import {
  ForbiddenException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AlertStatus, AlertTypeCode } from '@parkshield/shared';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { randomToken, sha256 } from '../core/crypto';
import { GeoService } from '../core/geo.service';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { CRYPTO, DB } from '../core/tokens';
import { filterText } from '../moderation/text-filter';
import { WordListsService } from '../moderation/word-lists.service';
import { EscalationService } from '../notifications/escalation.service';
import { contractState, scannerDecision } from '../legal/rules';
import { PhoneBansService } from '../abuse/phone-bans.service';
import { ProtectionService } from '../abuse/protection.service';
import { NOT_DELIVERABLE, ScannerVerificationService } from '../abuse/verification.service';
import { AlertMediaService, type PhotoOutcome } from '../alert-media/alert-media.service';
import { ScannerRefService } from './scanner-ref.service';

import { normalizeCode } from '../vehicles/tokens.service';

export { normalizeCode };
export const DISPATCH_TOPIC = 'alert.dispatch';

export const FOLLOWUP_TOPIC = 'alert.followup';

export interface ScanContext {
  /** /24 or /48, for limits on the network (report.fake_ip). */
  ipPrefix: string;
  /** /24 or /64, input of the pseudonymous scanner references (abuse protection §0). */
  refPrefix?: string;
  userAgent: string;
  /** Full address, used once for the country lookup and never stored. */
  ip?: string;
}

@Injectable()
export class ScanService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ScannerRefService) private readonly refs: ScannerRefService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(GeoService) private readonly geo: GeoService,
    @Inject(EscalationService) private readonly escalation: EscalationService,
    @Inject(WordListsService) private readonly wordLists: WordListsService,
    @Inject(ProtectionService) private readonly protection: ProtectionService,
    @Inject(PhoneBansService) private readonly phoneBans: PhoneBansService,
    @Inject(ScannerVerificationService) private readonly verification: ScannerVerificationService,
    @Inject(AlertMediaService) private readonly media: AlertMediaService,
  ) {}

  /** The pseudonymous references of this request (server side only, never stored on the device). */
  scannerRefs(token: { tokenId: string }, ctx: ScanContext) {
    return this.refs.compute(ctx.refPrefix ?? ctx.ipPrefix, ctx.userAgent, token.tokenId);
  }

  /**
   * SC-07: what a scan shows is decided by rules.scannerDecision from the tag state and the owner's
   * subscription. Everything that is not "alert" (unknown, in stock, revoked, ended, unpaid after the
   * grace period) returns null and looks identical to the scanner.
   */
  async lookup(rawCode: string) {
    const code = normalizeCode(rawCode);
    if (!code) return null;
    const row = await this.db
      .selectFrom('qr_tokens as t')
      .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('subscriptions')
            .distinctOn('user_id')
            .select(['user_id', 'status', 'cancel_at_period_end', 'past_due_since'])
            .where('status', 'in', ['active', 'past_due'])
            .orderBy('user_id')
            .orderBy('created_at', 'desc')
            .as('s'),
        (j) => j.onRef('s.user_id', '=', 'v.owner_user_id'),
      )
      .select([
        't.id as tokenId',
        't.status',
        't.test_window_until',
        'v.id as vehicleId',
        'v.nickname',
        'v.color',
        'v.owner_user_id as ownerId',
        's.status as subStatus',
        's.cancel_at_period_end as cancelAtPeriodEnd',
        's.past_due_since as pastDueSince',
      ])
      .where('t.code_hash', '=', sha256(code))
      .executeTakeFirst();
    if (!row) return null;
    const page = scannerDecision({
      tag: row.status,
      contract: row.subStatus
        ? contractState({
            status: row.subStatus,
            cancel_at_period_end: row.cancelAtPeriodEnd ?? false,
          })
        : null,
      pastDueSince: row.pastDueSince,
      now: new Date(),
      pastDueGraceDays: await this.settings.get('scanner.past_due_grace_days', 21),
    });
    if (page !== 'alert') return null;
    return {
      tokenId: row.tokenId,
      status: row.status,
      test_window_until: row.test_window_until,
      vehicleId: row.vehicleId,
      nickname: row.nickname,
      color: row.color,
      ownerId: row.ownerId,
    };
  }

  /** AD-07: a pre-printed partner decal nobody has set up yet; the scanner page offers the set-up. */
  async isUnclaimed(rawCode: string): Promise<boolean> {
    const code = normalizeCode(rawCode);
    if (!code) return false;
    const t = await this.db
      .selectFrom('qr_tokens')
      .select('id')
      .where('code_hash', '=', sha256(code))
      .where('vehicle_id', 'is', null)
      .where('batch_id', 'is not', null)
      .where('status', '=', 'in_stock')
      .executeTakeFirst();
    return Boolean(t);
  }

  /** Scanner page data (02-architecture §3 step 1). Never contains the owner's name, plate or number. */
  async pageData(token: NonNullable<Awaited<ReturnType<ScanService['lookup']>>>) {
    const [types, mode, , protection, photos] = await Promise.all([
      this.db
        .selectFrom('alert_types')
        .select(['code', 'severity', 'label_de', 'label_en'])
        .where('is_active', '=', true)
        .orderBy('sort_order')
        .execute(),
      this.db
        .selectFrom('vehicle_modes')
        .select('ends_at')
        .where('vehicle_id', '=', token.vehicleId)
        .where('mode', '=', 'short_stop')
        .where('starts_at', '<=', sql<Date>`now()`)
        .where('ends_at', '>', sql<Date>`now()`)
        .orderBy('ends_at', 'desc')
        .executeTakeFirst(),
      // Decal health (OW-15): remember that the decal is still being scanned.
      this.db
        .updateTable('qr_tokens')
        .set({ last_scanned_at: sql`now()` })
        .where('id', '=', token.tokenId)
        .execute(),
      this.protection.isActive(token.vehicleId),
      // Phase 2: the "Foto hinzufügen" button (feature flag and the owner's plan).
      this.media.available(token.ownerId),
    ]);
    return {
      photos,
      // Abuse protection §4: only the optional phone prompt; nothing says that someone was blocked.
      offerVerification: protection && this.verification.available,
      nickname: token.nickname,
      color: token.color,
      testMode: token.test_window_until !== null && token.test_window_until > new Date(),
      backAt: mode?.ends_at ?? null,
      alertTypes: types.map((t) => ({
        code: t.code,
        severity: t.severity,
        de: t.label_de,
        en: t.label_en,
      })),
    };
  }

  /** US-14/US-15: creates the alert and queues its dispatch in the same transaction (outbox). */
  async createAlert(
    token: NonNullable<Awaited<ReturnType<ScanService['lookup']>>>,
    input: { type: AlertTypeCode; message?: string; lang: 'de' | 'en'; verification?: string },
    ctx: ScanContext,
    photos: Buffer[] = [],
  ): Promise<{ alertId: string; statusToken: string; photos?: PhotoOutcome }> {
    const type = await this.db
      .selectFrom('alert_types')
      .select(['code', 'severity', 'escalates'])
      .where('code', '=', input.type)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!type) throw new UnprocessableEntityException({ error: 'type_unavailable' });
    const message = input.message?.trim() || undefined;
    if (type.code === 'custom' && !message)
      throw new UnprocessableEntityException({ error: 'message_required' });

    const refs = await this.scannerRefs(token, ctx);
    const isTest = token.test_window_until !== null && token.test_window_until > new Date();
    // An expired or foreign verification simply counts as unconfirmed: the alert still goes out.
    const verifiedHash = this.verification.verifiedHash(input.verification, token.tokenId);

    // Abuse protection §3: blocks and bans come before the limits. The sender learns only that the
    // message could not be delivered (no shadow block: in real danger they must look for other help).
    if (
      !isTest &&
      ((await this.isBlocked(token.tokenId, refs)) ||
        (verifiedHash && (await this.phoneBans.isBanned(verifiedHash, token.vehicleId))))
    ) {
      throw new ForbiddenException(NOT_DELIVERABLE);
    }

    const common = {
      qr_token_id: token.tokenId,
      vehicle_id: token.vehicleId,
      alert_type: type.code,
      severity: type.severity,
      scanner_lang: input.lang,
      scanner_ref: refs.scannerRef,
      block_ref: refs.blockRef,
      is_test: isTest,
      scanner_country: this.geo.country(ctx.ip),
      custom_message_enc: message ? this.crypto.encrypt(message) : null,
      key_version: this.crypto.keyVersion,
    };

    // Filtered text never reaches the owner (SC-04). It is kept encrypted for 7 days for the review sample.
    if (message) {
      // AD-10: the live word lists from ops (versioned), not the built-in defaults.
      const verdict = filterText(message, await this.wordLists.forFilter());
      if (!verdict.ok) {
        const blocked = await this.db
          .insertInto('alerts')
          .values({
            ...common,
            status: 'blocked',
            moderation: 'blocked',
            status_view_hash: sha256(randomToken()),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const rate = Number(await this.settings.get('moderation.sample_rate', 0.1));
        // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_insecure_random_generator -- sampling blocked alerts for human review, not a secret
        if (Math.random() < rate) {
          await this.db
            .insertInto('moderation_reviews')
            .values({ alert_id: blocked.id, rule_hit: verdict.reason! })
            .execute();
        }
        throw new UnprocessableEntityException({
          error: 'message_blocked',
          reason: verdict.reason,
        });
      }
    }

    // US-17 / abuse protection §2: per scanner per vehicle (hour and day), per scanner across vehicles,
    // per vehicle from everyone, and per confirmed number per vehicle. Checked after the text filter so
    // a rejected message does not cost the scanner their attempt.
    if (!isTest) {
      const ref = refs.scannerRef.toString('hex');
      const phone = verifiedHash?.toString('hex');
      await this.limits.enforceAll([
        { name: 'alert.scanner_vehicle', subject: `${token.tokenId}:${ref}` },
        { name: 'alert.scanner_vehicle_day', subject: `${token.tokenId}:${ref}` },
        { name: 'alert.scanner_global', subject: ref },
        { name: 'alert.vehicle', subject: token.tokenId },
        ...(phone
          ? ([
              { name: 'alert.phone_vehicle', subject: `${token.tokenId}:${phone}` },
              { name: 'alert.phone_vehicle_day', subject: `${token.tokenId}:${phone}` },
            ] as const)
          : []),
      ]);
    }

    // Abuse protection §4: in Protected Mode the type goes out at once on every channel; the content
    // of an unconfirmed sender is stored but only shown behind "Anzeigen" in the portal.
    const contentHidden =
      !isTest && !verifiedHash && (await this.protection.isActive(token.vehicleId));
    const statusToken = randomToken();
    // 02-architecture §3 step 3: set only for escalating types with a confirmed emergency contact.
    const escalateAt = await this.escalation.initialEscalateAt({
      ownerId: token.ownerId,
      vehicleId: token.vehicleId,
      escalates: type.escalates,
      isTest,
    });
    // Phase 2: photos are checked, re-encoded, encrypted and written only now, after every check above.
    // A photo problem drops the photo, never the alert.
    const prepared = await this.media.prepare({
      ownerId: token.ownerId,
      vehicleId: token.vehicleId,
      isTest,
      photos,
    });
    const create = () =>
      this.db.transaction().execute(async (trx) => {
        const alert = await trx
          .insertInto('alerts')
          .values({
            ...common,
            status: 'dispatched',
            moderation: message ? 'passed' : 'not_required',
            status_view_hash: sha256(statusToken),
            dispatched_at: sql`now()`,
            escalate_at: escalateAt,
            verified_phone_hash: verifiedHash,
            content_hidden: contentHidden,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (isTest) {
          // US-12: the optional test alarm. It proves delivery; the decal worked before it already.
          await trx
            .updateTable('qr_tokens')
            .set({
              test_window_until: null,
              last_test_at: sql`now()`,
              activated_at: sql`coalesce(activated_at, now())`,
            })
            .where('id', '=', token.tokenId)
            .execute();
        }
        await this.media.attach(trx, alert.id, prepared.items);
        await trx
          .insertInto('outbox_events')
          .values({ topic: DISPATCH_TOPIC, payload: JSON.stringify({ alertId: alert.id }) })
          .execute();
        return alert.id;
      });
    let alertId: string;
    try {
      alertId = await create();
    } catch (err) {
      await this.media.discard(prepared.items);
      throw err;
    }
    return {
      alertId,
      statusToken,
      ...(photos.length ? { photos: prepared.outcome } : {}),
    };
  }

  private async isBlocked(
    tokenId: string,
    refs: Awaited<ReturnType<ScannerRefService['compute']>>,
  ) {
    const hit = await this.db
      .selectFrom('scanner_blocks')
      .select('ref')
      .where('expires_at', '>', sql<Date>`now()`)
      .where((eb) =>
        eb.or([
          eb.and([
            eb('qr_token_id', '=', tokenId),
            eb('ref', 'in', [refs.blockRef, refs.blockRefPrevious]),
          ]),
          eb.and([eb('qr_token_id', 'is', null), eb('ref', '=', refs.scannerRef)]),
        ]),
      )
      .executeTakeFirst();
    return Boolean(hit);
  }

  /** US-16: what the scanner may see about their own alert, nothing else. */
  async status(alertId: string, statusToken: string) {
    const a = await this.db
      .selectFrom('alerts')
      .select([
        'id',
        'status',
        'alert_type',
        'is_test',
        'created_at',
        'acknowledged_at',
        'owner_reply',
        'escalated_at',
        'expires_at',
        'scanner_country',
        'scanner_waiting_at',
      ])
      .where('id', '=', alertId)
      .where('status_view_hash', '=', sha256(statusToken))
      .executeTakeFirst();
    if (!a) return null;
    const followupMinutes = Number(await this.settings.get('followup.after_ack_minutes', 15));
    const delivered = await this.db
      .selectFrom('alert_deliveries')
      .select((eb) => eb.fn.min('sent_at').as('at'))
      .where('alert_id', '=', a.id)
      .where('recipient', '=', 'owner')
      .where('status', 'in', ['sent', 'delivered', 'read'])
      .executeTakeFirst();
    let status: AlertStatus = a.status;
    // A silently blocked scanner must not learn that (shadow block): it looks like an unanswered alert.
    if (status === 'blocked') status = 'dispatched';
    const open = status === 'created' || status === 'dispatched' || status === 'delivered';
    if (open && a.expires_at < new Date()) status = 'expired';
    return {
      status,
      type: a.alert_type,
      isTest: a.is_test,
      createdAt: a.created_at,
      deliveredAt: a.status === 'blocked' ? null : (delivered?.at ?? null),
      acknowledgedAt: a.acknowledged_at,
      ownerReply: a.owner_reply,
      escalatedAt: a.escalated_at,
      expiresAt: a.expires_at,
      // The scanner's own country (24 h), so guidance names the right emergency numbers (SC-13).
      country: a.scanner_country,
      // SC-14: "Ich warte noch" becomes available 15 min (configurable) after acknowledgement, once.
      waitingAvailableAt:
        a.status === 'acknowledged' && a.acknowledged_at && !a.scanner_waiting_at
          ? new Date(a.acknowledged_at.getTime() + followupMinutes * 60_000)
          : null,
      waitingSentAt: a.scanner_waiting_at,
    };
  }

  /** SC-14 / NT-09: one reminder to the owner when the scanner is still waiting after acknowledgement. */
  async stillWaiting(
    alertId: string,
    statusToken: string,
  ): Promise<'ok' | 'not_found' | 'not_yet' | 'used'> {
    const followupMinutes = Number(await this.settings.get('followup.after_ack_minutes', 15));
    const escalateMinutes = Number(await this.settings.get('followup.escalate_after_minutes', 5));
    return this.db.transaction().execute(async (trx) => {
      const a = await trx
        .selectFrom('alerts')
        .innerJoin('alert_types as t', 't.code', 'alerts.alert_type')
        .innerJoin('vehicles as v', 'v.id', 'alerts.vehicle_id')
        .select([
          'alerts.id',
          'status',
          'acknowledged_at',
          'scanner_waiting_at',
          'expires_at',
          'is_test',
          'vehicle_id',
          'v.owner_user_id',
          't.escalates',
        ])
        .where('alerts.id', '=', alertId)
        .where('status_view_hash', '=', sha256(statusToken))
        .forUpdate('alerts')
        .executeTakeFirst();
      if (!a) return 'not_found';
      if (a.scanner_waiting_at) return 'used';
      const availableAt = a.acknowledged_at
        ? a.acknowledged_at.getTime() + followupMinutes * 60_000
        : Number.POSITIVE_INFINITY;
      if (a.status !== 'acknowledged' || availableAt > Date.now() || a.expires_at < new Date()) {
        return 'not_yet';
      }
      // SC-14: escalation at most N minutes later unless the owner replies to the reminder, but only
      // for escalating types with a confirmed emergency contact (NT-03).
      const applies =
        a.escalates &&
        !a.is_test &&
        (await this.escalation.hasContact(a.owner_user_id, a.vehicle_id, trx));
      await trx
        .updateTable('alerts')
        .set({
          scanner_waiting_at: sql`now()`,
          ...(applies
            ? {
                escalate_at: sql`CASE WHEN escalated_at IS NULL
                  THEN least(coalesce(escalate_at, 'infinity'::timestamptz), now() + make_interval(mins => ${escalateMinutes}))
                  ELSE escalate_at END`,
              }
            : {}),
        })
        .where('id', '=', a.id)
        .execute();
      await trx
        .insertInto('outbox_events')
        .values({ topic: FOLLOWUP_TOPIC, payload: JSON.stringify({ alertId: a.id }) })
        .execute();
      return 'ok';
    });
  }

  /** SC-15 / US-19: "Aufkleber sieht verdächtig aus" — lands in the abuse centre (AD-08). */
  async reportFake(
    token: NonNullable<Awaited<ReturnType<ScanService['lookup']>>>,
    note: string | undefined,
    ctx: ScanContext,
  ): Promise<void> {
    await this.limits.enforce('report.fake_ip', ctx.ipPrefix);
    await this.db
      .insertInto('abuse_reports')
      .values({
        kind: 'fake_decal',
        qr_token_id: token.tokenId,
        reason: 'fake_decal',
        note: note?.trim().slice(0, 500) || null,
      })
      .execute();
  }
}
