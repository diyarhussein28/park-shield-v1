-- migrate:up
-- Native app (FCM push), tiered notifications, owner reminder, sequential PREMIUM escalation and the
-- owner-initiated live chat. WhatsApp and the Business plan are removed completely.

-- ---------------------------------------------------------------------------
-- 0. The metrics views depend on the enums that change: keep their definitions, drop them, recreate
--    them at the end (two of them are rewritten below because they referred to WhatsApp).
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _metrics_views ON COMMIT DROP AS
  SELECT viewname, pg_get_viewdef(format('metrics.%I', viewname)::regclass, true) AS def
    FROM pg_views WHERE schemaname = 'metrics';
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT viewname FROM _metrics_views LOOP
    EXECUTE format('DROP VIEW metrics.%I', v.viewname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. WhatsApp removed: data, settings, consent type, enum value.
-- ---------------------------------------------------------------------------
DELETE FROM alert_deliveries   WHERE channel = 'whatsapp';
DELETE FROM contact_channels   WHERE type = 'whatsapp';
DELETE FROM emergency_contacts WHERE channel = 'whatsapp';
DELETE FROM usage_counters     WHERE metric LIKE 'whatsapp%';
DELETE FROM consents           WHERE purpose LIKE 'whatsapp%';
-- TODO [LEGAL REVIEW] WhatsApp opt-in records are deleted with the channel (pre-launch test data only).
DELETE FROM consent_records    WHERE type = 'whatsapp_opt_in';
ALTER TABLE consent_records DROP CONSTRAINT consent_records_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_type_check CHECK (type IN
  ('immediate_start', 'agb', 'privacy_notice', 'marketing_doi', 'emergency_contact'));
DELETE FROM app_settings
 WHERE key LIKE '%whatsapp%' OR key LIKE 'limits.%.whatsapp_per_month';
UPDATE plans SET limits = limits - 'whatsapp_per_month';

ALTER TYPE channel_type RENAME TO channel_type_old;
CREATE TYPE channel_type AS ENUM ('webpush', 'email', 'sms', 'voice', 'native_push');
ALTER TABLE contact_channels   ALTER COLUMN type    TYPE channel_type USING type::text::channel_type;
ALTER TABLE emergency_contacts ALTER COLUMN channel TYPE channel_type USING channel::text::channel_type;
ALTER TABLE alert_deliveries   ALTER COLUMN channel TYPE channel_type USING channel::text::channel_type;
DROP TYPE channel_type_old;

-- ---------------------------------------------------------------------------
-- 2. Plans: only PLUS and PREMIUM. Business, its waitlist and its enum value are gone.
-- ---------------------------------------------------------------------------
DROP TABLE business_waitlist;
UPDATE promo_codes SET applies_to = array_remove(applies_to, 'business') WHERE 'business' = ANY (applies_to);
DELETE FROM plans WHERE code = 'business';
DELETE FROM app_settings WHERE key LIKE 'limits.business.%';
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_plan_fkey;
ALTER TYPE plan_code RENAME TO plan_code_old;
CREATE TYPE plan_code AS ENUM ('plus', 'premium');
ALTER TABLE plans           ALTER COLUMN code       TYPE plan_code   USING code::text::plan_code;
ALTER TABLE subscriptions   ALTER COLUMN plan       TYPE plan_code   USING plan::text::plan_code;
ALTER TABLE welcome_letters ALTER COLUMN plan       TYPE plan_code   USING plan::text::plan_code;
ALTER TABLE promo_codes     ALTER COLUMN applies_to TYPE plan_code[] USING applies_to::text[]::plan_code[];
DROP TYPE plan_code_old;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_fkey FOREIGN KEY (plan) REFERENCES plans(code);

-- Channel matrix: PLUS = push + e-mail, PREMIUM = push + e-mail + SMS. Escalation is PREMIUM only.
UPDATE plans SET limits = limits || '{"emergency_contacts": 0, "sms_per_month": 0}'::jsonb WHERE code = 'plus';
DELETE FROM app_settings WHERE key IN ('limits.plus.emergency_contacts', 'limits.plus.sms_per_month');

-- ---------------------------------------------------------------------------
-- 3. Native app devices (Firebase Cloud Messaging; APNs for iOS goes through FCM).
--    No device fingerprint and no advertising ID: only the FCM token and what the push needs.
-- ---------------------------------------------------------------------------
CREATE TYPE device_platform AS ENUM ('ios', 'android');
CREATE TABLE user_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token     varchar(4096) NOT NULL UNIQUE,
  platform      device_platform NOT NULL,
  app_version   varchar(20),
  locale        ui_lang,
  failed_count  smallint NOT NULL DEFAULT 0,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_devices_user_idx ON user_devices(user_id);

-- ---------------------------------------------------------------------------
-- 4. Alerts: seen (≠ acknowledged), owner reminder, escalation chain step, who acknowledged.
-- ---------------------------------------------------------------------------
ALTER TABLE alerts
  ADD COLUMN seen_at         timestamptz,
  ADD COLUMN remind_at       timestamptz,
  ADD COLUMN reminded_at     timestamptz,
  ADD COLUMN escalation_step smallint NOT NULL DEFAULT 0,
  ADD COLUMN acknowledged_by varchar(12)
    CHECK (acknowledged_by IN ('owner', 'contact_1', 'contact_2', 'contact_3'));
UPDATE alerts SET acknowledged_by = 'owner' WHERE owner_reply = 'coming';
UPDATE alerts SET escalation_step = 1 WHERE escalated_at IS NOT NULL;
CREATE INDEX alerts_remind_due_idx ON alerts(remind_at)
  WHERE reminded_at IS NULL AND remind_at IS NOT NULL;
-- The chain has several steps, so a due step no longer means "escalated_at IS NULL".
DROP INDEX alerts_escalation_due_idx;
CREATE INDEX alerts_escalation_due_idx ON alerts(escalate_at)
  WHERE escalate_at IS NOT NULL AND status IN ('dispatched', 'delivered', 'acknowledged', 'escalated');

-- ---------------------------------------------------------------------------
-- 5. Escalation to emergency contacts (PREMIUM): on/off globally and per vehicle; contacts with
--    phone (SMS) and optional e-mail; deactivated for 30 days after a downgrade.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN escalation_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE vehicles ADD COLUMN escalation_enabled boolean;  -- NULL = follow the owner's setting
-- Existing PREMIUM owners who already have a confirmed contact keep escalating as before.
UPDATE users u SET escalation_enabled = true
 WHERE EXISTS (SELECT 1 FROM emergency_contacts c WHERE c.user_id = u.id AND c.consent = 'confirmed')
   AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.plan = 'premium'
                AND s.status IN ('active', 'past_due'));

