-- migrate:up
-- The yearly price the App Store / Google Play charged (2026-11-23): Apple has no 20,00 € price point,
-- so store subscriptions cost 19,99 €. Contract confirmation and payment@ show this price, not the
-- web price. Taken from RevenueCat (`subscriptions[].price`), else setting `prices.store_year_cents`.
ALTER TABLE subscriptions
  ADD COLUMN store_price_cents integer CHECK (store_price_cents >= 0);

-- migrate:down
ALTER TABLE subscriptions DROP COLUMN store_price_cents;
