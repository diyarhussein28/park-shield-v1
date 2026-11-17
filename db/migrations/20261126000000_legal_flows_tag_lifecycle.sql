-- migrate:up
-- Checkout consent records, online withdrawal (§ 356a BGB), cancellation requests (§ 312k BGB),
-- renewal modes (§ 309 Nr. 9 BGB) and the tag lifecycle. Legal wording lives in legal_texts so it can
-- change without a deploy; every row there is a draft until the lawyer approves it (LEGAL_REVIEW.md).

-- Tag state is separate from shipping (decal_orders) and from the subscription.
CREATE TYPE tag_status AS ENUM ('in_stock', 'assigned', 'revoked');
DROP VIEW metrics.protection_score_distribution; -- reads qr_tokens.status, recreated below
ALTER TABLE qr_tokens ALTER COLUMN status DROP DEFAULT;
ALTER TABLE qr_tokens ALTER COLUMN status TYPE tag_status USING (
  CASE
    WHEN status = 'revoked' THEN 'revoked'
    WHEN vehicle_id IS NOT NULL THEN 'assigned'
    ELSE 'in_stock'
  END
)::tag_status;
ALTER TABLE qr_tokens ALTER COLUMN status SET DEFAULT 'in_stock';
DROP TYPE token_status;
ALTER TABLE qr_tokens ADD COLUMN assigned_at timestamptz;
UPDATE qr_tokens SET assigned_at = coalesce(activated_at, created_at) WHERE status = 'assigned';
ALTER TABLE qr_tokens ADD CONSTRAINT qr_tokens_status_vehicle CHECK (
  (status <> 'in_stock' OR vehicle_id IS NULL) AND (status <> 'assigned' OR vehicle_id IS NOT NULL)
);

CREATE VIEW metrics.protection_score_distribution AS
SELECT score, count(*)::int AS customers
  FROM (
    SELECT 25 * ((u.email_verified_at IS NOT NULL)::int
         + (EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
            OR EXISTS (SELECT 1 FROM contact_channels c WHERE c.user_id = u.id AND c.type = 'whatsapp'
                        AND c.verified_at IS NOT NULL AND c.is_enabled))::int
         + EXISTS (SELECT 1 FROM emergency_contacts e WHERE e.user_id = u.id AND e.consent = 'confirmed')::int
         + EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                    WHERE v.owner_user_id = u.id AND t.status <> 'revoked' AND t.last_test_at IS NOT NULL)::int)
           AS score
      FROM users u
     WHERE u.kind = 'customer'
       AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active', 'past_due'))
  ) x
 GROUP BY score;
GRANT SELECT ON metrics.protection_score_distribution TO metabase_ro;

-- The sticker is an accessory of the service, not made to the customer's specification: no
-- § 312g Abs. 2 Nr. 1 deduction on withdrawal. TODO [LEGAL REVIEW]
UPDATE app_settings SET value = '0', version = version + 1, updated_at = now()
 WHERE key = 'refunds.custom_decal_cost_cents' AND value = '250'::jsonb;

-- Append-only audit of every tag transition.
CREATE TABLE tag_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_token_id uuid NOT NULL REFERENCES qr_tokens(id) ON DELETE CASCADE,
  from_status tag_status,
  to_status   tag_status NOT NULL,
  actor       varchar(16) NOT NULL CHECK (actor IN ('system', 'owner', 'admin', 'stripe_webhook')),
  reason      varchar(60) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tag_events_token_idx ON tag_events(qr_token_id, created_at);
INSERT INTO tag_events (qr_token_id, from_status, to_status, actor, reason, created_at)
SELECT id, NULL, status, 'system', 'migrated', coalesce(assigned_at, created_at) FROM qr_tokens;

-- Append-only, except that a column may become NULL (ON DELETE SET NULL of a referenced row).
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(o) LOOP
    IF n -> k IS DISTINCT FROM o -> k AND n ->> k IS NOT NULL THEN
      RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER tag_events_append_only BEFORE UPDATE ON tag_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- FROM_STOCK fulfilment: the packer scans a pre-printed sticker before shipping.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'packed' AFTER 'in_production';

