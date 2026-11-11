-- migrate:up
-- US-22: default channel order, cheapest first (NT-01, NT-11). An owner's own order is stored as
-- contact_channels.priority; channels without an address (Push, e-mail) get one row per type.
INSERT INTO app_settings (key, value) VALUES
  ('channels.order', '["webpush", "email", "whatsapp"]'),
  ('followup.escalate_after_minutes', '5')
ON CONFLICT (key) DO NOTHING;

CREATE UNIQUE INDEX contact_channels_type_only_uq ON contact_channels(user_id, type)
  WHERE address_bidx IS NULL;

-- US-24: one invitation per address and owner; the escalation job looks up confirmed contacts.
CREATE UNIQUE INDEX emergency_contacts_address_uq ON emergency_contacts(user_id, address_bidx);
CREATE INDEX emergency_contacts_confirmed_idx ON emergency_contacts(user_id)
  WHERE consent = 'confirmed';

-- migrate:down
DROP INDEX emergency_contacts_confirmed_idx;
DROP INDEX emergency_contacts_address_uq;
DROP INDEX contact_channels_type_only_uq;
DELETE FROM app_settings WHERE key IN ('channels.order', 'followup.escalate_after_minutes');