ALTER TABLE emergency_contacts
  ADD COLUMN phone_enc      bytea,
  ADD COLUMN phone_bidx     bytea,
  ADD COLUMN deactivated_at timestamptz,
  ALTER COLUMN address_enc  DROP NOT NULL,
  ALTER COLUMN address_bidx DROP NOT NULL;
ALTER TABLE emergency_contacts ADD CONSTRAINT emergency_contacts_reachable
  CHECK (address_enc IS NOT NULL OR phone_enc IS NOT NULL);
CREATE INDEX emergency_contacts_phone_bidx ON emergency_contacts(phone_bidx) WHERE phone_bidx IS NOT NULL;
-- An escalation message carries one link (/k/<token>: "Ich komme" and opt-out). The token is derived
-- (HMAC), only its hash is stored, on the contact's delivery rows of that alert, with the chain step.
ALTER TABLE alert_deliveries
  ADD COLUMN ack_token_hash  bytea,
  ADD COLUMN escalation_step smallint;
CREATE INDEX alert_deliveries_ack_token_idx ON alert_deliveries(ack_token_hash)
  WHERE ack_token_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Owner-initiated live chat. Messages stay in alert_messages (encrypted); the session row holds
--    the state, the scanner's token hash and the limits. Both are purged 24 h after the chat closed.
-- ---------------------------------------------------------------------------
CREATE TYPE chat_status AS ENUM ('locked', 'active', 'closed');
CREATE TYPE chat_close_reason AS ENUM ('owner', 'inactivity', 'max_duration', 'alert_deleted');
CREATE TABLE chat_sessions (
  alert_id          uuid PRIMARY KEY REFERENCES alerts(id) ON DELETE CASCADE,
  token_hash        bytea UNIQUE,                 -- SHA-256 of the scanner's chat token; NULL once purged
  status            chat_status NOT NULL DEFAULT 'locked',
  opened_at         timestamptz,
  closed_at         timestamptz,
  close_reason      chat_close_reason,
  last_message_at   timestamptz,
  owner_msg_count   smallint NOT NULL DEFAULT 0,
  scanner_msg_count smallint NOT NULL DEFAULT 0,
  scanner_seen_at   timestamptz,                  -- presence: last moment the scanner was connected
  owner_read_at     timestamptz,                  -- chat:seen
  scanner_read_at   timestamptz,
  purged_at         timestamptz,                  -- history deleted (24 h after closing)
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_sessions_active_idx ON chat_sessions(opened_at) WHERE status = 'active';
CREATE INDEX chat_sessions_closed_idx ON chat_sessions(closed_at) WHERE status = 'closed' AND purged_at IS NULL;

-- ---------------------------------------------------------------------------
-- 7. Settings (all thresholds configurable in the back office).
-- ---------------------------------------------------------------------------
INSERT INTO app_settings (key, value) VALUES
  ('channels.native_push.enabled', 'true'),
  ('reminder.after_minutes', '3'),
  ('reminder.max_owner_sms', '2'),
  ('chat.inactivity_minutes', '20'),
  ('chat.max_minutes', '180'),
  ('chat.max_message_chars', '500'),
  ('chat.max_messages_per_side', '20'),
  ('chat.quick_replies', '{"de": ["Ich bin in 2 Minuten am Fahrzeug.", "Ich komme sofort.", "Vielen Dank für den Hinweis!", "Ich kümmere mich darum."], "en": ["I will be at the car in 2 minutes.", "I am coming right away.", "Thank you for letting me know!", "I will take care of it."]}')
ON CONFLICT (key) DO NOTHING;
UPDATE app_settings SET value = '["native_push", "webpush", "email", "sms"]' WHERE key = 'channels.order';

-- ---------------------------------------------------------------------------
-- 8. Retention: chat 24 h after closing, devices 90 days unseen, contacts 30 days after a downgrade.
--    Alert photos (30 days) stay in code (files); alerts 90 days as before.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION run_retention() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE alerts SET scanner_ref = NULL, scanner_country = NULL
   WHERE (scanner_ref IS NOT NULL OR scanner_country IS NOT NULL)
     AND created_at < now() - interval '24 hours';

  UPDATE alerts SET block_ref = NULL
   WHERE block_ref IS NOT NULL AND created_at < now() - interval '30 days';

  UPDATE alerts SET custom_message_enc = NULL
   WHERE custom_message_enc IS NOT NULL AND created_at < now() - interval '7 days';

  -- Live chat: messages and the scanner's token hash 24 h after the chat closed. The 7-day rule stays
  -- as a backstop for messages of a chat that never closed properly.
  DELETE FROM alert_messages m
   USING chat_sessions s
   WHERE s.alert_id = m.alert_id AND s.status = 'closed' AND s.closed_at < now() - interval '24 hours';
  UPDATE chat_sessions SET token_hash = NULL, purged_at = now()
   WHERE status = 'closed' AND purged_at IS NULL AND closed_at < now() - interval '24 hours';
  DELETE FROM alert_messages WHERE created_at < now() - interval '7 days';
  DELETE FROM moderation_reviews WHERE created_at < now() - interval '30 days';

  UPDATE alerts SET status = 'expired'
   WHERE status IN ('created', 'dispatched', 'delivered') AND expires_at < now();

  -- verified_phone_hash and content_hidden go with the alert (and its chat session).
  DELETE FROM alerts WHERE created_at < now() - interval '90 days';
  DELETE FROM abuse_reports WHERE kind = 'fake_decal' AND created_at < now() - interval '90 days';

  UPDATE parking_sessions SET location_enc = NULL
   WHERE location_enc IS NOT NULL AND ended_at < now() - interval '24 hours';

  UPDATE decal_orders SET shipping_address_enc = '\x'::bytea
   WHERE delivered_at < now() - interval '90 days' AND octet_length(shipping_address_enc) > 0;

  DELETE FROM magic_link_tokens WHERE expires_at < now() - interval '1 day';
  DELETE FROM sessions          WHERE expires_at < now() - interval '7 days';
  DELETE FROM user_devices      WHERE last_seen_at < now() - interval '90 days';
  DELETE FROM scanner_blocks    WHERE expires_at < now();
  DELETE FROM phone_bans        WHERE expires_at < now();
  DELETE FROM phone_ban_reviews WHERE decided_at < now() - interval '13 months';
  DELETE FROM vehicle_protection
   WHERE (source = 'auto' AND active_until < now()) OR NOT active;
  DELETE FROM vehicle_modes     WHERE ends_at < now() - interval '1 day';
  UPDATE vehicle_transfers SET status = 'expired' WHERE status = 'pending' AND expires_at < now();
  DELETE FROM vehicle_transfers WHERE created_at < now() - interval '90 days';

  UPDATE break_glass_requests SET status = 'expired'
   WHERE status IN ('requested', 'approved')
     AND COALESCE(valid_until, created_at + interval '24 hours') < now();

  DELETE FROM emergency_contacts
   WHERE consent IN ('pending', 'declined') AND consent_requested_at < now() - interval '14 days';
  DELETE FROM emergency_contacts WHERE deactivated_at < now() - interval '30 days';
  DELETE FROM vehicle_members
   WHERE consent IN ('pending', 'declined') AND invited_at < now() - interval '14 days';

  DELETE FROM users
   WHERE kind = 'customer' AND email_verified_at IS NULL AND created_at < now() - interval '24 hours';

  DELETE FROM provider_status_events WHERE captured_at < now() - interval '90 days';
  DELETE FROM outbox_events WHERE processed_at < now() - interval '7 days';

  DELETE FROM audit_logs
   WHERE created_at < now() - interval '12 months'
     AND id <= (SELECT last_id FROM audit_stream_state WHERE id = 1);

  DELETE FROM users u
   WHERE u.status = 'pending_deletion' AND u.deletion_due_at < now()
     AND NOT EXISTS (
       SELECT 1 FROM data_subject_requests r
         JOIN dsr_processor_steps s ON s.dsr_id = r.id
        WHERE r.user_id = u.id AND r.type = 'erasure' AND s.automated
          AND s.processor <> 'parkshield_db' AND s.status IN ('pending', 'failed'));
END $$;

-- ---------------------------------------------------------------------------
-- 9. Metrics views back. The second working channel is now app push or browser push.
-- ---------------------------------------------------------------------------
UPDATE _metrics_views SET def = $v$
  WITH customers AS (
    SELECT u.id, date_trunc('month', min(s.created_at))::date AS cohort
      FROM users u JOIN subscriptions s ON s.user_id = u.id
     WHERE u.kind = 'customer'
     GROUP BY u.id
  ), steps AS (
    SELECT c.cohort,
           EXISTS (SELECT 1 FROM decal_orders o WHERE o.user_id = c.id AND o.status IN ('shipped', 'delivered'))
             OR EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                         WHERE v.owner_user_id = c.id AND t.batch_id IS NOT NULL) AS shipped,
           EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                    WHERE v.owner_user_id = c.id AND t.last_test_at IS NOT NULL) AS tested,
           EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = c.id)
             OR EXISTS (SELECT 1 FROM user_devices d WHERE d.user_id = c.id) AS second_channel,
           EXISTS (SELECT 1 FROM emergency_contacts e WHERE e.user_id = c.id AND e.consent = 'confirmed')
             AS emergency_contact
      FROM customers c
  )
  SELECT cohort,
         count(*)::int AS paid,
         count(*) FILTER (WHERE shipped)::int AS shipped,
         count(*) FILTER (WHERE shipped AND tested)::int AS tested,
         count(*) FILTER (WHERE shipped AND tested AND second_channel)::int AS second_channel,
         count(*) FILTER (WHERE shipped AND tested AND second_channel AND emergency_contact)::int AS emergency_contact
    FROM steps
   GROUP BY cohort