-- Subscriptions: withdrawal end state, monthly price after the first term, customer type.
ALTER TYPE subscription_state ADD VALUE IF NOT EXISTS 'withdrawn';
ALTER TYPE billing_interval ADD VALUE IF NOT EXISTS 'month';
ALTER TABLE subscriptions
  ADD COLUMN customer_type varchar(3) NOT NULL DEFAULT 'b2c' CHECK (customer_type IN ('b2c', 'b2b')),
  ADD COLUMN renewal_mode varchar(30) NOT NULL DEFAULT 'monthly_after_first_term'
    CHECK (renewal_mode IN ('annual', 'monthly_after_first_term')),
  ADD COLUMN immediate_start_consent_id uuid,
  ADD COLUMN past_due_since timestamptz,
  ADD COLUMN monthly_scheduled_at timestamptz,
  ADD COLUMN renewal_reminded_for timestamptz,
  ADD COLUMN withdrawn_at timestamptz;
UPDATE subscriptions SET past_due_since = updated_at WHERE status = 'past_due';

-- Versioned legal wording. The newest version per key and locale is the one shown.
CREATE TABLE legal_texts (
  key        varchar(60) NOT NULL,
  version    integer NOT NULL CHECK (version > 0),
  locale     ui_lang NOT NULL,
  body       text NOT NULL,
  sha256     bytea NOT NULL,
  created_by uuid, -- staff id, no FK: texts outlive accounts (and TRUNCATE users must not reach them)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, locale, version)
);
CREATE TRIGGER legal_texts_append_only BEFORE UPDATE ON legal_texts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

INSERT INTO legal_texts (key, version, locale, body, sha256) VALUES
 ('checkout.immediate_start', 1, 'de',
  'Ich verlange ausdrücklich, dass ParkShield bereits vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass ich bei einem Widerruf einen anteiligen Betrag (Wertersatz) für die bis dahin erbrachte Leistung zahlen muss.',
  sha256(convert_to('Ich verlange ausdrücklich, dass ParkShield bereits vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass ich bei einem Widerruf einen anteiligen Betrag (Wertersatz) für die bis dahin erbrachte Leistung zahlen muss.', 'UTF8'))),
 ('checkout.immediate_start', 1, 'en',
  'I expressly request that ParkShield starts the service before the withdrawal period ends. I know that if I withdraw, I must pay a proportionate amount (compensation for value) for the service provided until then.',
  sha256(convert_to('I expressly request that ParkShield starts the service before the withdrawal period ends. I know that if I withdraw, I must pay a proportionate amount (compensation for value) for the service provided until then.', 'UTF8'))),
 ('checkout.terms_ack', 1, 'de',
  'Mit Ihrer Bestellung gelten unsere AGB. Informationen zum Datenschutz finden Sie in der Datenschutzerklärung.',
  sha256(convert_to('Mit Ihrer Bestellung gelten unsere AGB. Informationen zum Datenschutz finden Sie in der Datenschutzerklärung.', 'UTF8'))),
 ('checkout.terms_ack', 1, 'en',
  'Our terms apply to your order. You find information on data protection in the privacy policy.',
  sha256(convert_to('Our terms apply to your order. You find information on data protection in the privacy policy.', 'UTF8')));

-- Every consent exactly as shown; never updated (the subscription links to its consent).
CREATE TABLE consent_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  type            varchar(24) NOT NULL CHECK (type IN ('immediate_start', 'agb', 'privacy_notice',
                    'marketing_doi', 'whatsapp_opt_in', 'emergency_contact')),
  text_key        varchar(60) NOT NULL,
  text_version    integer NOT NULL,
  text_hash       bytea NOT NULL,
  locale          ui_lang NOT NULL,
  accepted        boolean NOT NULL,
  accepted_at     timestamptz NOT NULL DEFAULT now(),
  ip_hash         bytea,
  source          varchar(10) NOT NULL CHECK (source IN ('checkout', 'portal', 'admin'))
);
CREATE INDEX consent_records_user_idx ON consent_records(user_id, accepted_at);
CREATE TRIGGER consent_records_append_only BEFORE UPDATE ON consent_records
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- § 356a BGB: every withdrawal is kept, matched or not; unmatched ones wait for ops.
CREATE TABLE withdrawal_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id        uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  submitted_name         varchar(120) NOT NULL,
  submitted_contract_ref varchar(254) NOT NULL,
  receipt_email          varchar(254) NOT NULL,
  locale                 ui_lang NOT NULL DEFAULT 'de',
  received_at            timestamptz NOT NULL DEFAULT now(),
  channel                varchar(12) NOT NULL CHECK (channel IN ('public_form', 'portal', 'email', 'admin')),
  status                 varchar(24) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'matched',
                           'processed', 'needs_review', 'rejected_out_of_period')),
  refund_amount_cents    integer,
  review_note            varchar(500),
  ip_hash                bytea,
  processed_at           timestamptz
);
CREATE INDEX withdrawal_requests_status_idx ON withdrawal_requests(status, received_at);

