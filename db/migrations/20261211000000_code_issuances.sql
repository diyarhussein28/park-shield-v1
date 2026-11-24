-- migrate:up
-- New-code rules (owner decision 2026-11-24, docs/handover.md §14): every decal code issued to a
-- vehicle is recorded once. The 10-day cooldown (`codes.reissue_cooldown_days`) counts from the newest
-- row of a vehicle; the free new code after a „Sperren“ is counted per subscription year
-- (`codes.free_reissues_per_year`). No personal data beyond the ids; rows go with the vehicle.
CREATE TYPE code_issue_kind AS ENUM (
  'legacy',          -- codes that existed before this table (backfill)
  'initial',         -- issued with the vehicle
  'free',            -- the owner's free new code after a „Sperren“
  'paid',            -- new code + printed sticker, 3 € through Stripe
  'ops_override',    -- staff issued one despite the cooldown (codes.override_cooldown)
  'ops_reissue',     -- staff revoked a code on the owner's behalf (abuse centre)
  'resubscribe',     -- a new subscription replaced the stickers
  'partner_claim'    -- a pre-printed partner decal was claimed
);

CREATE TABLE code_issuances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id              uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qr_token_id             uuid NOT NULL REFERENCES qr_tokens(id) ON DELETE CASCADE,
  kind                    code_issue_kind NOT NULL,
  subscription_id         uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  -- Start of the subscription year the issuance counts against (free new code: once per year).
  subscription_year_start timestamptz,
  -- Stripe Checkout session of a paid new code: one code per payment, however often the webhook comes.
  stripe_ref              varchar(255) UNIQUE,
  issued_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_issuances_vehicle ON code_issuances (vehicle_id, issued_at DESC);
CREATE INDEX code_issuances_free ON code_issuances (user_id, subscription_year_start)
  WHERE kind = 'free';

INSERT INTO code_issuances (vehicle_id, user_id, qr_token_id, kind, issued_at)
SELECT t.vehicle_id, v.owner_user_id, t.id, 'legacy', coalesce(t.assigned_at, t.created_at)
  FROM qr_tokens t JOIN vehicles v ON v.id = t.vehicle_id;

INSERT INTO permissions (code, description) VALUES
 ('codes.override_cooldown', 'Issue a new decal code despite the cooldown (support case, e.g. theft)');
INSERT INTO staff_role_permissions (role_code, permission_code) VALUES
 ('admin', 'codes.override_cooldown');

-- migrate:down
DELETE FROM staff_role_permissions WHERE permission_code = 'codes.override_cooldown';
DELETE FROM permissions WHERE code = 'codes.override_cooldown';
DROP TABLE code_issuances;
DROP TYPE code_issue_kind;
