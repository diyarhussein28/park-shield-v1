-- migrate:up
-- =============================================================================
-- ParkShield — PostgreSQL 18 schema (SRS v3)
-- Conventions
--  * PKs are UUIDs (UUID v7 generated in app; gen_random_uuid() as fallback).
--  * *_enc  = AES-256-GCM ciphertext (app-level envelope), bytea.
--  * *_bidx = HMAC-SHA256 blind index for equality lookups, bytea.
--  * *_hash = SHA-256 of a secret token. Raw secrets are never stored, except the
--    decal code, also kept as qr_tokens.code_enc so decal files can be re-rendered.
--  * key_version = data-encryption key that encrypted the row (rotation).
--  * No soft delete for personal data: GDPR erasure = hard delete / anonymise.
--  * v3 changes are marked with "-- v3".
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE user_kind          AS ENUM ('customer', 'staff');                       -- v3 (replaces user_role)
CREATE TYPE user_status        AS ENUM ('active', 'suspended', 'pending_deletion');
CREATE TYPE ui_lang            AS ENUM ('de', 'en');
CREATE TYPE channel_type       AS ENUM ('webpush', 'email', 'whatsapp', 'sms', 'voice', 'native_push'); -- v3 native_push
CREATE TYPE token_status       AS ENUM ('generated', 'printed', 'shipped', 'active', 'revoked');
CREATE TYPE consent_state      AS ENUM ('pending', 'confirmed', 'declined', 'revoked');
CREATE TYPE alert_severity     AS ENUM ('info', 'normal', 'urgent');
CREATE TYPE alert_status       AS ENUM ('created', 'blocked', 'dispatched', 'delivered',
                                        'acknowledged', 'escalated', 'expired');
CREATE TYPE owner_reply        AS ENUM ('coming', 'in_30_min', 'not_nearby');      -- v3 quick replies
CREATE TYPE delivery_status    AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'suppressed');
CREATE TYPE recipient_kind     AS ENUM ('owner', 'emergency_contact', 'co_driver', 'org_member'); -- v3 co_driver
CREATE TYPE moderation_state   AS ENUM ('not_required', 'passed', 'blocked', 'review');
CREATE TYPE plan_code          AS ENUM ('plus', 'premium', 'business');
CREATE TYPE plan_availability  AS ENUM ('available', 'coming_soon', 'retired');    -- v3
CREATE TYPE subscription_state AS ENUM ('incomplete', 'active', 'past_due', 'canceled', 'expired');
CREATE TYPE billing_interval   AS ENUM ('year');                                    -- v3 annual only
CREATE TYPE org_role           AS ENUM ('owner', 'manager', 'driver');
CREATE TYPE decal_product      AS ENUM ('a6_dashboard_card', 'uv_vinyl_sticker', 'nfc_vinyl_sticker');
CREATE TYPE order_status       AS ENUM ('pending_payment', 'paid', 'in_production', 'shipped',
                                        'delivered', 'returned', 'canceled', 'refunded'); -- v3 returned
CREATE TYPE dsr_type           AS ENUM ('access_export', 'erasure', 'rectification', 'restriction', 'objection');
CREATE TYPE dsr_status         AS ENUM ('received', 'awaiting_identity', 'in_progress', 'completed', 'rejected'); -- v3
CREATE TYPE step_status        AS ENUM ('pending', 'done', 'not_applicable', 'failed');  -- v3
CREATE TYPE abuse_status       AS ENUM ('open', 'actioned', 'dismissed');
CREATE TYPE chat_sender        AS ENUM ('scanner', 'owner', 'system');
CREATE TYPE break_glass_status AS ENUM ('requested', 'approved', 'rejected', 'expired', 'used'); -- v3
CREATE TYPE partner_kind       AS ENUM ('hausverwaltung', 'driving_school', 'dealer', 'rental', 'insurer', 'other'); -- v3
CREATE TYPE promo_kind         AS ENUM ('percent_off', 'amount_off', 'extra_months');  -- v3
CREATE TYPE refund_kind        AS ENUM ('withdrawal', 'proration', 'goodwill', 'decal_defect'); -- v3
CREATE TYPE vehicle_mode_kind  AS ENUM ('sensitive_spot', 'short_stop');           -- v3
CREATE TYPE transfer_status    AS ENUM ('pending', 'accepted', 'expired', 'canceled'); -- v3
CREATE TYPE review_decision    AS ENUM ('correct_block', 'false_positive', 'unclear'); -- v3
CREATE TYPE summary_frequency  AS ENUM ('off', 'weekly', 'monthly');               -- v3

