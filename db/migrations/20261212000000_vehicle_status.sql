-- migrate:up
-- „Bin gleich zurück“ / "Be right back" (owner spec 2026-11-26, docs/vehicle-status.md): one short,
-- temporary status message per vehicle, shown first on the scan page. No history: the row is deleted
-- on „Beenden“, at expiry (worker sweep), on „Sperren“, when the subscription ends and with the vehicle.
-- Behind the feature flag VEHICLE_STATUS_ENABLED.

-- „Ich warte“ (scanner one-tap while a status is on): an alert without text or photo, never escalated.
INSERT INTO alert_types (code, severity, escalates, label_de, label_en, sort_order) VALUES
 ('waiting', 'normal', false, 'Jemand wartet am Fahrzeug', 'Someone is waiting at the vehicle', 8);

CREATE TABLE vehicle_status (
  vehicle_id           uuid PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  preset_key           text CHECK (preset_key IN ('BACK_FEW_MIN', 'PLEASE_WAIT', 'QUICK_ERRAND', 'LOADING')),
  -- Plain text exactly as written (max. 150 grapheme clusters, checked by the API). The database bound
  -- counts code points: 150 graphemes can be more code points (emoji, combining marks), so it allows 600.
  custom_text          text CHECK (char_length(custom_text) <= 600),
  duration_min         smallint NOT NULL CHECK (duration_min IN (5, 10, 15, 30, 60)),
  started_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  -- Raised on every create/replace and „+5 Min“: a queued pre-expiry or expiry job of an older
  -- version is a no-op.
  version              integer NOT NULL DEFAULT 1,
  -- „1 Person wartet“: how many scanners tapped „Ich warte“ during this status (no one is identified).
  waiting_signal_count smallint NOT NULL DEFAULT 0,
  -- The API keeps expires_at at most 60 min ahead of the moment it writes it.
  CONSTRAINT vehicle_status_one_message CHECK ((preset_key IS NULL) <> (custom_text IS NULL)),
  CONSTRAINT vehicle_status_expiry_after_start CHECK (expires_at > started_at)
);
CREATE INDEX vehicle_status_expires_idx ON vehicle_status (expires_at);

-- „Sperren“ (and every other way a code is revoked) ends the status at once.
CREATE FUNCTION vehicle_status_on_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' AND NEW.vehicle_id IS NOT NULL THEN
    DELETE FROM vehicle_status WHERE vehicle_id = NEW.vehicle_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER qr_tokens_vehicle_status AFTER UPDATE OF status ON qr_tokens
  FOR EACH ROW EXECUTE FUNCTION vehicle_status_on_revoke();

-- The subscription ended (expired, withdrawn, refunded, paused, …): no status without protection.
CREATE FUNCTION vehicle_status_on_subscription_end() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid uuid := coalesce(NEW.user_id, OLD.user_id);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM subscriptions s
                  WHERE s.user_id = uid AND s.status IN ('active', 'past_due')) THEN
    DELETE FROM vehicle_status vs USING vehicles v
     WHERE v.id = vs.vehicle_id AND v.owner_user_id = uid;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER subscriptions_vehicle_status AFTER UPDATE OF status OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION vehicle_status_on_subscription_end();

-- migrate:down
DROP TRIGGER subscriptions_vehicle_status ON subscriptions;
DROP FUNCTION vehicle_status_on_subscription_end();
DROP TRIGGER qr_tokens_vehicle_status ON qr_tokens;
DROP FUNCTION vehicle_status_on_revoke();
DROP TABLE vehicle_status;
DELETE FROM alerts WHERE alert_type = 'waiting';
DELETE FROM alert_types WHERE code = 'waiting';
