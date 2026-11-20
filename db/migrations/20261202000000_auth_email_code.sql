-- migrate:up
-- Sign-in by 6-digit code (AUTH.md): the same one-time row carries the link token and the code, so
-- using either invalidates both (used_at). The code is stored as an HMAC only; after 5 wrong attempts
-- the row is spent. return_url is the app's own return address (allowlisted in the API), looked up by
-- the bridge page through return_id, so the e-mail never carries the full address.
ALTER TABLE magic_link_tokens
  ADD COLUMN code_hash bytea,
  ADD COLUMN code_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN return_url text,
  ADD COLUMN return_id text UNIQUE;

-- migrate:down
ALTER TABLE magic_link_tokens
  DROP COLUMN IF EXISTS return_id,
  DROP COLUMN IF EXISTS return_url,
  DROP COLUMN IF EXISTS code_attempts,
  DROP COLUMN IF EXISTS code_hash;
