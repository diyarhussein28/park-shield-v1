-- migrate:up
-- Internal payment notifications to PAYMENT_NOTIFY_EMAIL (2026-11-22): one row per Stripe event, so a
-- retried webhook never mails twice. The letter PDF is attached when the mail goes out (rendered on
-- demand, never stored); if that fails the attachment follows through the outbox.
CREATE TABLE payment_notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id     varchar(255) NOT NULL UNIQUE,
  kind                varchar(20) NOT NULL CHECK (kind IN ('subscription', 'renewal', 'print_order')),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id     uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  order_id            uuid REFERENCES decal_orders(id) ON DELETE SET NULL,
  amount_cents        integer NOT NULL,
  payment_ref         varchar(255),
  paid_at             timestamptz NOT NULL,
  sent_at             timestamptz,
  attachment_sent_at  timestamptz,
  attachment_failed   boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_notifications_user_idx ON payment_notifications(user_id);

-- migrate:down
DROP TABLE payment_notifications;
