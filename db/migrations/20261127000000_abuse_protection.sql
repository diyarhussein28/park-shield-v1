-- migrate:up
-- Abuse protection (02-architecture §5a): Protected Mode per vehicle, optional phone verification of
-- scanners, phone bans (per vehicle by the owner, global only after staff review). Only an HMAC of the
-- phone number with a long-lived pepper is ever stored, never the number.

-- The sender's phone hash, set only when the scanner confirmed a mobile number (deleted with the alert).
ALTER TABLE alerts ADD COLUMN verified_phone_hash bytea;
-- Protected Mode: free text (and later photos) of an unconfirmed sender are kept but not shown in any
-- notification; the owner opens them in the portal ("Anzeigen").
ALTER TABLE alerts ADD COLUMN content_hidden boolean NOT NULL DEFAULT false;
CREATE INDEX alerts_verified_phone_idx ON alerts(verified_phone_hash) WHERE verified_phone_hash IS NOT NULL;

CREATE TABLE phone_bans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash  bytea NOT NULL,
  vehicle_id  uuid REFERENCES vehicles(id) ON DELETE CASCADE,  -- NULL = global (staff-confirmed)
  reason      varchar(40) NOT NULL,
  created_by  varchar(5) NOT NULL CHECK (created_by IN ('owner', 'admin')),
  staff_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= created_at + interval '13 months'),
  CHECK (vehicle_id IS NOT NULL OR created_by = 'admin')
);
CREATE INDEX phone_bans_hash_idx ON phone_bans(phone_hash, expires_at);
CREATE INDEX phone_bans_created_idx ON phone_bans(created_at) WHERE created_by = 'owner';

-- Staff decisions on global-ban candidates; a candidate shows again only after a newer owner ban.
CREATE TABLE phone_ban_reviews (
  phone_hash  bytea PRIMARY KEY,
  decision    varchar(10) NOT NULL CHECK (decision IN ('banned', 'dismissed')),
  staff_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicle_protection (
  vehicle_id   uuid PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  active       boolean NOT NULL,
  source       varchar(6) NOT NULL CHECK (source IN ('auto', 'manual')),
  active_until timestamptz,                                    -- NULL: manual, no end date
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (source = 'manual' OR active_until IS NOT NULL)
);

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

-- migrate:down
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
  DELETE FROM alerts WHERE created_at < now() - interval '90 days';
  DELETE FROM abuse_reports WHERE kind = 'fake_decal' AND created_at < now() - interval '90 days';
  UPDATE parking_sessions SET location_enc = NULL
   WHERE location_enc IS NOT NULL AND ended_at < now() - interval '24 hours';
  UPDATE decal_orders SET shipping_address_enc = '\x'::bytea
   WHERE delivered_at < now() - interval '90 days' AND octet_length(shipping_address_enc) > 0;
  DELETE FROM magic_link_tokens WHERE expires_at < now() - interval '1 day';
  DELETE FROM sessions          WHERE expires_at < now() - interval '7 days';
  DELETE FROM scanner_blocks    WHERE expires_at < now();
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

DROP TABLE vehicle_protection;
DROP TABLE phone_ban_reviews;
DROP TABLE phone_bans;
DROP INDEX alerts_verified_phone_idx;
ALTER TABLE alerts DROP COLUMN content_hidden, DROP COLUMN verified_phone_hash;
