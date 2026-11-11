import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { Logger } from 'pino';
import { RECENT_AUTH_MINUTES, SessionService, type AuthContext } from '../auth/session.service';
import type { Env } from '../config/env';
import type { Db } from '../core/core.module';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO, DB, ENV, LOGGER } from '../core/tokens';
import { MailService } from '../mail/mail.service';
import { textPdf } from '../providers/pdf';
import { PAYMENTS, type Payments } from '../providers/ports';

export const DELETION_GRACE_HOURS = 24;

export type Step = {
  processor: string;
  automated: boolean;
  status: 'pending' | 'done' | 'not_applicable';
  evidence?: string;
};

const uuidToB64 = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url');
const b64ToUuid = (s: string) => {
  const h = Buffer.from(s, 'base64url').toString('hex');
  return h.length === 32
    ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    : null;
};
const fmt = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * GDPR self-service (OW-12, US-32): export (JSON + PDF) and account deletion with a 24 h grace period.
 * Both need a fresh sign-in. Deletion is a data-subject request with one step per processor (AD-11):
 * automated steps run in the worker; the database rows go only once those are done, and manual steps
 * (Zammad, print partner, 360dialog) stay open for ops until completed.
 */
@Injectable()
export class PrivacyService {
  private readonly cancelKey: Buffer;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PAYMENTS) private readonly payments: Payments,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- key comes from env.SESSION_SECRET
    this.cancelKey = createHmac('sha256', Buffer.from(env.SESSION_SECRET, 'base64'))
      .update('parkshield/dsr-cancel/v1')
      .digest();
  }

  requireRecentSignIn(user: AuthContext): void {
    if (Date.now() - user.signedInAt.getTime() > RECENT_AUTH_MINUTES * 60_000) {
      throw new UnauthorizedException({ error: 'reauth_required', minutes: RECENT_AUTH_MINUTES });
    }
  }

  // --- export ---------------------------------------------------------------------------------

  private dec(b: Buffer | null) {
    return b && b.length ? this.crypto.decrypt(b) : null;
  }

  /** Everything we hold about the person, decrypted: it is their own data (Art. 15, 20 GDPR). */
  async collect(userId: string) {
    const db = this.db;
    const u = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const [
      subs,
      vehicles,
      tokens,
      orders,
      alerts,
      deliveries,
      channels,
      push,
      contacts,
      consents,
      rules,
      sessions,
      passkeys,
    ] = await Promise.all([
      db.selectFrom('subscriptions').selectAll().where('user_id', '=', userId).execute(),
      db.selectFrom('vehicles').selectAll().where('owner_user_id', '=', userId).execute(),
      db
        .selectFrom('qr_tokens as t')
        .innerJoin('vehicles as v', 'v.id', 't.vehicle_id')
        .select([
          't.id',
          't.vehicle_id',
          't.code_hint',
          't.status',
          't.cta_header',
          't.activated_at',
          't.last_test_at',
          't.last_scanned_at',
          't.revoked_at',
          't.created_at',
        ])
        .where('v.owner_user_id', '=', userId)
        .execute(),
      db.selectFrom('decal_orders').selectAll().where('user_id', '=', userId).execute(),
      db
        .selectFrom('alerts as a')
        .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
        .select([
          'a.id',
          'a.vehicle_id',
          'a.alert_type',
          'a.severity',
          'a.status',
          'a.is_test',
          'a.custom_message_enc',
          'a.owner_reply',
          'a.acknowledged_at',
          'a.escalated_at',
          'a.created_at',
        ])
        .where('v.owner_user_id', '=', userId)
        .execute(),
      db
        .selectFrom('alert_deliveries as d')
        .innerJoin('alerts as a', 'a.id', 'd.alert_id')
        .innerJoin('vehicles as v', 'v.id', 'a.vehicle_id')
        .select([
          'd.alert_id',
          'd.recipient',
          'd.channel',
          'd.status',
          'd.suppressed_reason',
          'd.queued_at',
          'd.sent_at',
        ])
        .where('v.owner_user_id', '=', userId)
        .execute(),
      db.selectFrom('contact_channels').selectAll().where('user_id', '=', userId).execute(),
      db
        .selectFrom('push_subscriptions')
        .select(['platform', 'device_label', 'created_at', 'last_ok_at'])
        .where('user_id', '=', userId)
        .execute(),
      db.selectFrom('emergency_contacts').selectAll().where('user_id', '=', userId).execute(),
      db.selectFrom('consents').selectAll().where('user_id', '=', userId).execute(),
      db.selectFrom('notification_rules').selectAll().where('user_id', '=', userId).execute(),
      db
        .selectFrom('sessions')
        .select(['user_agent', 'created_at', 'expires_at', 'revoked_at'])
        .where('user_id', '=', userId)
        .execute(),
      db
        .selectFrom('webauthn_credentials')
        .select(['label', 'created_at', 'last_used_at'])
        .where('user_id', '=', userId)
        .execute(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      account: {
        email: u.email,
        emailVerifiedAt: fmt(u.email_verified_at),
        displayName: u.display_name,
        language: u.preferred_lang,
        timezone: u.timezone,
        summaryFrequency: u.summary_frequency,
        escalationMinutes: u.escalation_minutes,
        createdAt: fmt(u.created_at),
      },
      subscriptions: subs.map((s) => ({
        plan: s.plan,
        status: s.status,
        contractNo: s.contract_no,
        currentPeriodStart: fmt(s.current_period_start),
        currentPeriodEnd: fmt(s.current_period_end),
        canceledAt: fmt(s.canceled_at),
      })),
      vehicles: vehicles.map((v) => ({
        id: v.id,
        nickname: v.nickname,
        plate: this.dec(v.plate_enc),
        makeModel: v.make_model,
        color: v.color,
        createdAt: fmt(v.created_at),
      })),
      decals: tokens.map((t) => ({
        vehicleId: t.vehicle_id,
        codeEndsWith: t.code_hint,
        status: t.status,
        header: t.cta_header,
        activatedAt: fmt(t.activated_at),
        lastTestAt: fmt(t.last_test_at),
        lastScannedAt: fmt(t.last_scanned_at),
        revokedAt: fmt(t.revoked_at),
      })),
      orders: orders.map((o) => ({
        status: o.status,
        totalCents: o.total_gross_cents,
        createdAt: fmt(o.created_at),
        shippedAt: fmt(o.shipped_at),
        deliveredAt: fmt(o.delivered_at),
        trackingNumber: o.tracking_number,
        shippingAddress: this.dec(o.shipping_address_enc),
      })),
      alerts: alerts.map((a) => ({
        id: a.id,
        vehicleId: a.vehicle_id,
        type: a.alert_type,
        severity: a.severity,
        status: a.status,
        isTest: a.is_test,
        message: this.dec(a.custom_message_enc),
        ownerReply: a.owner_reply,
        acknowledgedAt: fmt(a.acknowledged_at),
        escalatedAt: fmt(a.escalated_at),
        createdAt: fmt(a.created_at),
        deliveries: deliveries
          .filter((d) => d.alert_id === a.id)
          .map((d) => ({
            recipient: d.recipient,
            channel: d.channel,
            status: d.status,
            reason: d.suppressed_reason,
            queuedAt: fmt(d.queued_at),
            sentAt: fmt(d.sent_at),
          })),
      })),
      channels: {
        email: u.email,
        whatsapp: channels
          .filter((c) => c.type === 'whatsapp' && c.address_enc)
          .map((c) => ({
            phone: this.dec(c.address_enc),
            verifiedAt: fmt(c.verified_at),
            optedInAt: fmt(c.opted_in_at),
          })),
        order: channels.map((c) => ({ type: c.type, priority: c.priority })),
        pushDevices: push.map((p) => ({
          platform: p.platform,
          label: p.device_label,
          createdAt: fmt(p.created_at),
          lastOkAt: fmt(p.last_ok_at),
        })),
      },
      emergencyContacts: contacts.map((c) => ({
        name: c.display_name,
        email: this.dec(c.address_enc),
        vehicleId: c.vehicle_id,
        consent: c.consent,
        requestedAt: fmt(c.consent_requested_at),
        decidedAt: fmt(c.consent_decided_at),
      })),
      consents: consents.map((c) => ({
        purpose: c.purpose,
        version: c.doc_version,
        grantedAt: fmt(c.granted_at),
        withdrawnAt: fmt(c.withdrawn_at),
      })),
      quietHours: rules.map((r) => ({
        start: r.quiet_start,
        end: r.quiet_end,
        daysMask: r.days_mask,
        urgentBypass: r.urgent_override,
      })),
      signIns: sessions.map((s) => ({
        device: s.user_agent,
        at: fmt(s.created_at),
        endedAt: fmt(s.revoked_at ?? s.expires_at),
      })),
      passkeys: passkeys.map((p) => ({
        label: p.label,
        createdAt: fmt(p.created_at),
        lastUsedAt: fmt(p.last_used_at),
      })),
      notes: [
        'Invoices are issued and kept by our payment provider Stripe (statutory retention 8 years).',
        'Scanner data is pseudonymous and deleted after 24 hours or 30 days; it is not linked to you.',
      ],
    };
  }

  private async logExport(user: AuthContext, format: 'json' | 'pdf') {
    await this.db
      .insertInto('data_subject_requests')
      .values({
        user_id: user.userId,
        type: 'access_export',
        status: 'completed',
        identity_verified_at: sql`now()`,
        verification_method: 'session_reauth',
        completed_at: sql`now()`,
      })
      .execute();
    await this.db
      .insertInto('audit_logs')
      .values({
        actor_id: user.userId,
        actor_kind: 'customer',
        action: 'dsr.export',
        entity: 'users',
        entity_id: user.userId,
        meta: JSON.stringify({ format }),
      })
      .execute();
  }

  async exportJson(user: AuthContext) {
    this.requireRecentSignIn(user);
    const data = await this.collect(user.userId);
    await this.logExport(user, 'json');
    return data;
  }

  async exportPdf(user: AuthContext): Promise<Buffer> {
    this.requireRecentSignIn(user);
    const data = await this.collect(user.userId);
    await this.logExport(user, 'pdf');
    const lines: string[] = [`Erstellt am / created: ${data.exportedAt}`, ''];
    const section = (title: string, value: unknown) => {
      lines.push(`# ${title}`);
      const walk = (v: unknown, prefix: string) => {
        if (Array.isArray(v)) {
          if (!v.length) lines.push(`${prefix}-`);
          v.forEach((item, i) => walk(item, `${prefix}${i + 1}. `));
        } else if (v && typeof v === 'object') {
          for (const [k, val] of Object.entries(v)) {
            if (val && typeof val === 'object') {
              lines.push(`${prefix}${k}:`);
              walk(val, '    ');
            } else lines.push(`${prefix}${k}: ${val ?? '-'}`);
          }
        } else lines.push(`${prefix}${String(v)}`);
      };
      walk(value, '');
      lines.push('');
    };
    for (const [k, v] of Object.entries(data)) if (k !== 'exportedAt') section(k, v);
    return textPdf('ParkShield - Ihre Daten / your data', lines);
  }

  // --- deletion -------------------------------------------------------------------------------

  /** Links bound to one request: "cancel deletion" and "confirm it is me" (AD-11 identity check). */
  private dsrToken(dsrId: string, purpose: 'cancel' | 'verify') {
    const mac = createHmac('sha256', this.cancelKey)
      .update(`${purpose}:${dsrId}`)
      .digest('base64url');
    return `${uuidToB64(dsrId)}${mac}`;
  }

  private parseDsrToken(token: string, purpose: 'cancel' | 'verify'): string | null {
    if (token.length !== 22 + 43) return null;
    const id = b64ToUuid(token.slice(0, 22));
    if (!id) return null;
    const a = Buffer.from(this.dsrToken(id, purpose));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b) ? id : null;
  }

  /** One step per processor (AD-11); what does not apply to this person is marked as such. */
  async stepsFor(
    db: Db,
    userId: string | null,
    type: 'erasure' | 'access_export' | string,
  ): Promise<Step[]> {
    const [u, hasWhatsApp, hasOrders] = userId
      ? await Promise.all([
          db
            .selectFrom('users')
            .select('stripe_customer_id')
            .where('id', '=', userId)
            .executeTakeFirst(),
          db
            .selectFrom('contact_channels')
            .select('id')
            .where('user_id', '=', userId)
            .where('type', '=', 'whatsapp')
            .executeTakeFirst(),
          db
            .selectFrom('decal_orders')
            .select('id')
            .where('user_id', '=', userId)
            .executeTakeFirst(),
        ])
      : [undefined, undefined, undefined];
    const na = (applies: unknown): 'pending' | 'not_applicable' =>
      applies ? 'pending' : 'not_applicable';
    return [
      {
        processor: 'parkshield_db',
        automated: type === 'erasure',
        status: userId ? 'pending' : 'not_applicable',
      },
      { processor: 'stripe', automated: type === 'erasure', status: na(u?.stripe_customer_id) },
      // Transactional mail only: Brevo keeps no contact list for us, only 30-day logs.
      { processor: 'brevo', automated: type === 'erasure', status: 'pending' },
      {
        processor: 'sentry',
        automated: true,
        status: 'done',
        evidence: 'no personal data sent (scrubbed at source)',
      },
      { processor: '360dialog', automated: false, status: na(hasWhatsApp) },
      { processor: 'print_partner', automated: false, status: na(hasOrders) },
      { processor: 'zammad', automated: false, status: 'pending' },
    ];
  }

  async insertSteps(db: Db, dsrId: string, steps: Step[]) {
    await db
      .insertInto('dsr_processor_steps')
      .values(
        steps.map((s) => ({
          dsr_id: dsrId,
          processor: s.processor,
          automated: s.automated,
          status: s.status,
          evidence_ref: s.evidence ?? null,
          completed_at: s.status === 'done' ? sql<Date>`now()` : null,
        })),
      )
      .execute();
  }

  /**
   * Starts the erasure for a verified request: codes off at once, signed out everywhere, 24 h grace
   * period with a cancel link, then the worker's processor steps (processDue).
   */
  private async beginErasure(userId: string, dsrId: string): Promise<Date> {
    const due = new Date(Date.now() + DELETION_GRACE_HOURS * 3600_000);
    const u = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('users')
        .select(['status', 'email', 'preferred_lang'])
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (row.status === 'pending_deletion')
        throw new ConflictException({ error: 'already_requested' });
      await trx
        .updateTable('users')
        .set({ status: 'pending_deletion', deletion_due_at: due })
        .where('id', '=', userId)
        .execute();
      // Codes stop working at once (US-32): nobody can reach this person through a decal any more.
      await trx
        .updateTable('qr_tokens')
        .set({ status: 'revoked', revoked_at: sql`now()`, revoke_reason: 'account_deletion' })
        .where('status', '<>', 'revoked')
        .where(
          'vehicle_id',
          'in',
          trx.selectFrom('vehicles').select('id').where('owner_user_id', '=', userId),
        )
        .execute();
      return row;
    });
    await this.sessions.revokeAll(userId);
    await this.mail.send({
      to: u.email,
      template: 'deletion_requested',
      locale: u.preferred_lang,
      values: { due },
      actionUrl: `${this.env.WEB_BASE_URL}/konto-loeschen-abbrechen#t=${this.dsrToken(dsrId, 'cancel')}`,
    });
    return due;
  }

  async requestDeletion(user: AuthContext): Promise<{ deletionDueAt: Date }> {
    this.requireRecentSignIn(user);
    const current = await this.db
      .selectFrom('users')
      .select('status')
      .where('id', '=', user.userId)
      .executeTakeFirstOrThrow();
    if (current.status === 'pending_deletion')
      throw new ConflictException({ error: 'already_requested' });
    const steps = await this.stepsFor(this.db, user.userId, 'erasure');
    const dsrId = await this.db.transaction().execute(async (trx) => {
      const dsr = await trx
        .insertInto('data_subject_requests')
        .values({
          user_id: user.userId,
          email_bidx: this.crypto.blindIndex(user.email.toLowerCase()),
          type: 'erasure',
          status: 'in_progress',
          identity_verified_at: sql`now()`,
          verification_method: 'session_reauth',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.insertSteps(trx, dsr.id, steps);
      return dsr.id;
    });
    return { deletionDueAt: await this.beginErasure(user.userId, dsrId) };
  }

  // --- requests received by support (ops GDPR queue, US-37) -------------------------------------

  /** Sends the "confirm it is you" link for a request created by support. */
  async sendVerification(dsrId: string, email: string, lang: 'de' | 'en'): Promise<void> {
    await this.mail.send({
      to: email,
      template: 'dsr_verify',
      locale: lang,
      values: {},
      actionUrl: `${this.env.WEB_BASE_URL}/datenschutz-anfrage#t=${this.dsrToken(dsrId, 'verify')}`,
    });
  }

  /** Public: the person confirms the request from their own mailbox (verification method email_link). */
  async confirmIdentity(token: string): Promise<{ type: string }> {
    const dsrId = this.parseDsrToken(token, 'verify');
    if (!dsrId) throw new NotFoundException({ error: 'link_invalid' });
    return this.identityVerified(dsrId, 'email_link');
  }

  /** After identity is verified (link or manual check by ops): start what the request asks for. */
  async identityVerified(
    dsrId: string,
    method: 'email_link' | 'manual',
    note?: string,
  ): Promise<{ type: string }> {
    const r = await this.db
      .updateTable('data_subject_requests')
      .set({
        identity_verified_at: sql`now()`,
        verification_method: method,
        status: 'in_progress',
        ...(note ? { note: note.slice(0, 500) } : {}),
      })
      .where('id', '=', dsrId)
      .where('status', 'in', ['received', 'awaiting_identity'])
      .returning(['id', 'type', 'user_id'])
      .executeTakeFirst();
    if (!r) throw new NotFoundException({ error: 'link_invalid' });
    if (r.user_id && r.type === 'erasure') await this.beginErasure(r.user_id, r.id);
    if (r.user_id && r.type === 'access_export') {
      // The copy is provided through the self-service export (JSON + PDF) after signing in.
      const u = await this.db
        .selectFrom('users')
        .select(['email', 'preferred_lang'])
        .where('id', '=', r.user_id)
        .executeTakeFirstOrThrow();
      await this.mail.send({
        to: u.email,
        template: 'dsr_export_ready',
        locale: u.preferred_lang,
        actionUrl: `${this.env.WEB_BASE_URL}/konto/daten`,
      });
      await this.setStep(r.id, 'parkshield_db', 'done', 'self-service export offered by e-mail');
    }
    return { type: r.type };
  }

  /** Within the 24 h grace period, the link in the confirmation e-mail keeps the account. */
  async cancelDeletion(token: string): Promise<void> {
    const dsrId = this.parseDsrToken(token, 'cancel');
    if (!dsrId) throw new NotFoundException({ error: 'link_invalid' });
    const ok = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .selectFrom('data_subject_requests as r')
        .innerJoin('users as u', 'u.id', 'r.user_id')
        .select(['r.id', 'u.id as userId'])
        .where('r.id', '=', dsrId)
        .where('r.type', '=', 'erasure')
        .where('r.status', '=', 'in_progress')
        .where('u.status', '=', 'pending_deletion')
        .where('u.deletion_due_at', '>', sql<Date>`now()`)
        .executeTakeFirst();
      if (!r) return false;
      await trx
        .updateTable('users')
        .set({ status: 'active', deletion_due_at: null })
        .where('id', '=', r.userId)
        .execute();
      await trx
        .updateTable('data_subject_requests')
        .set({ status: 'rejected', completed_at: sql`now()` })
        .where('id', '=', r.id)
        .execute();
      return true;
    });
    if (!ok) throw new NotFoundException({ error: 'link_invalid' });
  }

  /** Worker job: automated processor steps, then the database, for every deletion that is due. */
  async processDue(): Promise<number> {
    const due = await this.db
      .selectFrom('data_subject_requests as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.id', 'u.id as userId', 'u.email', 'u.preferred_lang', 'u.stripe_customer_id'])
      .where('r.type', '=', 'erasure')
      .where('r.status', '=', 'in_progress')
      .where('u.status', '=', 'pending_deletion')
      .where('u.deletion_due_at', '<=', sql<Date>`now()`)
      .limit(50)
      .execute();
    let deleted = 0;
    for (const r of due) {
      try {
        if (await this.runSteps(r)) deleted++;
      } catch (err) {
        this.logger.error({ err: String(err) }, 'account deletion step failed; retried next run');
      }
    }
    return deleted;
  }

  private async setStep(
    dsrId: string,
    processor: string,
    status: 'done' | 'failed',
    evidence: string,
  ) {
    await this.db
      .updateTable('dsr_processor_steps')
      .set({
        status,
        evidence_ref: evidence.slice(0, 200),
        completed_at: status === 'done' ? sql`now()` : null,
      })
      .where('dsr_id', '=', dsrId)
      .where('processor', '=', processor)
      .execute();
  }

  private async runSteps(r: {
    id: string;
    userId: string;
    email: string;
    preferred_lang: 'de' | 'en';
    stripe_customer_id: string | null;
  }): Promise<boolean> {
    const steps = await this.db
      .selectFrom('dsr_processor_steps')
      .select(['processor', 'status', 'automated'])
      .where('dsr_id', '=', r.id)
      .execute();
    const open = (p: string) =>
      steps.some((s) => s.processor === p && (s.status === 'pending' || s.status === 'failed'));

    if (open('stripe') && r.stripe_customer_id) {
      try {
        const { reference } = await this.payments.deleteCustomer(r.stripe_customer_id);
        await this.setStep(r.id, 'stripe', 'done', reference);
      } catch (err) {
        await this.setStep(r.id, 'stripe', 'failed', String(err));
        throw err;
      }
    }
    if (open('brevo'))
      await this.setStep(r.id, 'brevo', 'done', 'transactional only: no contact stored');

    // The last automated step: tell the person, then remove the rows (cascades to everything theirs).
    await this.mail
      .send({ to: r.email, template: 'account_deleted', locale: r.preferred_lang })
      .catch((err: unknown) =>
        this.logger.warn({ err: String(err) }, 'account_deleted mail failed'),
      );
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('dsr_processor_steps')
        .set({
          status: 'done',
          evidence_ref: 'users row and cascades deleted',
          completed_at: sql`now()`,
        })
        .where('dsr_id', '=', r.id)
        .where('processor', '=', 'parkshield_db')
        .execute();
      await trx.deleteFrom('users').where('id', '=', r.userId).execute();
      // Closes only when the manual steps (ops, AD-11) are done too.
      await trx
        .updateTable('data_subject_requests')
        .set({ status: 'completed', completed_at: sql`now()` })
        .where('id', '=', r.id)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('dsr_processor_steps')
                .select('dsr_id')
                .where('dsr_id', '=', r.id)
                .where('status', 'in', ['pending', 'failed']),
            ),
          ),
        )
        .execute();
    });
    return true;
  }
}
