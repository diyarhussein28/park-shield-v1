-- migrate:up
-- US-39 / AD-07: pre-printed batches go Generated → Printed → Shipped (to the partner); each code
-- becomes active when a customer claims it for a vehicle and tests it.
ALTER TABLE token_batches
  ADD COLUMN status varchar(12) NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'printed', 'shipped')),
  ADD COLUMN print_partner_ref varchar(64),
  ADD COLUMN printed_at timestamptz,
  ADD COLUMN shipped_at timestamptz;
CREATE INDEX qr_tokens_batch_idx ON qr_tokens(batch_id) WHERE batch_id IS NOT NULL;

-- Order pipeline: returned shipments, reprints (linked to the order they replace) and a short ops note.
ALTER TABLE decal_orders
  ADD COLUMN reprint_of uuid REFERENCES decal_orders(id) ON DELETE SET NULL,
  ADD COLUMN returned_at timestamptz,
  ADD COLUMN ops_note varchar(200);
CREATE INDEX decal_orders_status_idx ON decal_orders(status, created_at);

-- US-40 / AD-12: a credit note must be reproducible from the refund row alone for 8 years
-- (§147 AO), even after the customer's account is gone: contract number and the calculation.
ALTER TABLE refunds
  ADD COLUMN contract_no varchar(20),
  ADD COLUMN reason varchar(300),
  ADD COLUMN days_used integer,
  ADD COLUMN period_days integer;
CREATE SEQUENCE credit_note_seq;
CREATE INDEX refunds_subscription_idx ON refunds(subscription_id);
CREATE INDEX refunds_order_idx ON refunds(decal_order_id);

-- US-41 / AD-16: current level of each health check, so the team is alerted once per incident.
CREATE TABLE provider_health_alerts (
  check_key   varchar(60) PRIMARY KEY,
  level       varchar(10) NOT NULL CHECK (level IN ('ok', 'warning', 'critical')),
  since       timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz
);

-- US-42 / AD-17: append-only for everyone, TRUNCATE included (row triggers do not fire on it) ...
CREATE FUNCTION audit_logs_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_no_truncate();
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;

-- ... and copied live to the Object Lock bucket. Each object carries the hash of the previous one,
-- so a missing or altered object breaks the chain (npm run audit:verify).
CREATE TABLE audit_stream_state (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_id    bigint NOT NULL DEFAULT 0,
  last_hash  char(64) NOT NULL DEFAULT repeat('0', 64),
  last_key   varchar(200),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO audit_stream_state DEFAULT VALUES;

-- Retention deletes audit rows after 12 months, but never one that has not reached the bucket yet.
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

-- US-43 / AD-18: Metabase reads only these aggregate views (on the replica). The role has no
-- privilege on any table, so it can see neither encrypted columns nor any other personal data.
CREATE SCHEMA metrics;

CREATE VIEW metrics.revenue_by_plan AS
SELECT s.plan,
       count(*)::int AS live_subscriptions,
       sum(CASE pc.kind
             WHEN 'percent_off' THEN round(pl.price_year_gross_cents * (100 - pc.value) / 100.0)
             WHEN 'amount_off'  THEN greatest(0, pl.price_year_gross_cents - pc.value)
             ELSE pl.price_year_gross_cents END)::bigint AS arr_gross_cents,
       round(sum(CASE pc.kind
             WHEN 'percent_off' THEN round(pl.price_year_gross_cents * (100 - pc.value) / 100.0)
             WHEN 'amount_off'  THEN greatest(0, pl.price_year_gross_cents - pc.value)
             ELSE pl.price_year_gross_cents END) / 12.0)::bigint AS mrr_gross_cents
  FROM subscriptions s
  JOIN plans pl ON pl.code = s.plan
  LEFT JOIN promo_codes pc ON pc.id = s.promo_code_id
 WHERE s.status IN ('active', 'past_due')
 GROUP BY s.plan;

CREATE VIEW metrics.churn_monthly AS
WITH months AS (
  SELECT generate_series(date_trunc('month', min(created_at)), date_trunc('month', now()),
                         interval '1 month') AS m
    FROM subscriptions
)
SELECT m::date AS month, active_at_start, churned,
       round(churned::numeric / nullif(active_at_start, 0), 4) AS churn_rate
  FROM (
    SELECT m,
           (SELECT count(*) FROM subscriptions s
             WHERE s.created_at < m
               AND (s.status IN ('active', 'past_due') OR s.current_period_end >= m))::int AS active_at_start,
           (SELECT count(*) FROM subscriptions s
             WHERE s.status IN ('canceled', 'expired')
               AND s.current_period_end >= m AND s.current_period_end < m + interval '1 month')::int AS churned
      FROM months
  ) x;

-- Target: ≥ 99 % of alerts reach at least one channel (01-requirements §8).
CREATE VIEW metrics.delivery_daily AS
SELECT date_trunc('day', a.created_at)::date AS day,
       count(*)::int AS alerts,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM alert_deliveries d
          WHERE d.alert_id = a.id AND d.status IN ('sent', 'delivered', 'read')))::int AS reached,
       count(*) FILTER (WHERE a.acknowledged_at IS NOT NULL)::int AS acknowledged,
       round(count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM alert_deliveries d
          WHERE d.alert_id = a.id AND d.status IN ('sent', 'delivered', 'read')))::numeric
             / nullif(count(*), 0), 4) AS delivery_rate,
       round(count(*) FILTER (WHERE a.acknowledged_at IS NOT NULL)::numeric / nullif(count(*), 0), 4)
         AS ack_rate
  FROM alerts a
 WHERE NOT a.is_test
 GROUP BY 1;