-- ---------------------------------------------------------------------------
-- Identity & access
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  citext NOT NULL UNIQUE,
  email_verified_at      timestamptz,
  display_name           varchar(80),
  preferred_lang         ui_lang NOT NULL DEFAULT 'de',
  timezone               varchar(64) NOT NULL DEFAULT 'Europe/Berlin',
  kind                   user_kind NOT NULL DEFAULT 'customer',          -- v3
  status                 user_status NOT NULL DEFAULT 'active',
  stripe_customer_id     varchar(64) UNIQUE,
  zammad_user_id         integer UNIQUE,                                  -- v3 Zammad is ticket source of truth
  summary_frequency      summary_frequency NOT NULL DEFAULT 'monthly',    -- v3 OW-18
  activation_reminders   smallint NOT NULL DEFAULT 0,                     -- v3 OW-15
  last_login_at          timestamptz,
  deletion_due_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webauthn_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id bytea NOT NULL UNIQUE,
  public_key    bytea NOT NULL,
  sign_count    bigint NOT NULL DEFAULT 0,
  transports    text[],
  label         varchar(60),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE TABLE magic_link_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  user_agent   varchar(255),
  is_staff     boolean NOT NULL DEFAULT false,                            -- v3 staff sessions: 30 min idle
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- v3: fine-grained staff permissions (AD-02)
CREATE TABLE permissions (
  code        varchar(48) PRIMARY KEY,
  description varchar(200) NOT NULL
);
CREATE TABLE staff_roles (
  code varchar(32) PRIMARY KEY,
  name varchar(60) NOT NULL
);
CREATE TABLE staff_role_permissions (
  role_code       varchar(32) NOT NULL REFERENCES staff_roles(code) ON DELETE CASCADE,
  permission_code varchar(48) NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);
CREATE TABLE staff_role_assignments (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code  varchar(32) NOT NULL REFERENCES staff_roles(code) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);

INSERT INTO permissions (code, description) VALUES
 ('customer.read_masked',  'View customer 360 with masked fields'),
 ('alerts.read_metadata',  'View alert timeline and delivery trace (no content)'),
 ('pii.decrypt_request',   'Request break-glass decryption'),
 ('pii.decrypt_approve',   'Approve another staff member''s break-glass request'),
 ('tokens.manage',         'Revoke tokens, generate batches'),
 ('orders.manage',         'Manage decal orders and reprints'),
 ('abuse.moderate',        'Handle abuse reports and blocks'),
 ('moderation.review',     'Review sampled blocked messages'),
 ('dsr.process',           'Process GDPR data-subject requests'),
 ('billing.refund',        'Issue refunds and credit notes'),
 ('promo.manage',          'Create and edit promo codes'),
 ('partners.manage',       'Manage partners and batches'),
 ('settings.edit',         'Edit runtime settings and channel kill switches'),
 ('staff.manage',          'Assign staff roles'),
 ('audit.read',            'Read the audit trail');

INSERT INTO staff_roles (code, name) VALUES
 ('support', 'Support agent'), ('abuse_moderator', 'Abuse moderator'), ('finance', 'Finance'),
 ('fulfillment', 'Fulfillment'), ('analyst', 'Read-only analyst'), ('admin', 'Admin'), ('superadmin', 'Superadmin');

INSERT INTO staff_role_permissions (role_code, permission_code) VALUES
 ('support', 'customer.read_masked'), ('support', 'alerts.read_metadata'), ('support', 'pii.decrypt_request'),
 ('abuse_moderator', 'customer.read_masked'), ('abuse_moderator', 'abuse.moderate'), ('abuse_moderator', 'moderation.review'),
 ('finance', 'customer.read_masked'), ('finance', 'billing.refund'), ('finance', 'promo.manage'),
 ('fulfillment', 'orders.manage'), ('fulfillment', 'tokens.manage'), ('fulfillment', 'pii.decrypt_request'),
 ('admin', 'customer.read_masked'), ('admin', 'alerts.read_metadata'), ('admin', 'pii.decrypt_request'),
 ('admin', 'pii.decrypt_approve'), ('admin', 'tokens.manage'), ('admin', 'orders.manage'), ('admin', 'abuse.moderate'),
 ('admin', 'dsr.process'), ('admin', 'billing.refund'), ('admin', 'promo.manage'), ('admin', 'partners.manage'),
 ('admin', 'settings.edit'), ('admin', 'audit.read'),
 ('superadmin', 'staff.manage'), ('superadmin', 'audit.read'), ('superadmin', 'pii.decrypt_approve'), ('superadmin', 'settings.edit');

