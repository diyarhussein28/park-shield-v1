-- migrate:up
-- NFC stickers from our own stock, phase 1 (owner decisions 2026-11-27, docs/nfc-sticker-plan.md):
-- in-house batches of generic QR + NFC stickers next to the partner batches, a printed serial number
-- per in-house sticker (`PS-000001`), and a separate permission for the production export (it holds
-- every code of a batch).

ALTER TABLE token_batches
  -- `partner`: pre-printed partner decals that customers claim in the app (AD-07).
  -- `inhouse_nfc`: our own stock; only staff assign it to an order (packing), never a customer.
  ADD COLUMN kind varchar(12) NOT NULL DEFAULT 'partner' CHECK (kind IN ('partner', 'inhouse_nfc')),
  ADD COLUMN chip varchar(12) CHECK (chip IN ('NTAG215')),
  ADD CONSTRAINT token_batches_chip_kind CHECK ((kind = 'inhouse_nfc') = (chip IS NOT NULL));

-- Printed on the sticker and used by staff to find it; never derived from the code. Counts up across
-- all in-house batches.
CREATE SEQUENCE qr_tokens_serial_seq AS integer START 1;
ALTER TABLE qr_tokens ADD COLUMN serial_no integer UNIQUE;

INSERT INTO permissions (code, description) VALUES
 ('tokens.export', 'Download production files of in-house sticker batches (CSV and QR images with every code)');
INSERT INTO staff_role_permissions (role_code, permission_code) VALUES ('admin', 'tokens.export');

-- migrate:down
DELETE FROM staff_role_permissions WHERE permission_code = 'tokens.export';
DELETE FROM permissions WHERE code = 'tokens.export';
ALTER TABLE qr_tokens DROP COLUMN serial_no;
DROP SEQUENCE qr_tokens_serial_seq;
ALTER TABLE token_batches DROP CONSTRAINT token_batches_chip_kind;
ALTER TABLE token_batches DROP COLUMN chip;
ALTER TABLE token_batches DROP COLUMN kind;
