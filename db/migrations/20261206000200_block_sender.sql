-- migrate:up
-- Stage 3 (owner decision 2026-11-21): „Absender blockieren“ also ends the live chat at once. The
-- scanner then sees „Der Chat wurde beendet.“ (never that they were blocked).
ALTER TYPE chat_close_reason ADD VALUE IF NOT EXISTS 'blocked';

-- migrate:down
-- PostgreSQL cannot drop an enum value; chats closed as 'blocked' are relabelled 'owner'.
UPDATE chat_sessions SET close_reason = 'owner' WHERE close_reason::text = 'blocked';