-- ---------------------------------------------------------------------------
-- Organisations (Business plan — "coming soon"; kept for forward compatibility)
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               varchar(120) NOT NULL,
  vat_id             varchar(20),
  billing_email      citext NOT NULL,
  stripe_customer_id varchar(64) UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            org_role NOT NULL DEFAULT 'driver',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- v3: Business waitlist (AD-21). Double opt-in before any contact.
CREATE TABLE business_waitlist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name    varchar(120) NOT NULL,
  contact_email   citext NOT NULL UNIQUE,
  fleet_size      integer CHECK (fleet_size > 0),
  industry        varchar(60),
  confirmed_at    timestamptz,
  contacted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Partners & promotions (v3)
-- ---------------------------------------------------------------------------
CREATE TABLE partners (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           varchar(120) NOT NULL,
  kind           partner_kind NOT NULL,
  contact_email  citext,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 100),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promo_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              citext NOT NULL UNIQUE,
  kind              promo_kind NOT NULL,
  value             integer NOT NULL CHECK (value > 0),   -- percent | cents | months
  stripe_coupon_id  varchar(64),
  partner_id        uuid REFERENCES partners(id) ON DELETE SET NULL,
  applies_to        plan_code[],                          -- NULL = all public plans
  price_lock_months smallint,                              -- founder price guarantee
  max_redemptions   integer,
  valid_until       timestamptz,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Contact channels (where the OWNER receives alerts)
-- ---------------------------------------------------------------------------
CREATE TABLE contact_channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         channel_type NOT NULL,
  address_enc  bytea,
  address_bidx bytea,
  key_version  smallint NOT NULL DEFAULT 1,
  priority     smallint NOT NULL DEFAULT 1,
  verified_at  timestamptz,
  opted_in_at  timestamptz,
  is_enabled   boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, type, address_bidx)
);
CREATE INDEX contact_channels_bidx ON contact_channels(address_bidx);

CREATE TABLE push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  platform     varchar(20),                                  -- v3 'ios','android','desktop' (for iOS KPI)
  device_label varchar(60),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_ok_at   timestamptz,
  failed_count smallint NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Vehicles & QR tokens
-- ---------------------------------------------------------------------------
CREATE TABLE vehicles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  nickname        varchar(60) NOT NULL,
  plate_enc       bytea,
  plate_bidx      bytea,
  key_version     smallint NOT NULL DEFAULT 1,
  make_model      varchar(80),
  color           varchar(30),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_has_owner CHECK (owner_user_id IS NOT NULL OR organization_id IS NOT NULL)
);
CREATE INDEX vehicles_owner_idx ON vehicles(owner_user_id);
CREATE INDEX vehicles_org_idx   ON vehicles(organization_id);

-- v3: co-drivers (Premium, OW-19). Must accept the invitation before receiving alerts.
CREATE TABLE vehicle_members (
  vehicle_id         uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent            consent_state NOT NULL DEFAULT 'pending',
  invited_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  invited_at         timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz,
  PRIMARY KEY (vehicle_id, user_id)
);

-- v3: transfer to a new owner after sale (OW-20). History is NOT transferred.
CREATE TABLE vehicle_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  from_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_email_bidx bytea NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,
  status        transfer_status NOT NULL DEFAULT 'pending',
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '14 days',
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);

-- v3: temporary modes (OW-17). short_stop shows "back at HH:MM" to scanners.
CREATE TABLE vehicle_modes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  mode        vehicle_mode_kind NOT NULL,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '12 hours')
);
CREATE INDEX vehicle_modes_active_idx ON vehicle_modes(vehicle_id, ends_at);

