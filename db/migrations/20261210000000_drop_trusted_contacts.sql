-- migrate:up
-- Trusted contacts were removed on 2026-11-21 (owner decision; migration 20261206000100 deleted their
-- rows and kept the empty table). This drops what is left of them: the table, the delivery columns
-- that pointed at a contact, the chain step, the per-user / per-vehicle switches and the contact
-- values of alerts.acknowledged_by. Only the owner is escalated to (push → one SMS).

CREATE OR REPLACE FUNCTION run_retention()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
END $function$;

-- An alert a contact acknowledged stays done: it must not come back into the owner's badge or sweeps.
UPDATE alerts SET resolved_at = coalesce(resolved_at, acknowledged_at, now())
 WHERE acknowledged_by IS NOT NULL AND acknowledged_by <> 'owner';
UPDATE alerts SET acknowledged_by = NULL WHERE acknowledged_by IS NOT NULL AND acknowledged_by <> 'owner';
ALTER TABLE alerts DROP CONSTRAINT alerts_acknowledged_by_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_acknowledged_by_check CHECK (acknowledged_by = 'owner');
ALTER TABLE alerts DROP COLUMN escalation_step;
ALTER TABLE alert_deliveries DROP COLUMN emergency_contact_id, DROP COLUMN escalation_step;
ALTER TABLE users DROP COLUMN escalation_enabled;
ALTER TABLE vehicles DROP COLUMN escalation_enabled;
-- Metrics: the last funnel step and a quarter of the protection score were „confirmed trusted
-- contact“; both are now the verified mobile number (the escalation SMS goes there).
DROP VIEW metrics.activation_funnel;
CREATE VIEW metrics.activation_funnel AS
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
           EXISTS (SELECT 1 FROM contact_channels ch
                    WHERE ch.user_id = c.id AND ch.type = 'sms' AND ch.verified_at IS NOT NULL)
             AS verified_phone
      FROM customers c
  )
  SELECT cohort,
         count(*)::int AS paid,
         count(*) FILTER (WHERE shipped)::int AS shipped,
         count(*) FILTER (WHERE shipped AND tested)::int AS tested,
         count(*) FILTER (WHERE shipped AND tested AND second_channel)::int AS second_channel,
         count(*) FILTER (WHERE shipped AND tested AND second_channel AND verified_phone)::int AS verified_phone
    FROM steps
   GROUP BY cohort;
CREATE OR REPLACE VIEW metrics.protection_score_distribution AS
  SELECT score, count(*)::int AS customers
    FROM (
      SELECT 25 * ((u.email_verified_at IS NOT NULL)::int
           + (EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
              OR EXISTS (SELECT 1 FROM user_devices d WHERE d.user_id = u.id))::int
           + EXISTS (SELECT 1 FROM contact_channels ch
                      WHERE ch.user_id = u.id AND ch.type = 'sms' AND ch.verified_at IS NOT NULL)::int
           + EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                      WHERE v.owner_user_id = u.id AND t.status <> 'revoked' AND t.last_test_at IS NOT NULL)::int)
             AS score
        FROM users u
       WHERE u.kind = 'customer'
         AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active', 'past_due'))
    ) x
   GROUP BY score;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_ro') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO metabase_ro;
  END IF;
END $$;
DROP TABLE emergency_contacts;

-- migrate:down
CREATE TABLE emergency_contacts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id           uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  display_name         varchar(60) NOT NULL,
  channel              channel_type NOT NULL,
  address_enc          bytea,
  address_bidx         bytea,
  key_version          smallint NOT NULL DEFAULT 1,
  escalation_order     smallint NOT NULL DEFAULT 1,
  consent              consent_state NOT NULL DEFAULT 'pending',
  consent_token_hash   bytea UNIQUE,
  consent_requested_at timestamptz NOT NULL DEFAULT now(),
  consent_decided_at   timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  phone_enc            bytea,
  phone_bidx           bytea,
  deactivated_at       timestamptz,
  CONSTRAINT emergency_contacts_reachable CHECK (address_enc IS NOT NULL OR phone_enc IS NOT NULL)
);
CREATE INDEX emergency_contacts_user_idx ON emergency_contacts(user_id);
CREATE UNIQUE INDEX emergency_contacts_address_uq ON emergency_contacts(user_id, address_bidx);
CREATE INDEX emergency_contacts_confirmed_idx ON emergency_contacts(user_id) WHERE consent = 'confirmed';
CREATE INDEX emergency_contacts_phone_bidx ON emergency_contacts(phone_bidx) WHERE phone_bidx IS NOT NULL;
ALTER TABLE vehicles ADD COLUMN escalation_enabled boolean;
ALTER TABLE users ADD COLUMN escalation_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE alert_deliveries
  ADD COLUMN emergency_contact_id uuid REFERENCES emergency_contacts(id) ON DELETE SET NULL,
  ADD COLUMN escalation_step smallint;