$v$ WHERE viewname = 'activation_funnel';

UPDATE _metrics_views SET def = $v$
  SELECT score, count(*)::int AS customers
    FROM (
      SELECT 25 * ((u.email_verified_at IS NOT NULL)::int
           + (EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
              OR EXISTS (SELECT 1 FROM user_devices d WHERE d.user_id = u.id))::int
           + EXISTS (SELECT 1 FROM emergency_contacts e WHERE e.user_id = u.id AND e.consent = 'confirmed')::int
           + EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                      WHERE v.owner_user_id = u.id AND t.status <> 'revoked' AND t.last_test_at IS NOT NULL)::int)
             AS score
        FROM users u
       WHERE u.kind = 'customer'
         AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active', 'past_due'))
    ) x
   GROUP BY score
$v$ WHERE viewname = 'protection_score_distribution';

DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT viewname, def FROM _metrics_views LOOP
    EXECUTE format('CREATE VIEW metrics.%I AS %s', v.viewname, v.def);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_ro') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO metabase_ro;
  END IF;
END $$;

-- migrate:down
CREATE TEMP TABLE _metrics_views ON COMMIT DROP AS
  SELECT viewname, pg_get_viewdef(format('metrics.%I', viewname)::regclass, true) AS def
    FROM pg_views WHERE schemaname = 'metrics';
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT viewname FROM _metrics_views LOOP
    EXECUTE format('DROP VIEW metrics.%I', v.viewname);
  END LOOP;
