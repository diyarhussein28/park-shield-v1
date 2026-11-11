-- migrate:up
-- Contract number for cancellation without login (§312k BGB, US-07).
ALTER TABLE subscriptions ADD COLUMN contract_no varchar(12) UNIQUE;

-- Double opt-in token for the Business waitlist (US-04, AD-21).
ALTER TABLE business_waitlist ADD COLUMN confirm_token_hash bytea UNIQUE;

-- Premium is shown on the pricing page but only purchasable from Phase 2 (9 Nov 2027).
INSERT INTO app_settings (key, value) VALUES ('plans.premium.purchasable', 'false');

-- Data minimisation: e-mail addresses that requested a login link but never verified are removed after 24 h.
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

  -- v3.1: never-verified sign-ups (no subscription can exist without a verified login)
  DELETE FROM users
   WHERE kind = 'customer' AND email_verified_at IS NULL AND created_at < now() - interval '24 hours';

  DELETE FROM provider_status_events WHERE captured_at < now() - interval '90 days';
  DELETE FROM outbox_events WHERE processed_at < now() - interval '7 days';

  DELETE FROM audit_logs WHERE created_at < now() - interval '12 months';

  DELETE FROM users WHERE status = 'pending_deletion' AND deletion_due_at < now();
END $$;

-- migrate:down
DELETE FROM app_settings WHERE key = 'plans.premium.purchasable';
ALTER TABLE business_waitlist DROP COLUMN confirm_token_hash;
ALTER TABLE subscriptions DROP COLUMN contract_no;
