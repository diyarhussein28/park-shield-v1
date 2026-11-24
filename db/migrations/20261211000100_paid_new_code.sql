-- migrate:up
-- Paid new code (owner decision 2026-11-24, docs/handover.md §14 phase 3): 3 € = a new decal code plus
-- the printed and shipped sticker, paid through Stripe only (physical goods, never in-app purchase).
-- The order is placed like the 3 € print; when the payment arrives the webhook issues the new code
-- (recorded in code_issuances with stripe_ref = 'order:<id>') and the order prints it.
ALTER TABLE decal_orders ADD COLUMN new_code boolean NOT NULL DEFAULT false;
-- A refund never revokes the code (the car stays protected); it is only recorded.
ALTER TABLE code_issuances ADD COLUMN refunded_at timestamptz;

-- migrate:down
ALTER TABLE code_issuances DROP COLUMN refunded_at;
ALTER TABLE decal_orders DROP COLUMN new_code;
