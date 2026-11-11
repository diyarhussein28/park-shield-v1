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
import type { DsrType } from '../db/types.generated';
import { MailService } from '../mail/mail.service';
import { PrivacyService } from '../privacy/privacy.service';
import { StaffService, type StaffContext } from './staff.service';

const DUE_SOON_DAYS = 7;

/**
 * GDPR request queue (AD-11, US-37): 30-day deadline with a reminder 7 days before, identity check
 * before anything is exported or erased, one step per processor, and no closing while a step is open.
 * Requests made in the portal arrive here verified (fresh sign-in); others are entered by support.
 */
@Injectable()
export class DsrService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(CRYPTO) private readonly crypto: FieldCrypto,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
    @Inject(StaffService) private readonly staff: StaffService,
  ) {}

  private daysLeft(due: Date) {
    return Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  }

  async list() {
    const rows = await this.db
      .selectFrom('data_subject_requests as r')
      .leftJoin('users as u', 'u.id', 'r.user_id')
      .select([
        'r.id',
        'r.type',
        'r.status',
        'r.due_at',
        'r.created_at',
        'r.completed_at',
        'r.identity_verified_at',
        'r.verification_method',
        'u.email',
      ])
      .select((eb) => [
        eb
          .selectFrom('dsr_processor_steps as s')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('s.dsr_id', '=', 'r.id')
          .as('steps'),
        eb
          .selectFrom('dsr_processor_steps as s')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('s.dsr_id', '=', 'r.id')
          .where('s.status', 'in', ['done', 'not_applicable'])
          .as('stepsDone'),
      ])
      // Self-service exports are completed at once; the queue shows them only for 30 days.
      .where((eb) =>
        eb.or([
          eb('r.status', 'not in', ['completed', 'rejected']),
          eb('r.completed_at', '>', sql<Date>`now() - interval '30 days'`),
        ]),
      )
      .orderBy('r.due_at')
      .limit(200)
      .execute();
    return {
      requests: rows.map((r) => {
        const open = !['completed', 'rejected'].includes(r.status);
        const days = this.daysLeft(r.due_at);
        return {
          id: r.id,
          type: r.type,
          status: r.status,
          email: r.email,
          dueAt: r.due_at,
          daysLeft: days,
          dueSoon: open && days <= DUE_SOON_DAYS,
          overdue: open && days < 0,
          verified: Boolean(r.identity_verified_at),
          verificationMethod: r.verification_method,
          steps: Number(r.steps ?? 0),
          stepsDone: Number(r.stepsDone ?? 0),
          createdAt: r.created_at,
          completedAt: r.completed_at,
        };
      }),
    };
  }

  async get(by: StaffContext, id: string) {
    const r = await this.db
      .selectFrom('data_subject_requests as r')
      .leftJoin('users as u', 'u.id', 'r.user_id')
      .select([
        'r.id',
        'r.type',
        'r.status',
        'r.due_at',
        'r.created_at',
        'r.completed_at',
        'r.identity_verified_at',
        'r.verification_method',
        'r.note',
        'r.user_id',
        'u.email',
        'u.status as userStatus',
        'u.deletion_due_at',
      ])
      .where('r.id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException();
    const steps = await this.db
      .selectFrom('dsr_processor_steps')
      .select(['processor', 'status', 'automated', 'evidence_ref', 'completed_at'])
      .where('dsr_id', '=', id)
      .orderBy('processor')
      .execute();
    await this.staff.auditRead(by.userId, 'dsr.view', 'data_subject_requests', id);
    return {
      request: {
        id: r.id,
        type: r.type,
        status: r.status,
        customerId: r.user_id,
        email: r.email,
        accountStatus: r.userStatus,
        deletionDueAt: r.deletion_due_at,
        dueAt: r.due_at,
        daysLeft: this.daysLeft(r.due_at),
        createdAt: r.created_at,
        completedAt: r.completed_at,
        verifiedAt: r.identity_verified_at,
        verificationMethod: r.verification_method,
        note: r.note,
      },
      steps: steps.map((s) => ({
        processor: s.processor,
        status: s.status,
        automated: s.automated,
        evidence: s.evidence_ref,
        completedAt: s.completed_at,
      })),
    };
  }

  /** A request received by e-mail, letter or phone. The person must confirm it from their mailbox. */
  async create(by: StaffContext, input: { type: DsrType; email: string; note?: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'preferred_lang'])
      .where('email', '=', email)
      .where('kind', '=', 'customer')
      .executeTakeFirst();
    const steps = await this.privacy.stepsFor(this.db, user?.id ?? null, input.type);
    const id = await this.db.transaction().execute(async (trx) => {
      const r = await trx
        .insertInto('data_subject_requests')
        .values({
          user_id: user?.id ?? null,
          email_bidx: this.crypto.blindIndex(email),
          type: input.type,
          status: 'awaiting_identity',
          handled_by: by.userId,
          note: input.note?.slice(0, 500) ?? null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.privacy.insertSteps(trx, r.id, steps);
      return r.id;
    });
    await this.privacy.sendVerification(id, email, user?.preferred_lang ?? 'de');
    await this.staff.audit(by.userId, 'dsr.create', 'data_subject_requests', id, {
      type: input.type,
      account: Boolean(user),
    });
    return { id, accountFound: Boolean(user) };
  }

  /** Resend the confirmation link. The address must match the one the request was made for. */
  async resend(by: StaffContext, id: string, email: string) {
    const r = await this.db
      .selectFrom('data_subject_requests')
      .select(['email_bidx', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException();
    if (r.status !== 'awaiting_identity')
      throw new ConflictException({ error: 'already_verified' });
    if (!r.email_bidx || !r.email_bidx.equals(this.crypto.blindIndex(email.trim().toLowerCase()))) {
      throw new BadRequestException({ error: 'email_mismatch' });
    }
    await this.privacy.sendVerification(id, email.trim().toLowerCase(), 'de');
    await this.staff.audit(by.userId, 'dsr.resend_verification', 'data_subject_requests', id);
  }

  /** Identity checked another way (e.g. a signed letter): the note says how. */
  async verifyManually(by: StaffContext, id: string, note: string) {
    await this.privacy.identityVerified(id, 'manual', note);
    await this.staff.audit(by.userId, 'dsr.verify_manual', 'data_subject_requests', id);
  }

  async setStep(
    by: StaffContext,
    id: string,
    processor: string,
    status: 'done' | 'not_applicable',
    evidence: string,
  ) {
    const r = await this.db
      .selectFrom('data_subject_requests')
      .select(['identity_verified_at', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException();
    if (!r.identity_verified_at) throw new ConflictException({ error: 'identity_not_verified' });
    if (['completed', 'rejected'].includes(r.status))
      throw new ConflictException({ error: 'closed' });
    const step = await this.db
      .selectFrom('dsr_processor_steps')
      .select(['automated', 'status'])
      .where('dsr_id', '=', id)
      .where('processor', '=', processor)
      .executeTakeFirst();
    if (!step) throw new NotFoundException();
    // The database itself is deleted by the worker after the grace period, never by a click.
    if (processor === 'parkshield_db' && status === 'done')
      throw new ConflictException({ error: 'automated_step' });
    await this.db
      .updateTable('dsr_processor_steps')
      .set({ status, evidence_ref: evidence.slice(0, 200), completed_at: sql`now()` })
      .where('dsr_id', '=', id)
      .where('processor', '=', processor)
      .execute();
    await this.staff.audit(by.userId, 'dsr.step', 'data_subject_requests', id, {
      processor,
      status,
    });
  }

  async close(by: StaffContext, id: string) {
    const open = await this.db
      .selectFrom('dsr_processor_steps')
      .select('processor')
      .where('dsr_id', '=', id)
      .where('status', 'in', ['pending', 'failed'])
      .execute();
    if (open.length)
      throw new ConflictException({ error: 'steps_open', steps: open.map((s) => s.processor) });
    const r = await this.db
      .updateTable('data_subject_requests')
      .set({ status: 'completed', completed_at: sql`now()`, handled_by: by.userId })
      .where('id', '=', id)
      .where('identity_verified_at', 'is not', null)
      .where('status', 'not in', ['completed', 'rejected'])
      .executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new ConflictException({ error: 'cannot_close' });
    await this.staff.audit(by.userId, 'dsr.close', 'data_subject_requests', id);
  }

  async reject(by: StaffContext, id: string, reason: string) {
    const r = await this.db
      .updateTable('data_subject_requests')
      .set({
        status: 'rejected',
        completed_at: sql`now()`,
        handled_by: by.userId,
        note: reason.slice(0, 500),
      })
      .where('id', '=', id)
      .where('status', 'in', ['received', 'awaiting_identity'])
      .executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new ConflictException({ error: 'cannot_reject' });
    await this.staff.audit(by.userId, 'dsr.reject', 'data_subject_requests', id);
  }

  /** Worker job: one reminder to the privacy team per request, 7 days before the deadline. */
  async remindDueSoon(): Promise<number> {
    const due = await this.db
      .updateTable('data_subject_requests')
      .set({ reminded_at: sql`now()` })
      .where('status', 'not in', ['completed', 'rejected'])
      .where('reminded_at', 'is', null)
      .where('due_at', '<=', sql<Date>`now() + make_interval(days => ${DUE_SOON_DAYS})`)
      .returning(['id', 'type', 'due_at'])
      .execute();
    if (!due.length) return 0;
    const to = String(await this.settings.get('ops.alert_email', 'datenschutz@parkshield.de'));
    await this.mail.send({
      to,
      template: 'dsr_due_soon',
      locale: 'de',
      values: {
        count: due.length,
        first: due.map((d) => d.due_at).sort((a, b) => a.getTime() - b.getTime())[0]!,
      },
      actionUrl: `${this.env.OPS_BASE_URL}/datenschutz`,
    });
    return due.length;
  }
}