-- v3: admin batch generation for partners (AD-07)
CREATE TABLE token_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid REFERENCES partners(id) ON DELETE SET NULL,
  promo_code_id uuid REFERENCES promo_codes(id) ON DELETE SET NULL,
  quantity    integer NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  note        varchar(200),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qr_tokens (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id         uuid REFERENCES vehicles(id) ON DELETE CASCADE,   -- NULL until a pre-printed decal is claimed
  code_hash          bytea NOT NULL UNIQUE,
  code_enc           bytea NOT NULL,                                     -- v3 re-render PDF / Wallet / reprints
  key_version        smallint NOT NULL DEFAULT 1,                        -- v3
  code_hint          char(4) NOT NULL,
  status             token_status NOT NULL DEFAULT 'generated',
  cta_header         varchar(40) NOT NULL DEFAULT 'Kontaktieren Sie mich',
  design_template_id varchar(40) NOT NULL DEFAULT 'classic',
  batch_id           uuid REFERENCES token_batches(id) ON DELETE SET NULL, -- v3 FK
  activated_at       timestamptz,
  last_scanned_at    timestamptz,                                       -- v3 decal health (OW-15)
  last_test_at       timestamptz,                                       -- v3 owner self-test
  test_window_until  timestamptz,                                       -- v3 US-12: next scan before this is a test
  revoked_at         timestamptz,
  revoke_reason      varchar(120),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qr_tokens_vehicle_idx ON qr_tokens(vehicle_id);

CREATE TABLE emergency_contacts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id           uuid REFERENCES vehicles(id) ON DELETE CASCADE,  -- NULL = all vehicles
  display_name         varchar(60) NOT NULL,
  channel              channel_type NOT NULL,
  address_enc          bytea NOT NULL,
  address_bidx         bytea NOT NULL,
  key_version          smallint NOT NULL DEFAULT 1,
  escalation_order     smallint NOT NULL DEFAULT 1,
  consent              consent_state NOT NULL DEFAULT 'pending',
  consent_token_hash   bytea UNIQUE,
  consent_requested_at timestamptz NOT NULL DEFAULT now(),
  consent_decided_at   timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emergency_contacts_user_idx ON emergency_contacts(user_id);

CREATE TABLE notification_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id         uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  quiet_start        time NOT NULL,
  quiet_end          time NOT NULL,
  days_mask          smallint NOT NULL DEFAULT 127,
  urgent_override    boolean NOT NULL DEFAULT true,
  escalation_minutes smallint NOT NULL DEFAULT 7 CHECK (escalation_minutes BETWEEN 3 AND 30),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------
CREATE TABLE alert_types (
  code       varchar(32) PRIMARY KEY,
  severity   alert_severity NOT NULL,
  escalates  boolean NOT NULL DEFAULT false,
  label_de   varchar(80) NOT NULL,
  label_en   varchar(80) NOT NULL,
  sort_order smallint NOT NULL,
  is_active  boolean NOT NULL DEFAULT true
);

INSERT INTO alert_types (code, severity, escalates, label_de, label_en, sort_order) VALUES
 ('blocking',    'urgent', true,  'Fahrzeug versperrt Ausfahrt',         'Vehicle is blocking an exit',   1),
 ('lights_on',   'normal', false, 'Licht brennt noch',                   'Lights are still on',           2),
 ('window_open', 'normal', true,  'Fenster / Schiebedach offen',         'Window or sunroof open',        3),
 ('damage',      'urgent', true,  'Beschädigung / Parkschaden entdeckt', 'Damage / parking damage found', 4),
 ('alarm',       'normal', false, 'Alarmanlage ausgelöst',               'Alarm is going off',            5),
 ('towing_risk', 'urgent', true,  'Abschleppen droht',                   'Vehicle is about to be towed',  6),
 ('custom',      'normal', false, 'Eigene Nachricht',                    'Custom message',                7);

CREATE TABLE alerts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_token_id           uuid NOT NULL REFERENCES qr_tokens(id) ON DELETE CASCADE,
  vehicle_id            uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  alert_type            varchar(32) NOT NULL REFERENCES alert_types(code),
  severity              alert_severity NOT NULL,
  status                alert_status NOT NULL DEFAULT 'created',
  is_test               boolean NOT NULL DEFAULT false,                  -- v3 owner self-test
  custom_message_enc    bytea,
  key_version           smallint NOT NULL DEFAULT 1,
  moderation            moderation_state NOT NULL DEFAULT 'not_required',
  scanner_lang          ui_lang NOT NULL DEFAULT 'de',
  scanner_country       char(2),                                         -- v3 coarse geo for SC-13, no IP stored
  scanner_ref           bytea,                                           -- daily, all vehicles; nulled after 24 h
  block_ref             bytea,                                           -- v3 per vehicle, for 30-day blocks; nulled after 30 d
  status_view_hash      bytea NOT NULL,
  ack_token_hash        bytea UNIQUE,
  ack_token_expires_at  timestamptz,
  owner_reply           owner_reply,                                     -- v3 OW-16
  escalate_at           timestamptz,
  dispatched_at         timestamptz,
  acknowledged_at       timestamptz,
  scanner_waiting_at    timestamptz,                                     -- v3 SC-14 "still waiting"
  followup_sent_at      timestamptz,                                     -- v3 NT-09
  escalated_at          timestamptz,
  expires_at            timestamptz NOT NULL DEFAULT now() + interval '2 hours',
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_vehicle_created_idx ON alerts(vehicle_id, created_at DESC);
CREATE INDEX alerts_escalation_due_idx  ON alerts(escalate_at)          -- v3: includes acknowledged (in_30_min, still waiting)
  WHERE escalated_at IS NULL AND escalate_at IS NOT NULL
    AND status IN ('dispatched', 'delivered', 'acknowledged');
CREATE INDEX alerts_scanner_ref_idx     ON alerts(scanner_ref) WHERE scanner_ref IS NOT NULL;
CREATE INDEX alerts_token_created_idx   ON alerts(qr_token_id, created_at DESC);  -- v3 pattern detection

CREATE TABLE alert_deliveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id             uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  recipient            recipient_kind NOT NULL,
  emergency_contact_id uuid REFERENCES emergency_contacts(id) ON DELETE SET NULL,
  recipient_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,     -- v3 co-driver
  channel              channel_type NOT NULL,
  provider             varchar(30) NOT NULL,
  provider_message_id  varchar(128),
  status               delivery_status NOT NULL DEFAULT 'queued',
  suppressed_reason    varchar(40),                                      -- v3 quiet_hours, fair_use, kill_switch
  attempt              smallint NOT NULL DEFAULT 1,
  error_code           varchar(64),
  cost_micros_eur      integer,
  queued_at            timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  delivered_at         timestamptz,
  read_at              timestamptz
);
CREATE INDEX alert_deliveries_alert_idx        ON alert_deliveries(alert_id);
CREATE INDEX alert_deliveries_provider_msg_idx ON alert_deliveries(provider, provider_message_id);