END $$;

DELETE FROM app_settings WHERE key IN ('channels.native_push.enabled', 'reminder.after_minutes',
  'reminder.max_owner_sms', 'chat.inactivity_minutes', 'chat.max_minutes', 'chat.max_message_chars',
  'chat.max_messages_per_side', 'chat.quick_replies');
UPDATE app_settings SET value = '["webpush", "email", "whatsapp"]' WHERE key = 'channels.order';

DROP TABLE chat_sessions;
DROP TYPE chat_close_reason;
DROP TYPE chat_status;

DROP INDEX IF EXISTS alert_deliveries_ack_token_idx;
ALTER TABLE alert_deliveries DROP COLUMN IF EXISTS ack_token_hash, DROP COLUMN IF EXISTS escalation_step;
DROP INDEX emergency_contacts_phone_bidx;
ALTER TABLE emergency_contacts DROP CONSTRAINT emergency_contacts_reachable;
DELETE FROM emergency_contacts WHERE address_enc IS NULL;
ALTER TABLE emergency_contacts
  DROP COLUMN phone_enc, DROP COLUMN phone_bidx, DROP COLUMN deactivated_at,
  ALTER COLUMN address_enc SET NOT NULL, ALTER COLUMN address_bidx SET NOT NULL;
ALTER TABLE vehicles DROP COLUMN escalation_enabled;
ALTER TABLE users DROP COLUMN escalation_enabled;