-- § 312k BGB: every cancellation is kept; the revoke link only works until the end date.
CREATE TABLE cancellation_requests (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id          uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  type                     varchar(13) NOT NULL CHECK (type IN ('ordinary', 'extraordinary')),
  reason                   varchar(1000),
  submitted_name           varchar(120),
  submitted_email          varchar(254),
  submitted_contract_ref   varchar(32),
  requested_effective_date date,
  computed_end_date        timestamptz,
  received_at              timestamptz NOT NULL DEFAULT now(),
  channel                  varchar(12) NOT NULL CHECK (channel IN ('public_form', 'portal', 'email', 'admin')),
  status                   varchar(20) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'scheduled',
                             'revoked_by_customer', 'needs_review', 'completed')),
  confirmation_sent_to     text[] NOT NULL DEFAULT '{}',
  revoke_token_hash        bytea UNIQUE,
  locale                   ui_lang NOT NULL DEFAULT 'de',
  review_note              varchar(500),
  ip_hash                  bytea
);
CREATE INDEX cancellation_requests_status_idx ON cancellation_requests(status, received_at);
CREATE INDEX cancellation_requests_sub_idx ON cancellation_requests(subscription_id);

-- migrate:down
DROP TABLE cancellation_requests;
DROP TABLE withdrawal_requests;
DROP TABLE consent_records;
DROP TABLE legal_texts;
ALTER TABLE subscriptions
  DROP COLUMN withdrawn_at,
  DROP COLUMN renewal_reminded_for,
  DROP COLUMN monthly_scheduled_at,
  DROP COLUMN past_due_since,
  DROP COLUMN immediate_start_consent_id,
  DROP COLUMN renewal_mode,
  DROP COLUMN customer_type;
-- Enum values ('withdrawn', 'month', 'packed') stay: PostgreSQL cannot drop them.
UPDATE subscriptions SET status = 'canceled' WHERE status = 'withdrawn';
UPDATE decal_orders SET status = 'in_production' WHERE status = 'packed';
UPDATE app_settings SET value = '250', version = version + 1, updated_at = now()
 WHERE key = 'refunds.custom_decal_cost_cents' AND value = '0'::jsonb;
DROP TABLE tag_events;
DROP FUNCTION forbid_change();
ALTER TABLE qr_tokens DROP CONSTRAINT qr_tokens_status_vehicle;
ALTER TABLE qr_tokens DROP COLUMN assigned_at;
CREATE TYPE token_status AS ENUM ('generated', 'printed', 'shipped', 'active', 'revoked');
DROP VIEW metrics.protection_score_distribution;
ALTER TABLE qr_tokens ALTER COLUMN status DROP DEFAULT;
ALTER TABLE qr_tokens ALTER COLUMN status TYPE token_status USING (
  CASE WHEN status = 'revoked' THEN 'revoked' WHEN status = 'assigned' THEN 'active' ELSE 'generated' END
)::token_status;
ALTER TABLE qr_tokens ALTER COLUMN status SET DEFAULT 'generated';
DROP TYPE tag_status;
CREATE VIEW metrics.protection_score_distribution AS
SELECT score, count(*)::int AS customers
  FROM (
    SELECT 25 * ((u.email_verified_at IS NOT NULL)::int
         + (EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
            OR EXISTS (SELECT 1 FROM contact_channels c WHERE c.user_id = u.id AND c.type = 'whatsapp'
                        AND c.verified_at IS NOT NULL AND c.is_enabled))::int
         + EXISTS (SELECT 1 FROM emergency_contacts e WHERE e.user_id = u.id AND e.consent = 'confirmed')::int
         + EXISTS (SELECT 1 FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id
                    WHERE v.owner_user_id = u.id AND t.status <> 'revoked' AND t.last_test_at IS NOT NULL)::int)
           AS score
      FROM users u
     WHERE u.kind = 'customer'
       AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status IN ('active', 'past_due'))
  ) x
 GROUP BY score;
GRANT SELECT ON metrics.protection_score_distribution TO metabase_ro;
