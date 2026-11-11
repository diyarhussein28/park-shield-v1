-- migrate:up
-- NT-07: SMS through Twilio is available to every paid plan (Plus 5, Premium 10 per month; editable in
-- ops as limits.<plan>.sms_per_month). The kill switch starts switched on; costs are tracked per SMS.
UPDATE app_settings SET value = 'true', version = version + 1, updated_at = now()
 WHERE key = 'channels.sms.enabled' AND value = 'false'::jsonb;
UPDATE plans SET limits = jsonb_set(limits, '{sms_per_month}', '5') WHERE code = 'plus';
UPDATE plans SET limits = jsonb_set(limits, '{sms_per_month}', '10') WHERE code = 'premium';
INSERT INTO app_settings (key, value) VALUES ('sms.cost_micros', '100000')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DELETE FROM app_settings WHERE key = 'sms.cost_micros';
UPDATE plans SET limits = jsonb_set(limits, '{sms_per_month}', '5') WHERE code = 'premium';
UPDATE plans SET limits = jsonb_set(limits, '{sms_per_month}', '0') WHERE code = 'plus';
UPDATE app_settings SET value = 'false', version = version + 1, updated_at = now()
 WHERE key = 'channels.sms.enabled';