DROP INDEX alerts_escalation_due_idx;
CREATE INDEX alerts_escalation_due_idx ON alerts(escalate_at)
  WHERE escalated_at IS NULL AND escalate_at IS NOT NULL
    AND status IN ('dispatched', 'delivered', 'acknowledged');
DROP INDEX alerts_remind_due_idx;
ALTER TABLE alerts DROP COLUMN seen_at, DROP COLUMN remind_at, DROP COLUMN reminded_at,
  DROP COLUMN escalation_step, DROP COLUMN acknowledged_by;

DROP TABLE user_devices;
DROP TYPE device_platform;

-- Enum values come back (data does not). Rebuilt like in "up": a value added with ADD VALUE could not
-- be used by the views below in the same transaction.
ALTER TYPE channel_type RENAME TO channel_type_new;
CREATE TYPE channel_type AS ENUM ('webpush', 'email', 'whatsapp', 'sms', 'voice', 'native_push');
ALTER TABLE contact_channels   ALTER COLUMN type    TYPE channel_type USING type::text::channel_type;
ALTER TABLE emergency_contacts ALTER COLUMN channel TYPE channel_type USING channel::text::channel_type;
ALTER TABLE alert_deliveries   ALTER COLUMN channel TYPE channel_type USING channel::text::channel_type;
DROP TYPE channel_type_new;

ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_plan_fkey;
ALTER TYPE plan_code RENAME TO plan_code_new;
CREATE TYPE plan_code AS ENUM ('plus', 'premium', 'business');
ALTER TABLE plans           ALTER COLUMN code       TYPE plan_code   USING code::text::plan_code;
ALTER TABLE subscriptions   ALTER COLUMN plan       TYPE plan_code   USING plan::text::plan_code;
ALTER TABLE welcome_letters ALTER COLUMN plan       TYPE plan_code   USING plan::text::plan_code;
ALTER TABLE promo_codes     ALTER COLUMN applies_to TYPE plan_code[] USING applies_to::text[]::plan_code[];
DROP TYPE plan_code_new;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_fkey FOREIGN KEY (plan) REFERENCES plans(code);
INSERT INTO plans (code, name, availability, price_year_gross_cents, per_vehicle, limits)
VALUES ('business', 'ParkShield Business', 'coming_soon', NULL, true, '{}');