ALTER TABLE alerts ADD COLUMN escalation_step smallint NOT NULL DEFAULT 0;
ALTER TABLE alerts DROP CONSTRAINT alerts_acknowledged_by_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_acknowledged_by_check
  CHECK (acknowledged_by IN ('owner', 'contact_1', 'contact_2', 'contact_3'));

DROP VIEW metrics.activation_funnel;
CREATE VIEW metrics.activation_funnel AS
WITH customers AS (
         SELECT u.id,
            date_trunc('month'::text, min(s.created_at))::date AS cohort
           FROM users u
             JOIN subscriptions s ON s.user_id = u.id
          WHERE u.kind = 'customer'::user_kind
          GROUP BY u.id
        ), steps AS (
         SELECT c.cohort,
            (EXISTS ( SELECT 1
                   FROM decal_orders o
                  WHERE o.user_id = c.id AND (o.status = ANY (ARRAY['shipped'::order_status, 'delivered'::order_status])))) OR (EXISTS ( SELECT 1
                   FROM qr_tokens t
                     JOIN vehicles v ON v.id = t.vehicle_id
                  WHERE v.owner_user_id = c.id AND t.batch_id IS NOT NULL)) AS shipped,
            (EXISTS ( SELECT 1
                   FROM qr_tokens t
                     JOIN vehicles v ON v.id = t.vehicle_id
                  WHERE v.owner_user_id = c.id AND t.last_test_at IS NOT NULL)) AS tested,
            (EXISTS ( SELECT 1
                   FROM push_subscriptions p
                  WHERE p.user_id = c.id)) OR (EXISTS ( SELECT 1
                   FROM user_devices d
                  WHERE d.user_id = c.id)) AS second_channel,
            (EXISTS ( SELECT 1
                   FROM emergency_contacts e
                  WHERE e.user_id = c.id AND e.consent = 'confirmed'::consent_state)) AS emergency_contact
           FROM customers c
        )
 SELECT cohort,
    count(*)::integer AS paid,
    count(*) FILTER (WHERE shipped)::integer AS shipped,
    count(*) FILTER (WHERE shipped AND tested)::integer AS tested,
    count(*) FILTER (WHERE shipped AND tested AND second_channel)::integer AS second_channel,
    count(*) FILTER (WHERE shipped AND tested AND second_channel AND emergency_contact)::integer AS emergency_contact
   FROM steps
  GROUP BY cohort;
CREATE OR REPLACE VIEW metrics.protection_score_distribution AS
SELECT score,
    count(*)::integer AS customers
   FROM ( SELECT 25 * ((u.email_verified_at IS NOT NULL)::integer + ((EXISTS ( SELECT 1
                   FROM push_subscriptions p
                  WHERE p.user_id = u.id)) OR (EXISTS ( SELECT 1
                   FROM user_devices d
                  WHERE d.user_id = u.id)))::integer + ((EXISTS ( SELECT 1
                   FROM emergency_contacts e
                  WHERE e.user_id = u.id AND e.consent = 'confirmed'::consent_state)))::integer + ((EXISTS ( SELECT 1
                   FROM qr_tokens t
                     JOIN vehicles v ON v.id = t.vehicle_id
                  WHERE v.owner_user_id = u.id AND t.status <> 'revoked'::tag_status AND t.last_test_at IS NOT NULL)))::integer) AS score
           FROM users u
          WHERE u.kind = 'customer'::user_kind AND (EXISTS ( SELECT 1
                   FROM subscriptions s
                  WHERE s.user_id = u.id AND (s.status = ANY (ARRAY['active'::subscription_state, 'past_due'::subscription_state]))))) x
  GROUP BY score;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_ro') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO metabase_ro;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION run_retention()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
END $function$;
