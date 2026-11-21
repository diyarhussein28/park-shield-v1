-- migrate:up
-- Owner decisions 2026-11-21: alerts reach the owner by app push only (no alert e-mail). Without a
-- reaction, a reminder push follows after 10 minutes and one single SMS to the owner's verified number
-- after 30 minutes. Escalation to trusted contacts is gone, and so are their data.
--
-- Due times live in the database (the source of truth); the worker sweeps them every few seconds and
-- marks the step in the same statement that queues it, so a step is never sent twice.

CREATE TYPE escalation_stage AS ENUM ('none', 'reminder_sent', 'sms_sent');

ALTER TABLE alerts
  ADD COLUMN escalation_stage       escalation_stage NOT NULL DEFAULT 'none',
  ADD COLUMN sms_due_at             timestamptz,
  ADD COLUMN sms_sent_at            timestamptz,
  -- Why the pending steps were cancelled: acknowledged, replied, chat_opened, blocked, resolved.
  ADD COLUMN escalation_stopped_at  timestamptz,
  ADD COLUMN escalation_stop_reason varchar(20),
  -- „Erledigt“ in the app (a stop condition).
  ADD COLUMN resolved_at            timestamptz;

UPDATE alerts SET escalation_stage = 'reminder_sent' WHERE reminded_at IS NOT NULL;
-- The contact chain is gone: nothing is due there any more.
UPDATE alerts SET escalate_at = NULL WHERE escalate_at IS NOT NULL;

CREATE INDEX alerts_sms_due_idx ON alerts(sms_due_at)
  WHERE sms_sent_at IS NULL AND sms_due_at IS NOT NULL;

-- Trusted contacts (owner decision 2026-11-21: removed completely). The rows are deleted now; the empty
-- table stays for the retention function and the metrics views until a later clean-up migration.
-- TODO [LEGAL REVIEW] Contacts were only test data before launch; their consent records go with them.
DELETE FROM emergency_contacts;
UPDATE users SET escalation_enabled = false WHERE escalation_enabled;
UPDATE vehicles SET escalation_enabled = NULL WHERE escalation_enabled IS NOT NULL;

-- Old timing settings are replaced by escalation.reminder_minutes and escalation.sms_minutes.
DELETE FROM app_settings
 WHERE key IN ('reminder.after_minutes', 'reminder.max_owner_sms', 'escalation.default_minutes',
               'followup.escalate_after_minutes');

-- migrate:down
DROP INDEX alerts_sms_due_idx;
ALTER TABLE alerts
  DROP COLUMN resolved_at,
  DROP COLUMN escalation_stop_reason,
  DROP COLUMN escalation_stopped_at,
  DROP COLUMN sms_sent_at,
  DROP COLUMN sms_due_at,
  DROP COLUMN escalation_stage;
DROP TYPE escalation_stage;