CREATE VIEW metrics.message_cost_daily AS
SELECT date_trunc('day', d.queued_at)::date AS day, d.channel,
       count(*)::int AS deliveries,
       count(*) FILTER (WHERE d.status = 'failed')::int AS failed,
       round(coalesce(sum(d.cost_micros_eur), 0) / 1000000.0, 4) AS cost_eur
  FROM alert_deliveries d
 GROUP BY 1, 2;

-- Activation funnel by month of the first subscription: paid → shipped → tested → second channel →
-- emergency contact. Every step also requires the steps before it.
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
       count(*) FILTER (WHERE shipped AND tested AND second_channel AND emergency_contact)::int
         AS emergency_contact
  FROM steps
 GROUP BY cohort;

-- KPI: share of iOS users with working Push (a home-screen web app that received its last push).
CREATE VIEW metrics.ios_push AS
WITH ios AS (
  SELECT DISTINCT u.id
    FROM users u
   WHERE u.kind = 'customer'
     AND (EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.user_agent ILIKE '%iOS%')
          OR EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id AND p.platform = 'ios'))
)
SELECT count(*)::int AS ios_users,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM push_subscriptions p
          WHERE p.user_id = ios.id AND p.platform = 'ios' AND p.failed_count = 0))::int AS with_working_push,
       round(count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM push_subscriptions p
          WHERE p.user_id = ios.id AND p.platform = 'ios' AND p.failed_count = 0))::numeric
             / nullif(count(*), 0), 4) AS share
  FROM ios;

-- Same four steps as the protection score in the owner portal (US-28).
CREATE VIEW metrics.protection_score_distribution AS
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
 GROUP BY score;

-- Gate G2: refunds below 3 % of new subscriptions.
CREATE VIEW metrics.refunds_monthly AS
SELECT date_trunc('month', r.created_at)::date AS month, r.kind,
       count(*)::int AS refunds,
       sum(r.refund_gross_cents)::bigint AS refund_gross_cents
  FROM refunds r
 GROUP BY 1, 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase_ro') THEN
    -- LOGIN and the password are set by Ansible on the server, never in a migration.
    CREATE ROLE metabase_ro NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA metrics TO metabase_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO metabase_ro;

INSERT INTO app_settings (key, value) VALUES
  ('refunds.withdrawal_days', '14'),
  ('refunds.custom_decal_cost_cents', '250'),
  ('health.whatsapp_failure_pct', '5'),
  ('health.email_failure_pct', '5'),
  ('health.push_failure_pct', '10'),
  ('health.stripe_webhook_failures', '1'),
  ('health.print_stuck_hours', '24'),
  ('health.renotify_hours', '6'),
  ('support.reply_hours_plus', '48')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DELETE FROM app_settings WHERE key IN ('refunds.withdrawal_days', 'refunds.custom_decal_cost_cents',
  'health.whatsapp_failure_pct', 'health.email_failure_pct', 'health.push_failure_pct',
  'health.stripe_webhook_failures', 'health.print_stuck_hours', 'health.renotify_hours',
  'support.reply_hours_plus');
-- metabase_ro is a cluster-wide role that other databases on the server may use: it stays.
REVOKE ALL ON ALL TABLES IN SCHEMA metrics FROM metabase_ro;
REVOKE USAGE ON SCHEMA metrics FROM metabase_ro;
DROP SCHEMA metrics CASCADE;

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

DROP TABLE audit_stream_state;
DROP TRIGGER audit_logs_no_truncate ON audit_logs;
DROP FUNCTION audit_logs_no_truncate();
DROP TABLE provider_health_alerts;
DROP INDEX refunds_order_idx;
DROP INDEX refunds_subscription_idx;
DROP SEQUENCE credit_note_seq;
ALTER TABLE refunds DROP COLUMN period_days, DROP COLUMN days_used, DROP COLUMN reason,
  DROP COLUMN contract_no;
DROP INDEX decal_orders_status_idx;
ALTER TABLE decal_orders DROP COLUMN ops_note, DROP COLUMN returned_at, DROP COLUMN reprint_of;
DROP INDEX qr_tokens_batch_idx;
ALTER TABLE token_batches DROP COLUMN shipped_at, DROP COLUMN printed_at,
  DROP COLUMN print_partner_ref, DROP COLUMN status;