CREATE TABLE alert_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id    uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  sender      chat_sender NOT NULL,
  body_enc    bytea NOT NULL,
  key_version smallint NOT NULL DEFAULT 1,
  moderation  moderation_state NOT NULL DEFAULT 'passed',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_messages_alert_idx ON alert_messages(alert_id, created_at);

-- v3: human review of sampled blocked messages (AD-09). Content stays in alerts (7 days).
CREATE TABLE moderation_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id    uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  rule_hit    varchar(60) NOT NULL,
  decision    review_decision,
  reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE TABLE abuse_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id    uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      varchar(40) NOT NULL,
  note        varchar(500),
  status      abuse_status NOT NULL DEFAULT 'open',
  handled_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  handled_at  timestamptz
);

-- v3: vehicle blocks use alerts.block_ref (30 d); global blocks use the daily scanner_ref (<= 24 h)
CREATE TABLE scanner_blocks (
  ref         bytea NOT NULL,
  qr_token_id uuid REFERENCES qr_tokens(id) ON DELETE CASCADE,  -- NULL = global block
  reason      varchar(40) NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= created_at + CASE WHEN qr_token_id IS NULL
                                         THEN interval '24 hours' ELSE interval '30 days' END)
);
CREATE INDEX scanner_blocks_ref_idx ON scanner_blocks(ref, expires_at);

