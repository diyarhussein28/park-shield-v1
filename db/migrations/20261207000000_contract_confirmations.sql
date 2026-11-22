-- migrate:up
-- § 312f BGB (2026-11-22): which document versions were sent with each contract confirmation
-- (e-mail + PDF „Vertragsbestätigung“). The PDF itself is not stored; its SHA-256 proves which file
-- was sent. Deleted with the subscription.
CREATE TABLE contract_confirmations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id             uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  locale                      varchar(2) NOT NULL CHECK (locale IN ('de', 'en')),
  -- LEGAL_DOC_VERSION of the AGB, the Widerrufsbelehrung and the Muster-Widerrufsformular sent.
  legal_doc_version           varchar(20) NOT NULL,
  renewal_mode                varchar(30) NOT NULL,
  immediate_start_consent_id  uuid,
  pdf_sha256                  bytea NOT NULL,
  sent_at                     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contract_confirmations_subscription_idx ON contract_confirmations(subscription_id);

-- migrate:down
DROP TABLE contract_confirmations;
