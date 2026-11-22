import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Db } from '../core/core.module';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';
import { stopEscalation, type StopReason } from './escalation';

export const REMIND_TOPIC = 'alert.remind';
export const SMS_ESCALATE_TOPIC = 'alert.sms_escalate';

/** Defaults of `escalation.reminder_minutes` and `escalation.sms_minutes` (settings registry). */
export const REMINDER_MINUTES_DEFAULT = 10;
export const SMS_MINUTES_DEFAULT = 30;

/** The open states in which an alert can still escalate. */
const OPEN = sql`status IN ('dispatched', 'delivered')`;

/**
 * Escalation (owner decision 2026-11-21): when the owner has not reacted, a reminder push follows after
 * `escalation.reminder_minutes` (10) and ONE SMS to the verified number after `escalation.sms_minutes`
 * (30, counted from the alert). Never more than one SMS per alert; test alerts never send an SMS.
 *
 * Stop conditions (any of them cancels every pending step): „Ich komme“, any other reply, opening the
 * chat, blocking the sender, marking the alert resolved and (since 2026-11-22) opening the alert.
 *
 * Reliability: the due times are columns (source of truth). The worker sweeps them every few seconds;
 * one statement marks the step as done and queues its outbox event (FOR UPDATE SKIP LOCKED), so there is
 * never a double reminder or a second SMS, also after a Valkey restart or with several workers. A step
 * missed while the worker was down is picked up by the next sweep.
 */
@Injectable()
export class OwnerReminderService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Due times for a new alert. */
  async initialTimes(
    isTest: boolean,
    now = new Date(),
  ): Promise<{ remindAt: Date | null; smsDueAt: Date | null }> {
    const reminder = Number(
      await this.settings.get('escalation.reminder_minutes', REMINDER_MINUTES_DEFAULT),
    );
    const sms = Number(await this.settings.get('escalation.sms_minutes', SMS_MINUTES_DEFAULT));
    return {
      remindAt: reminder > 0 ? new Date(now.getTime() + reminder * 60_000) : null,
      // Owner decision 2026-11-21: test alerts never send an SMS.
      smsDueAt: !isTest && sms > 0 ? new Date(now.getTime() + sms * 60_000) : null,
    };
  }

  /** Cancels every pending step of one alert (a stop condition). Idempotent. */
  async stop(alertId: string, reason: StopReason, executor: Db = this.db): Promise<void> {
    await executor
      .updateTable('alerts')
      .set(stopEscalation(reason))
      .where('id', '=', alertId)
      .execute();
  }

  /** Reminder push: due, nobody reacted, not stopped. */
  async sweep(): Promise<number> {
    const rows = await sql<{ id: string }>`
      WITH due AS (
        UPDATE alerts SET reminded_at = now(), remind_at = NULL,
               escalation_stage = CASE WHEN escalation_stage = 'none' THEN 'reminder_sent'::escalation_stage
                                       ELSE escalation_stage END
         WHERE id IN (
           SELECT id FROM alerts
            WHERE reminded_at IS NULL AND remind_at <= now() AND expires_at > now()
              AND owner_reply IS NULL AND acknowledged_by IS NULL AND escalation_stopped_at IS NULL
              AND ${OPEN}
            ORDER BY remind_at LIMIT 200 FOR UPDATE SKIP LOCKED)
         RETURNING id)
      INSERT INTO outbox_events (topic, payload)
      SELECT ${REMIND_TOPIC}, jsonb_build_object('alertId', id) FROM due
      RETURNING id`.execute(this.db);
    return rows.rows.length;
  }

  /** The single escalation SMS: due, nobody reacted, not stopped, never sent before. */
  async sweepSms(): Promise<number> {
    const rows = await sql<{ id: string }>`
      WITH due AS (
        UPDATE alerts SET sms_sent_at = now(), sms_due_at = NULL, escalation_stage = 'sms_sent'
         WHERE id IN (
           SELECT id FROM alerts
            WHERE sms_sent_at IS NULL AND sms_due_at <= now() AND expires_at > now()
              AND NOT is_test
              AND owner_reply IS NULL AND acknowledged_by IS NULL AND escalation_stopped_at IS NULL
              AND ${OPEN}
            ORDER BY sms_due_at LIMIT 200 FOR UPDATE SKIP LOCKED)
         RETURNING id)
      INSERT INTO outbox_events (topic, payload)
      SELECT ${SMS_ESCALATE_TOPIC}, jsonb_build_object('alertId', id) FROM due
      RETURNING id`.execute(this.db);
    return rows.rows.length;
  }
}
