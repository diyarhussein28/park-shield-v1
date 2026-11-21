import { sql } from 'kysely';

/**
 * Why pending escalation steps were cancelled (owner decision 2026-11-21). Each of these is a stop
 * condition: the owner reacted. Merely viewing the alert (`seen_at`) is NOT one.
 */
export type StopReason = 'acknowledged' | 'replied' | 'chat_opened' | 'blocked' | 'resolved';

/**
 * Columns to set (in the same UPDATE as the owner's action) so that no reminder push and no SMS is
 * sent any more. The sweepers also check `escalation_stopped_at`, so a step that is already queued
 * but not yet sent is dropped too.
 */
export function stopEscalation(reason: StopReason) {
  return {
    remind_at: null,
    sms_due_at: null,
    escalation_stopped_at: sql<Date>`coalesce(escalation_stopped_at, now())`,
    escalation_stop_reason: sql<string>`coalesce(escalation_stop_reason, ${reason})`,
  };
}
