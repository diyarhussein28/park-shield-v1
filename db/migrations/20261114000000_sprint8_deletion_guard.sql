-- migrate:up
-- US-32: an account in deletion is removed by the worker once its automated processor steps are done
-- (AD-11). run_retention() stays as the safety net, but must never delete a user whose erasure
-- request still has an automated step open (e.g. the Stripe customer not yet deleted).
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

  DELETE FROM audit_logs WHERE created_at < now() - interval '12 months';

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
  DELETE FROM audit_logs WHERE created_at < now() - interval '12 months';
  DELETE FROM users WHERE status = 'pending_deletion' AND deletion_due_at < now();
END $$;
