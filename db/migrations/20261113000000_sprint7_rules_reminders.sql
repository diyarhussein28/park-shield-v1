-- migrate:up
-- OW-07: the owner's own escalation delay (3–30 min); NULL = default from escalation.default_minutes.
ALTER TABLE users ADD COLUMN escalation_minutes smallint
  CHECK (escalation_minutes IS NULL OR escalation_minutes BETWEEN 3 AND 30);
-- OW-18 / US-30: when the last periodic summary went out.
ALTER TABLE users ADD COLUMN last_summary_at timestamptz;
-- OW-15 / US-29: "decal health" reminder after 11 months without a scan, once per quiet period.
ALTER TABLE qr_tokens ADD COLUMN health_reminded_at timestamptz;

CREATE INDEX notification_rules_user_idx ON notification_rules(user_id);

INSERT INTO app_settings (key, value) VALUES
  ('fair_use.warn_percent', '80'),
  ('reminders.activation_days', '[3, 7, 14]'),
  ('reminders.decal_health_months', '11')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DELETE FROM app_settings
 WHERE key IN ('fair_use.warn_percent', 'reminders.activation_days', 'reminders.decal_health_months');
DROP INDEX notification_rules_user_idx;
ALTER TABLE qr_tokens DROP COLUMN health_reminded_at;
ALTER TABLE users DROP COLUMN last_summary_at;
ALTER TABLE users DROP COLUMN escalation_minutes;
