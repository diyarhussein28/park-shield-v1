-- migrate:up
-- US-45 permission review: each quarterly review is kept (the audit log has the details), so the ops app
-- knows when the next one is due. Inactive staff lose their roles automatically.
CREATE TABLE staff_access_reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  kept        integer NOT NULL,
  removed     integer NOT NULL,
  note        varchar(500) NOT NULL
);

INSERT INTO app_settings (key, value) VALUES
  ('staff.inactive_days', '90'),
  ('staff.review_interval_days', '90')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DELETE FROM app_settings WHERE key IN ('staff.inactive_days', 'staff.review_interval_days');
DROP TABLE staff_access_reviews;