UPDATE plans SET limits = limits || '{"emergency_contacts": 1, "whatsapp_per_month": 10}'::jsonb WHERE code = 'plus';
UPDATE plans SET limits = limits || '{"whatsapp_per_month": 40}'::jsonb WHERE code = 'premium';
CREATE TABLE business_waitlist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    varchar(120) NOT NULL,
  contact_email   citext NOT NULL UNIQUE,
  fleet_size      integer CHECK (fleet_size > 0),
  industry        varchar(60),
  confirmed_at    timestamptz,
  contacted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE consent_records DROP CONSTRAINT consent_records_type_check;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_type_check CHECK (type IN
  ('immediate_start', 'agb', 'privacy_notice', 'marketing_doi', 'whatsapp_opt_in', 'emergency_contact'));
INSERT INTO app_settings (key, value) VALUES
  ('channels.whatsapp.enabled', 'true'), ('whatsapp.cost_micros', '55000'), ('health.whatsapp_failure_pct', '5')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION run_retention() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE alerts SET scanner_ref = NULL, scanner_country = NULL
   WHERE (scanner_ref IS NOT NULL OR scanner_country IS NOT NULL)
     AND created_at < now() - interval '24 hours';

  UPDATE alerts SET block_ref = NULL
   WHERE block_ref IS NOT NULL AND created_at < now() - interval '30 days';

  UPDATE alerts SET custom_message_enc = NULL
   WHERE custom_message_enc IS NOT NULL AND created_at < now() - interval '7 days';
  DELETE FROM alert_messages WHERE created_at < now() - interval '7 days';
  DELETE FROM moderation_reviews WHERE created_at < now() - interval '30 days';

  UPDATE alerts SET status = 'expired'
   WHERE status IN ('created', 'dispatched', 'delivered') AND expires_at < now();

  -- verified_phone_hash and content_hidden go with the alert.
  DELETE FROM alerts WHERE created_at < now() - interval '90 days';
  DELETE FROM abuse_reports WHERE kind = 'fake_decal' AND created_at < now() - interval '90 days';

  UPDATE parking_sessions SET location_enc = NULL
   WHERE location_enc IS NOT NULL AND ended_at < now() - interval '24 hours';

  UPDATE decal_orders SET shipping_address_enc = '\x'::bytea
   WHERE delivered_at < now() - interval '90 days' AND octet_length(shipping_address_enc) > 0;

  DELETE FROM magic_link_tokens WHERE expires_at < now() - interval '1 day';
  DELETE FROM sessions          WHERE expires_at < now() - interval '7 days';
  DELETE FROM scanner_blocks    WHERE expires_at < now();
  DELETE FROM phone_bans        WHERE expires_at < now();
  DELETE FROM phone_ban_reviews WHERE decided_at < now() - interval '13 months';
  DELETE FROM vehicle_protection
   WHERE (source = 'auto' AND active_until < now()) OR NOT active;
  DELETE FROM vehicle_modes     WHERE ends_at < now() - interval '1 day';
  UPDATE vehicle_transfers SET status = 'expired' WHERE status = 'pending' AND expires_at < now();
  DELETE FROM vehicle_transfers WHERE created_at < now() - interval '90 days';

  UPDATE break_glass_requests SET status = 'expired'
   WHERE status IN ('requested', 'approved')
     AND COALESCE(valid_until, created_at + interval '24 hours') < now();

  DELETE FROM emergency_contacts
   WHERE consent IN ('pending', 'declined') AND consent_requested_at < now() - interval '14 days';
  DELETE FROM vehicle_members
   WHERE consent IN ('pending', 'declined') AND invited_at < now() - interval '14 days';

  DELETE FROM business_waitlist WHERE confirmed_at IS NULL AND created_at < now() - interval '30 days';

  DELETE FROM users
   WHERE kind = 'customer' AND email_verified_at IS NULL AND created_at < now() - interval '24 hours';

  DELETE FROM provider_status_events WHERE captured_at < now() - interval '90 days';
  DELETE FROM outbox_events WHERE processed_at < now() - interval '7 days';

  DELETE FROM audit_logs
   WHERE created_at < now() - interval '12 months'
     AND id <= (SELECT last_id FROM audit_stream_state WHERE id = 1);

  DELETE FROM users u
   WHERE u.status = 'pending_deletion' AND u.deletion_due_at < now()
     AND NOT EXISTS (
       SELECT 1 FROM data_subject_requests r
         JOIN dsr_processor_steps s ON s.dsr_id = r.id
        WHERE r.user_id = u.id AND r.type = 'erasure' AND s.automated
          AND s.processor <> 'parkshield_db' AND s.status IN ('pending', 'failed'));
