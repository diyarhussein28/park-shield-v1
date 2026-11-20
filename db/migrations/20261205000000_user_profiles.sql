-- migrate:up
-- Sign-up with name and postal address (owner decisions 2026-11-20, docs/app-redesign.md §6/§7).
-- Required before the first checkout; the welcome letter goes to this address. Every personal field
-- is encrypted at application level (hard rule 3). No blind index: nothing is looked up by these
-- values. The optional mobile number is not stored here: it is the verified SMS channel
-- (contact_channels), so there is only one copy of it.
-- Deleted with the account (ON DELETE CASCADE), part of the data export.
CREATE TYPE profile_source AS ENUM ('signup', 'completed_later');

CREATE TABLE user_profiles (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name_enc  bytea NOT NULL,
  last_name_enc   bytea NOT NULL,
  street_enc      bytea NOT NULL,
  postal_code_enc bytea NOT NULL,
  city_enc        bytea NOT NULL,
  country_enc     bytea NOT NULL,
  key_version     smallint NOT NULL DEFAULT 1,
  -- signup: completed before the first payment (gets the automatic welcome letter);
  -- completed_later: an account that already had a contract (no automatic letter).
  source          profile_source NOT NULL,
  completed_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- App lock (Face ID / fingerprint) after this many seconds in the background (AD-14, hard rule 6).
INSERT INTO app_settings (key, value) VALUES ('app.lock_after_seconds', '300')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DELETE FROM app_settings WHERE key = 'app.lock_after_seconds';
DROP TABLE user_profiles;
DROP TYPE profile_source;
