-- migrate:up
-- Owner decision 2026-11-20: alert photos are part of both plans, Plus and Premium. The feature itself
-- stays behind ALERT_PHOTOS_ENABLED. A value an admin already changed in ops is left alone; only the old
-- default (Premium only) moves to the new one.
UPDATE app_settings SET value = '["plus", "premium"]', version = version + 1, updated_at = now()
 WHERE key = 'photos.plans' AND value = '["premium"]'::jsonb;
INSERT INTO app_settings (key, value) VALUES ('photos.plans', '["plus", "premium"]')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
UPDATE app_settings SET value = '["premium"]', version = version + 1, updated_at = now()
 WHERE key = 'photos.plans' AND value = '["plus", "premium"]'::jsonb;
