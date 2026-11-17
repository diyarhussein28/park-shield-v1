-- migrate:up
-- Phase 2: optional photo evidence for alerts (behind ALERT_PHOTOS_ENABLED and the plan setting
-- photos.plans). Photos live encrypted on disk outside the web root; each file has its own AES-256-GCM
-- key, stored here wrapped with the data key (envelope encryption). Deleting the wrapped key makes every
-- copy of the file unreadable (crypto-shredding), including copies that ended up in a backup.
CREATE TABLE alert_media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id       uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  position       smallint NOT NULL CHECK (position BETWEEN 1 AND 2),
  storage_key    uuid,                 -- random file name, nothing else; NULL after deletion
  wrapped_key    bytea,                -- per-file key encrypted with DATA_KEY_V<n>; NULL = shredded
  mime_type      varchar(20) NOT NULL DEFAULT 'image/jpeg',
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  width          integer NOT NULL CHECK (width > 0),
  height         integer NOT NULL CHECK (height > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,                    -- created_at + 30 days
  deleted_at     timestamptz,
  deleted_reason varchar(20) CHECK (deleted_reason IN ('retention', 'abuse_report', 'owner_deleted')),
  UNIQUE (alert_id, position),
  -- Deletion order is key, file, row: a row may lose its key before deleted_at is set, never after.
  CHECK (deleted_at IS NULL OR (storage_key IS NULL AND wrapped_key IS NULL AND deleted_reason IS NOT NULL))
);
CREATE INDEX alert_media_due_idx ON alert_media(expires_at) WHERE deleted_at IS NULL;
CREATE INDEX alert_media_storage_idx ON alert_media(storage_key) WHERE storage_key IS NOT NULL;

-- One view link per alert with photos, for every channel. Only the SHA-256 of the token is stored.
CREATE TABLE alert_view_tokens (
  alert_id   uuid PRIMARY KEY REFERENCES alerts(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- After a photo abuse report: no photo uploads for this vehicle for a while (photos.abuse_upload_block_hours),
-- because the scanner reference used for the per-vehicle block may change.
CREATE TABLE vehicle_photo_upload_blocks (
  vehicle_id uuid PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  until      timestamptz NOT NULL
);

-- Where an owner report came from (view page, portal history, e-mail link). NULL for older reports.
ALTER TABLE abuse_reports ADD COLUMN source varchar(20)
  CHECK (source IN ('view_page', 'portal', 'email_link'));

INSERT INTO app_settings (key, value) VALUES
  ('photos.plans', '["premium"]'),
  ('photos.abuse_block_days', '30'),
  ('photos.abuse_upload_block_hours', '24')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DELETE FROM app_settings
 WHERE key IN ('photos.plans', 'photos.abuse_block_days', 'photos.abuse_upload_block_hours');
ALTER TABLE abuse_reports DROP COLUMN source;
DROP TABLE vehicle_photo_upload_blocks;
DROP TABLE alert_view_tokens;
DROP TABLE alert_media;
