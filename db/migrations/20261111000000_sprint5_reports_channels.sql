-- migrate:up
-- Anonymous "Aufkleber sieht verdächtig aus" reports from the scanner page (SC-15, US-19) share the
-- abuse_reports table with owner reports: no alert or account, but always the reported code.
ALTER TABLE abuse_reports ALTER COLUMN alert_id DROP NOT NULL;
ALTER TABLE abuse_reports ALTER COLUMN reported_by DROP NOT NULL;
ALTER TABLE abuse_reports ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'owner_report';
ALTER TABLE abuse_reports ADD COLUMN qr_token_id uuid REFERENCES qr_tokens(id) ON DELETE CASCADE;
ALTER TABLE abuse_reports ADD CONSTRAINT abuse_report_subject CHECK (
  (kind = 'owner_report' AND alert_id IS NOT NULL AND reported_by IS NOT NULL)
  OR (kind = 'fake_decal' AND qr_token_id IS NOT NULL AND reported_by IS NULL)
);
CREATE INDEX abuse_reports_token_idx ON abuse_reports(qr_token_id, created_at) WHERE qr_token_id IS NOT NULL;

-- WhatsApp utility template price per message in micro-euros (Meta pricing may change, NT-04/AD-14).
INSERT INTO app_settings (key, value) VALUES ('whatsapp.cost_micros', '55000');

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
  -- v3.1: fake-decal reports (no alert to cascade from)
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

  DELETE FROM audit_logs WHERE created_at < now() - interval '12 months';

  DELETE FROM users WHERE status = 'pending_deletion' AND deletion_due_at < now();
END $$;

-- migrate:down
DELETE FROM app_settings WHERE key = 'whatsapp.cost_micros';
DELETE FROM abuse_reports WHERE kind = 'fake_decal';
ALTER TABLE abuse_reports DROP CONSTRAINT abuse_report_subject;
ALTER TABLE abuse_reports DROP COLUMN qr_token_id;
ALTER TABLE abuse_reports DROP COLUMN kind;
ALTER TABLE abuse_reports ALTER COLUMN reported_by SET NOT NULL;
ALTER TABLE abuse_reports ALTER COLUMN alert_id SET NOT NULL;
