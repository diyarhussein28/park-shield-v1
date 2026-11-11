-- migrate:up
-- US-36: break-glass grants are valid 15 min; the customer is told once, on the first reveal.
ALTER TABLE break_glass_requests ADD COLUMN first_revealed_at timestamptz;

-- US-37: GDPR queue: one deadline reminder, notes from the handler, reason when rejected.
ALTER TABLE data_subject_requests ADD COLUMN reminded_at timestamptz;
ALTER TABLE data_subject_requests ADD COLUMN note varchar(500);

-- US-38 / AD-08: "revoke code on owner's behalf" comes with a free replacement decal.
ALTER TABLE users ADD COLUMN free_replacements smallint NOT NULL DEFAULT 0
  CHECK (free_replacements BETWEEN 0 AND 5);

-- AD-10: filter word lists with versions. The newest version is live; a rollback publishes an
-- old version again as a new one, so the history is never rewritten.
CREATE TABLE filter_word_lists (
  version    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  words      jsonb NOT NULL,          -- {"insults":{"de":[],"en":[]},"threats":{"de":[],"en":[]}}
  note       varchar(200),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO filter_word_lists (words, note) VALUES (
  '{"insults":{"de":["arsch","arschloch","idiot","wichser","fotze","hurensohn","spast","missgeburt","penner","schlampe","vollidiot","depp"],"en":["asshole","fuck","bitch","cunt","moron","retard"]},"threats":{"de":["umbringen","abstechen","kaputtmachen","zerkratzen","abfackeln"],"en":["kill you"]}}',
  'Initial lists');

INSERT INTO app_settings (key, value) VALUES
  ('abuse.code_alerts_per_hour', '10'),
  ('abuse.scanner_vehicles_per_day', '3'),
  ('abuse.scanner_reports_per_day', '2'),
  ('ops.alert_email', '"datenschutz@parkshield.de"')
ON CONFLICT (key) DO NOTHING;

-- migrate:down
DELETE FROM app_settings WHERE key IN ('abuse.code_alerts_per_hour', 'abuse.scanner_vehicles_per_day',
  'abuse.scanner_reports_per_day', 'ops.alert_email');
DROP TABLE filter_word_lists;
ALTER TABLE users DROP COLUMN free_replacements;
ALTER TABLE data_subject_requests DROP COLUMN note;
ALTER TABLE data_subject_requests DROP COLUMN reminded_at;
ALTER TABLE break_glass_requests DROP COLUMN first_revealed_at;