END $$;

-- The two rewritten views go back to their WhatsApp versions; the rest as they were.
UPDATE _metrics_views SET def = $v$
  WITH customers AS (
    SELECT u.id, date_trunc('month', min(s.created_at))::date AS cohort
      FROM users u JOIN subscriptions s ON s.user_id = u.id
     WHERE u.kind = 'customer'
     GROUP BY u.id
  ), steps AS (
    SELECT c.cohort,
           EXISTS (SELECT 1 FROM decal_orders o WHERE o.user_id = c.id AND o.status IN ('shipped', 'delivered'))
             OR EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                         WHERE v.owner_user_id = c.id AND t.batch_id IS NOT NULL) AS shipped,
           EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                    WHERE v.owner_user_id = c.id AND t.last_test_at IS NOT NULL) AS tested,
           EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = c.id)
             OR EXISTS (SELECT 1 FROM contact_channels ch WHERE ch.user_id = c.id AND ch.type = 'whatsapp'
                         AND ch.verified_at IS NOT NULL) AS second_channel,
           EXISTS (SELECT 1 FROM emergency_contacts e WHERE e.user_id = c.id AND e.consent = 'confirmed')
             AS emergency_contact
      FROM customers c
  )
  SELECT cohort,
         count(*)::int AS paid,
         count(*) FILTER (WHERE shipped)::int AS shipped,
         count(*) FILTER (WHERE shipped AND tested)::int AS tested,
         count(*) FILTER (WHERE shipped AND tested AND second_channel)::int AS second_channel,
         count(*) FILTER (WHERE shipped AND tested AND second_channel AND emergency_contact)::int AS emergency_contact
    FROM steps
   GROUP BY cohort
$v$ WHERE viewname = 'activation_funnel';

UPDATE _metrics_views SET def = $v$
  SELECT score, count(*)::int AS customers
    FROM (
      SELECT 25 * ((u.email_verified_at IS NOT NULL)::int
           + (EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
              OR EXISTS (SELECT 1 FROM contact_channels c WHERE c.user_id = u.id AND c.type = 'whatsapp'
                          AND c.verified_at IS NOT NULL AND c.is_enabled))::int
           + EXISTS (SELECT 1 FROM emergency_contacts e WHERE e.user_id = u.id AND e.consent = 'confirmed')::int
           + EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                      WHERE v.owner_user_id = u.id AND t.status <> 'revoked' AND t.last_test_at IS NOT NULL)::int)
             AS score
        FROM users u
       WHERE u.kind = 'customer'
         AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active', 'past_due'))
    ) x
   GROUP BY score
$v$ WHERE viewname = 'protection_score_distribution';

DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT viewname, def FROM _metrics_views LOOP
    EXECUTE format('CREATE VIEW metrics.%I AS %s', v.viewname, v.def);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_ro') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO metabase_ro;
  END IF;
END $$;