-- ---------------------------------------------------------------------------
-- Plans, subscriptions, fair-use metering, refunds
-- ---------------------------------------------------------------------------
CREATE TABLE plans (
  code                   plan_code PRIMARY KEY,
  name                   varchar(40) NOT NULL,
  availability           plan_availability NOT NULL DEFAULT 'available',  -- v3
  price_year_gross_cents integer,                                         -- v3 NULL while coming_soon
  per_vehicle            boolean NOT NULL DEFAULT false,
  limits                 jsonb NOT NULL,   -- defaults; runtime overrides live in app_settings
  is_public              boolean NOT NULL DEFAULT true,
  CHECK (availability <> 'available' OR price_year_gross_cents IS NOT NULL)
);

INSERT INTO plans (code, name, availability, price_year_gross_cents, per_vehicle, limits) VALUES
 ('plus',     'ParkShield Plus',     'available',   1000, false,
  '{"vehicles":2,"emergency_contacts":1,"co_drivers":0,"whatsapp_per_month":10,"sms_per_month":0,"voice_minutes_per_month":0,"included_decals":1}'),
 ('premium',  'ParkShield Premium',  'available',   1500, false,
  '{"vehicles":5,"emergency_contacts":3,"co_drivers":3,"whatsapp_per_month":40,"sms_per_month":5,"voice_minutes_per_month":10,"included_decals":1}'),
 ('business', 'ParkShield Business', 'coming_soon', NULL, true, '{}');

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id        uuid REFERENCES organizations(id) ON DELETE CASCADE,
  plan                   plan_code NOT NULL REFERENCES plans(code),
  interval               billing_interval NOT NULL DEFAULT 'year',
  quantity               integer NOT NULL DEFAULT 1,
  status                 subscription_state NOT NULL,
  stripe_subscription_id varchar(64) UNIQUE,
  promo_code_id          uuid REFERENCES promo_codes(id) ON DELETE SET NULL, -- v3
  price_locked_until     timestamptz,                                         -- v3 founder guarantee
  withdrawal_waiver_at   timestamptz,
  current_period_start   timestamptz,                                         -- v3 needed for proration
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  canceled_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_has_subject CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL)
);
CREATE UNIQUE INDEX subscriptions_one_live_per_user ON subscriptions(user_id)
  WHERE status IN ('active', 'past_due') AND user_id IS NOT NULL;
CREATE UNIQUE INDEX subscriptions_one_live_per_org ON subscriptions(organization_id)
  WHERE status IN ('active', 'past_due') AND organization_id IS NOT NULL;

CREATE TABLE promo_redemptions (
  promo_code_id   uuid NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  redeemed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (promo_code_id, subscription_id)
);

CREATE TABLE usage_counters (
  subject_id uuid NOT NULL,
  period     date NOT NULL,
  metric     varchar(32) NOT NULL,
  value      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_id, period, metric)
);

-- ---------------------------------------------------------------------------
-- Decal shop
-- ---------------------------------------------------------------------------
CREATE TABLE decal_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES users(id) ON DELETE SET NULL,
  organization_id       uuid REFERENCES organizations(id) ON DELETE SET NULL,
  status                order_status NOT NULL DEFAULT 'pending_payment',
  shipping_address_enc  bytea NOT NULL,
  key_version           smallint NOT NULL DEFAULT 1,
  total_gross_cents     integer NOT NULL,
  included_in_plan      boolean NOT NULL DEFAULT false,
  is_replacement        boolean NOT NULL DEFAULT false,               -- v3 free replacement after abuse/defect
  stripe_payment_intent varchar(64) UNIQUE,
  print_partner_ref     varchar(64),
  tracking_number       varchar(64),
  created_at            timestamptz NOT NULL DEFAULT now(),
  shipped_at            timestamptz,
  delivered_at          timestamptz
);

CREATE TABLE decal_order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES decal_orders(id) ON DELETE CASCADE,
  qr_token_id      uuid NOT NULL REFERENCES qr_tokens(id) ON DELETE RESTRICT,
  product          decal_product NOT NULL,
  quantity         smallint NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_gross_cents integer NOT NULL
);

