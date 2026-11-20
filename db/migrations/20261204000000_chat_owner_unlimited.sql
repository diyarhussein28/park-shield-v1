-- migrate:up
-- Owner decision 2026-11-20: only the person at the vehicle (anonymous) has a message limit in the
-- live chat (chat.max_messages_per_side, default 20). The owner is a signed-in, paying customer: no
-- limit by default (0), editable in ops. The chat still ends after inactivity or its longest duration.
INSERT INTO app_settings (key, value) VALUES ('chat.max_owner_messages', '0')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DELETE FROM app_settings WHERE key = 'chat.max_owner_messages';
