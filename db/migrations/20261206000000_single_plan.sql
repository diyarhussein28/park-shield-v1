-- migrate:up
-- Owner decision 2026-11-21: one all-inclusive plan instead of PLUS and PREMIUM. 20 € a year incl.
-- 19 % VAT, one vehicle, push alerts, reminder, SMS escalation, alert photos, chat and one free
-- welcome print. Every existing subscription (test subscriptions only, nobody is live yet) moves to it.

-- 0. The metrics views depend on plan_code: keep their definitions, drop them, recreate them below.
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

-- 1. The plan catalogue: only `standard`.
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_fkey;
ALTER TYPE plan_code RENAME TO plan_code_old;
CREATE TYPE plan_code AS ENUM ('standard');
DELETE FROM plans WHERE code::text <> 'plus';
ALTER TABLE plans           ALTER COLUMN code       TYPE plan_code   USING 'standard'::plan_code;
ALTER TABLE subscriptions   ALTER COLUMN plan       TYPE plan_code   USING 'standard'::plan_code;
ALTER TABLE welcome_letters ALTER COLUMN plan       TYPE plan_code   USING 'standard'::plan_code;
ALTER TABLE promo_codes     ALTER COLUMN applies_to TYPE plan_code[]
  USING CASE WHEN applies_to IS NULL THEN NULL ELSE ARRAY['standard']::plan_code[] END;
DROP TYPE plan_code_old;
UPDATE plans
   SET name = 'ParkShield',
       availability = 'available',
       price_year_gross_cents = 2000,
       per_vehicle = false,
       limits = '{"vehicles":1,"emergency_contacts":0,"co_drivers":0,"sms_per_month":20,"voice_minutes_per_month":0,"included_decals":1}'::jsonb
 WHERE code = 'standard';
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_fkey FOREIGN KEY (plan) REFERENCES plans(code);
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

-- 2. Renewal year by year for everyone (RENEWAL_MODE_B2C = ANNUAL, approved 2026-11-21).
UPDATE subscriptions SET renewal_mode = 'annual' WHERE renewal_mode <> 'annual';
UPDATE app_settings SET value = '"annual"', version = version + 1, updated_at = now()
 WHERE key = 'renewal.mode_b2c' AND value <> '"annual"'::jsonb;

-- 3. Plan-specific settings are gone; the single plan reads `limits.<key>` and `photos.enabled`.
DELETE FROM app_settings
 WHERE key LIKE 'limits.plus.%' OR key LIKE 'limits.premium.%'
    OR key IN ('plans.premium.purchasable', 'photos.plans');

-- 4. Print entitlements: one free shipped print (the welcome print), then a paid print (3 € by default).
ALTER TABLE users ADD COLUMN free_welcome_print_used boolean NOT NULL DEFAULT false;
UPDATE users u SET free_welcome_print_used = true
 WHERE EXISTS (SELECT 1 FROM decal_orders o WHERE o.user_id = u.id AND o.included_in_plan);
-- Self-printed or shipped: what the owner chose for this order (shipped is the only kind stored today,
-- self-printing needs no order). Payment and fulfilment state stay in `status`.
ALTER TABLE decal_orders ADD COLUMN paid_print boolean NOT NULL DEFAULT false;
UPDATE decal_orders SET paid_print = true WHERE is_replacement AND total_gross_cents > 0;

-- migrate:down
ALTER TABLE decal_orders DROP COLUMN paid_print;
ALTER TABLE users DROP COLUMN free_welcome_print_used;

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
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_fkey;
ALTER TYPE plan_code RENAME TO plan_code_new;
CREATE TYPE plan_code AS ENUM ('plus', 'premium');
ALTER TABLE plans           ALTER COLUMN code       TYPE plan_code   USING 'plus'::plan_code;
ALTER TABLE subscriptions   ALTER COLUMN plan       TYPE plan_code   USING 'plus'::plan_code;
ALTER TABLE welcome_letters ALTER COLUMN plan       TYPE plan_code   USING 'plus'::plan_code;
ALTER TABLE promo_codes     ALTER COLUMN applies_to TYPE plan_code[]
  USING CASE WHEN applies_to IS NULL THEN NULL ELSE ARRAY['plus']::plan_code[] END;
DROP TYPE plan_code_new;
UPDATE plans
   SET name = 'ParkShield Plus', price_year_gross_cents = 1000,
       limits = '{"vehicles":2,"emergency_contacts":0,"co_drivers":0,"sms_per_month":0,"voice_minutes_per_month":0,"included_decals":1}'::jsonb
 WHERE code = 'plus';
INSERT INTO plans (code, name, availability, price_year_gross_cents, per_vehicle, limits) VALUES
 ('premium', 'ParkShield Premium', 'available', 1500, false,
  '{"vehicles":5,"emergency_contacts":3,"co_drivers":3,"sms_per_month":10,"voice_minutes_per_month":10,"included_decals":1}');
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_fkey FOREIGN KEY (plan) REFERENCES plans(code);
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
INSERT INTO app_settings (key, value) VALUES ('photos.plans', '["plus", "premium"]')
ON CONFLICT (key) DO NOTHING;