-- v3: refunds & withdrawals (AD-12)
CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id    uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  decal_order_id     uuid REFERENCES decal_orders(id) ON DELETE SET NULL,
  kind               refund_kind NOT NULL,
  paid_gross_cents   integer NOT NULL,
  wertersatz_cents   integer NOT NULL DEFAULT 0,   -- value of days used (withdrawal)
  decal_cost_cents   integer NOT NULL DEFAULT 0,   -- custom-printed decal excluded (§312g)
  refund_gross_cents integer NOT NULL CHECK (refund_gross_cents >= 0),
  stripe_refund_id   varchar(64) UNIQUE,
  credit_note_no     varchar(32) UNIQUE,
  requested_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (subscription_id IS NOT NULL OR decal_order_id IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Parking assistant (phase 2)
-- ---------------------------------------------------------------------------
CREATE TABLE parking_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id       uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  location_enc     bytea,
  key_version      smallint NOT NULL DEFAULT 1,
  meter_expires_at timestamptz,
  reminders_min    smallint[] NOT NULL DEFAULT '{10,5}',
  note             varchar(120),
  ended_at         timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parking_sessions_due_idx ON parking_sessions(meter_expires_at) WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- GDPR: consents, DSRs, processor steps, break-glass, audit
-- ---------------------------------------------------------------------------
CREATE TABLE consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      varchar(40) NOT NULL,
  doc_version  varchar(20) NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
CREATE INDEX consents_user_idx ON consents(user_id, purpose);

CREATE TABLE data_subject_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  email_bidx          bytea,
  type                dsr_type NOT NULL,
  status              dsr_status NOT NULL DEFAULT 'received',
  identity_verified_at timestamptz,                           -- v3
  verification_method varchar(40),                            -- v3 'session_reauth','email_link','manual'
  due_at              timestamptz NOT NULL DEFAULT now() + interval '30 days',
  completed_at        timestamptz,
  handled_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- v3: one row per processor; DSR cannot complete while any step is pending/failed.
CREATE TABLE dsr_processor_steps (
  dsr_id       uuid NOT NULL REFERENCES data_subject_requests(id) ON DELETE CASCADE,
  processor    varchar(30) NOT NULL,  -- 'parkshield_db','zammad','brevo','stripe','360dialog','print_partner','sentry'
  status       step_status NOT NULL DEFAULT 'pending',
  automated    boolean NOT NULL DEFAULT false,
  evidence_ref varchar(200),
  completed_at timestamptz,
  PRIMARY KEY (dsr_id, processor)
);

-- v3: four-eyes break-glass decryption (AD-06)
CREATE TABLE break_glass_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approver_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  target_entity varchar(40) NOT NULL,           -- 'decal_orders.shipping_address', 'vehicles.plate', ...
  target_id     uuid NOT NULL,
  reason        varchar(300) NOT NULL,
  ticket_ref    varchar(40),
  status        break_glass_status NOT NULL DEFAULT 'requested',
  notify_customer boolean NOT NULL DEFAULT true,
  approved_at   timestamptz,
  valid_until   timestamptz,                     -- approved_at + 15 min
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (approver_id IS NULL OR approver_id <> requester_id)
);

-- Append-only; also streamed to object storage with Object Lock (WORM). 12 months.
CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   uuid,
  actor_kind user_kind,
  action     varchar(64) NOT NULL,
  is_read    boolean NOT NULL DEFAULT false,     -- v3 read events (customer.view, pii.decrypt)
  entity     varchar(40) NOT NULL,
  entity_id  uuid,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx  ON audit_logs(entity, entity_id);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at);

CREATE FUNCTION audit_logs_no_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  -- DELETE allowed only for rows past retention (run_retention)
  IF OLD.created_at > now() - interval '12 months' THEN
    RAISE EXCEPTION 'audit_logs rows younger than 12 months cannot be deleted';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER audit_logs_guard BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_no_update();

