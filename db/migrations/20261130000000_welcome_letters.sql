-- migrate:up
-- Welcome letter (printed and posted) and QR export in the back office.

-- Human-readable customer number, e.g. PS-2026-000123. Customers only; staff accounts get none.
CREATE SEQUENCE customer_no_seq;
ALTER TABLE users ADD COLUMN customer_no varchar(16) UNIQUE;
WITH o AS (
  SELECT id, created_at, row_number() OVER (ORDER BY created_at, id) AS n
    FROM users WHERE kind = 'customer'
)
UPDATE users u
   SET customer_no = 'PS-' || to_char(o.created_at AT TIME ZONE 'Europe/Berlin', 'YYYY') || '-'
                     || lpad(o.n::text, 6, '0')
  FROM o WHERE o.id = u.id;
SELECT setval('customer_no_seq', GREATEST(count(*), 1), count(*) > 0)
  FROM users WHERE kind = 'customer';

CREATE FUNCTION assign_customer_no() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'customer' AND NEW.customer_no IS NULL THEN
    NEW.customer_no := 'PS-' || to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY') || '-'
                       || lpad(nextval('customer_no_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_customer_no BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION assign_customer_no();

-- Company data printed on letters. Every save is a new version; the highest version is in force.
-- Without any row the built-in company data (packages/shared COMPANY) is version 0.
CREATE TABLE company_profiles (
  version       integer PRIMARY KEY CHECK (version > 0),
  data          jsonb NOT NULL,
  logo_png      bytea,                     -- uploaded images, re-encoded as PNG for the PDF
  signature_png bytea,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE welcome_letter_status AS ENUM ('new', 'downloaded', 'sent');

-- One letter per customer, created once (paid + first vehicle); "Neu erstellen" adds a version.
-- The PDF is never stored: it is rendered from the frozen snapshot, which holds the name, the
-- postal address and the plate and is therefore encrypted as a whole (hard rule 3).
-- Deleted with the customer account (ON DELETE CASCADE, run_retention deletes the user).
-- TODO [LEGAL REVIEW]: retention of copies of sent business letters (§ 257 HGB, 6 years) vs.
-- deletion with the account.
CREATE TABLE welcome_letters (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version             smallint NOT NULL CHECK (version > 0),
  status              welcome_letter_status NOT NULL DEFAULT 'new',
  plan                plan_code NOT NULL,
  address_missing     boolean NOT NULL DEFAULT false,
  snapshot_enc        bytea NOT NULL,
  key_version         smallint NOT NULL DEFAULT 1,
  company_version     integer NOT NULL,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL, -- NULL: created by the system
  created_at          timestamptz NOT NULL DEFAULT now(),
  first_downloaded_at timestamptz,
  sent_at             timestamptz,
  UNIQUE (user_id, version)
);
CREATE INDEX welcome_letters_status_created ON welcome_letters (status, created_at);

-- letters.print shows full names, addresses, plates and decal codes (letter and QR files): a
-- documented exception to the masked back office, audited on every view and download.
INSERT INTO permissions (code, description) VALUES
 ('letters.print',  'Preview and download welcome letters and decal QR codes, mark letters sent'),
 ('letters.manage', 'Re-create welcome letters and edit the company data on letters');
INSERT INTO staff_role_permissions (role_code, permission_code) VALUES
 ('admin', 'letters.print'), ('admin', 'letters.manage'), ('fulfillment', 'letters.print');

-- migrate:down
DELETE FROM staff_role_permissions WHERE permission_code IN ('letters.print', 'letters.manage');
DELETE FROM permissions WHERE code IN ('letters.print', 'letters.manage');
DELETE FROM app_settings WHERE key IN ('welcome_letter.in_portal', 'qr.caption');
DROP TABLE welcome_letters;
DROP TYPE welcome_letter_status;
DROP TABLE company_profiles;
DROP TRIGGER users_customer_no ON users;
DROP FUNCTION assign_customer_no();
ALTER TABLE users DROP COLUMN customer_no;
DROP SEQUENCE customer_no_seq;
