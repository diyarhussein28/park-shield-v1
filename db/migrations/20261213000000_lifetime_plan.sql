-- migrate:up
-- Lifetime plan (owner decision 2026-11-26): the same plan „ParkShield“ for one vehicle, paid once
-- (29,99 € incl. VAT) instead of 19,99 € every year. It is a row in `subscriptions` like every other
-- contract (the entitlement hub), with interval 'lifetime', no period end, no renewal.
-- Stripe: a one-time Checkout payment (no Stripe subscription), so its payment intent identifies the
-- contract (idempotency of webhook + return confirm, refunds on withdrawal).
-- App Store / Google Play: a non-consumable product granting the same RevenueCat entitlement.
ALTER TYPE billing_interval ADD VALUE IF NOT EXISTS 'lifetime';
ALTER TABLE subscriptions ADD COLUMN stripe_payment_intent text UNIQUE;

-- migrate:down
ALTER TABLE subscriptions DROP COLUMN stripe_payment_intent;
-- Enum values cannot be dropped in PostgreSQL; 'lifetime' stays (unused after a rollback).