-- ---------------------------------------------------------------------------
-- Runtime settings & provider health (v3)
-- ---------------------------------------------------------------------------
-- Keys e.g. 'fair_use.plus.whatsapp_per_month', 'channels.whatsapp.enabled',
-- 'escalation.default_minutes', 'moderation.blocklist_de'. Every change is audited.
CREATE TABLE app_settings (
  key        varchar(80) PRIMARY KEY,
  value      jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
 ('channels.webpush.enabled',  'true'),
 ('channels.email.enabled',    'true'),
 ('channels.whatsapp.enabled', 'true'),
 ('channels.sms.enabled',      'false'),
 ('escalation.default_minutes','7'),
 ('followup.after_ack_minutes','15'),
 ('moderation.sample_rate',    '0.10');

CREATE TABLE provider_status_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider    varchar(30) NOT NULL,   -- '360dialog','brevo','webpush','stripe','print_partner'
  metric      varchar(40) NOT NULL,   -- 'meta_quality_rating','template_status','bounce_rate','webhook_failures'
  value       varchar(60) NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_status_idx ON provider_status_events(provider, metric, captured_at DESC);

-- ---------------------------------------------------------------------------
-- Transactional outbox
-- ---------------------------------------------------------------------------
CREATE TABLE outbox_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic        varchar(64) NOT NULL,
  payload      jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     smallint NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending_idx ON outbox_events(available_at) WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TRIGGER users_touch         BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER organizations_touch BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER vehicles_touch      BEFORE UPDATE ON vehicles      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Retention job (hourly, idempotent)
-- ---------------------------------------------------------------------------
CREATE FUNCTION run_retention() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- pseudonymous scanner reference & coarse country: 24 h
  UPDATE alerts SET scanner_ref = NULL, scanner_country = NULL
   WHERE (scanner_ref IS NOT NULL OR scanner_country IS NOT NULL)
     AND created_at < now() - interval '24 hours';

  -- per-vehicle block reference: 30 days
  UPDATE alerts SET block_ref = NULL
   WHERE block_ref IS NOT NULL AND created_at < now() - interval '30 days';

  -- free text & chat (incl. blocked messages under review): 7 days
  UPDATE alerts SET custom_message_enc = NULL
   WHERE custom_message_enc IS NOT NULL AND created_at < now() - interval '7 days';
  DELETE FROM alert_messages WHERE created_at < now() - interval '7 days';
  DELETE FROM moderation_reviews WHERE created_at < now() - interval '30 days';

  -- expire open alerts
  UPDATE alerts SET status = 'expired'
   WHERE status IN ('created', 'dispatched', 'delivered') AND expires_at < now();

  -- alert history: 90 days
  DELETE FROM alerts WHERE created_at < now() - interval '90 days';

  -- parking location: 24 h after session end
  UPDATE parking_sessions SET location_enc = NULL
   WHERE location_enc IS NOT NULL AND ended_at < now() - interval '24 hours';

  -- shipping addresses: 90 days after delivery
  UPDATE decal_orders SET shipping_address_enc = '\x'::bytea
   WHERE delivered_at < now() - interval '90 days' AND octet_length(shipping_address_enc) > 0;

  -- auth artefacts, blocks, modes, transfers
  DELETE FROM magic_link_tokens WHERE expires_at < now() - interval '1 day';
  DELETE FROM sessions          WHERE expires_at < now() - interval '7 days';
  DELETE FROM scanner_blocks    WHERE expires_at < now();
  DELETE FROM vehicle_modes     WHERE ends_at < now() - interval '1 day';
  UPDATE vehicle_transfers SET status = 'expired' WHERE status = 'pending' AND expires_at < now();
  DELETE FROM vehicle_transfers WHERE created_at < now() - interval '90 days';

  -- break-glass windows
  UPDATE break_glass_requests SET status = 'expired'
   WHERE status IN ('requested', 'approved')
     AND COALESCE(valid_until, created_at + interval '24 hours') < now();

  -- unanswered / declined invitations: 14 days
  DELETE FROM emergency_contacts
   WHERE consent IN ('pending', 'declined') AND consent_requested_at < now() - interval '14 days';
  DELETE FROM vehicle_members
   WHERE consent IN ('pending', 'declined') AND invited_at < now() - interval '14 days';

  -- unconfirmed business waitlist entries: 30 days
  DELETE FROM business_waitlist WHERE confirmed_at IS NULL AND created_at < now() - interval '30 days';

  -- operational telemetry
  DELETE FROM provider_status_events WHERE captured_at < now() - interval '90 days';
  DELETE FROM outbox_events WHERE processed_at < now() - interval '7 days';

  -- audit trail: 12 months (trigger permits only these rows)
  DELETE FROM audit_logs WHERE created_at < now() - interval '12 months';

  -- due erasures (processor steps are handled by the DSR worker before this point)
  DELETE FROM users WHERE status = 'pending_deletion' AND deletion_due_at < now();
END $$;

-- migrate:down
-- Drops everything this migration created but keeps dbmate's schema_migrations table.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' AND tablename <> 'schema_migrations' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END $$;
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
