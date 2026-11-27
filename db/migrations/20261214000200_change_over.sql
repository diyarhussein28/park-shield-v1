-- migrate:up
-- NFC stickers, phase 3 (2026-11-27, docs/nfc-sticker-plan.md): the change-over from a vehicle's old
-- code to the code of the stock sticker packed for it. The old code keeps working until the owner tests
-- the new sticker or until `retire_after` (shipping + `fulfillment.old_code_grace_days`, 14 days); the
-- worker then revokes it (reason `retired_change_over`).
ALTER TABLE qr_tokens ADD COLUMN retire_after timestamptz;
CREATE INDEX qr_tokens_retire_after_idx ON qr_tokens (retire_after)
  WHERE retire_after IS NOT NULL AND status = 'assigned';

-- A stock sticker packed for a vehicle is recorded in the code ledger. It is the physical form of the
-- vehicle's code, not a new code the owner asked for: it never starts the 10-day wait.
ALTER TYPE code_issue_kind ADD VALUE IF NOT EXISTS 'stock_sticker';

-- migrate:down
-- PostgreSQL cannot drop an enum value; 'stock_sticker' stays (unused after the rollback).
DROP INDEX qr_tokens_retire_after_idx;
ALTER TABLE qr_tokens DROP COLUMN retire_after;
