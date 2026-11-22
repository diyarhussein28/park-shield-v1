-- migrate:up
-- Unified billing (2026-11-22, docs/billing-unified.md): one subscription record for every provider.
-- Our backend is the entitlement hub; RevenueCat (App Store / Google Play) and Stripe webhooks both
-- update `subscriptions`. The personalised sticker (§ 312g Abs. 2 Nr. 1 BGB) is frozen on the order.
CREATE TYPE billing_provider AS ENUM ('stripe', 'app_store', 'play_store');

ALTER TABLE subscriptions
  ADD COLUMN provider                      billing_provider NOT NULL DEFAULT 'stripe',
  ADD COLUMN store_original_transaction_id varchar(255),
  ADD COLUMN store_product_id              varchar(255),
  ADD COLUMN store_last_transaction_id     varchar(255),
  ADD COLUMN will_renew                    boolean NOT NULL DEFAULT true,
  ADD COLUMN original_purchase_at          timestamptz,
  ADD COLUMN refunded_at                   timestamptz,
  ADD COLUMN management_url                text,
  ADD COLUMN sticker_value_cents           integer NOT NULL DEFAULT 0 CHECK (sticker_value_cents >= 0),
  ADD COLUMN withdrawal_notice_version     varchar(40);

UPDATE subscriptions
   SET will_renew = NOT cancel_at_period_end,
       original_purchase_at = coalesce(current_period_start, created_at);

CREATE UNIQUE INDEX subscriptions_store_txn_uq
  ON subscriptions (provider, store_original_transaction_id)
  WHERE store_original_transaction_id IS NOT NULL;

-- At most one live subscription per account from any provider: the existing unique index
-- `subscriptions_one_live_per_user` (schema v3) covers store subscriptions too.

-- Every webhook event once (Stripe and RevenueCat retry and replay).
CREATE TABLE billing_webhook_events (
  provider      varchar(20) NOT NULL CHECK (provider IN ('stripe', 'revenuecat')),
  event_id      varchar(255) NOT NULL,
  type          varchar(80) NOT NULL,
  app_user_id   uuid,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  PRIMARY KEY (provider, event_id)
);

-- The personalised sticker: the customer's choices frozen at confirmation; only then printed.
ALTER TABLE decal_orders
  ADD COLUMN personalized_at  timestamptz,
  ADD COLUMN design_snapshot  jsonb,
  ADD COLUMN canceled_at      timestamptz;

-- Push reminders for the welcome print (after 1 and 3 days).
ALTER TABLE users ADD COLUMN welcome_print_reminders smallint NOT NULL DEFAULT 0;

-- migrate:down
ALTER TABLE users DROP COLUMN welcome_print_reminders;
ALTER TABLE decal_orders
  DROP COLUMN canceled_at,
  DROP COLUMN design_snapshot,
  DROP COLUMN personalized_at;
DROP TABLE billing_webhook_events;
DROP INDEX subscriptions_store_txn_uq;
ALTER TABLE subscriptions
  DROP COLUMN withdrawal_notice_version,
  DROP COLUMN sticker_value_cents,
  DROP COLUMN management_url,
  DROP COLUMN refunded_at,
  DROP COLUMN original_purchase_at,
  DROP COLUMN will_renew,
  DROP COLUMN store_last_transaction_id,
  DROP COLUMN store_product_id,
  DROP COLUMN store_original_transaction_id,
  DROP COLUMN provider;
DROP TYPE billing_provider;
