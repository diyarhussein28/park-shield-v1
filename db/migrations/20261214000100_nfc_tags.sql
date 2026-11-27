-- migrate:up
-- NFC stickers, phase 2 (2026-11-27, docs/nfc-sticker-plan.md, docs/nfc-decals.md §6): the chip of each
-- in-house stock sticker is written, checked against the sticker's own URL and locked for good. Only a
-- locked sticker can be packed. The chip UID is kept as a blind index only; it proves nothing about
-- authenticity (it can be copied) and is never used for access decisions.
CREATE TABLE nfc_tags (
  qr_token_id  uuid PRIMARY KEY REFERENCES qr_tokens(id) ON DELETE CASCADE,
  chip         varchar(12) NOT NULL CHECK (chip IN ('NTAG215')),
  -- How it was written: Web NFC on an Android phone in the ops app, or the NFC Tools app by hand.
  method       varchar(12) CHECK (method IN ('web_nfc', 'nfc_tools')),
  uid_bidx     bytea UNIQUE,
  written_at   timestamptz,
  written_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at  timestamptz,
  verified_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  locked_at    timestamptz,
  locked_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- A chip is locked only after it was checked, and checked only after it was written.
  CONSTRAINT nfc_tags_order CHECK (
    (verified_at IS NULL OR written_at IS NOT NULL) AND (locked_at IS NULL OR verified_at IS NOT NULL)
  )
);

-- migrate:down
DROP TABLE nfc_tags;
