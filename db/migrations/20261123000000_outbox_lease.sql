-- migrate:up
-- US-45 load test: the worker no longer holds a transaction while handlers run. It leases a batch
-- (locked_until) and works on it in parallel; a crashed worker's lease simply runs out and another
-- worker picks the events up again (at-least-once, handlers are idempotent).
ALTER TABLE outbox_events ADD COLUMN locked_until timestamptz;

-- Wake the worker at once instead of waiting for its next poll (scan → delivery latency).
CREATE FUNCTION outbox_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox_new', '');
  RETURN NULL;
END $$;
CREATE TRIGGER outbox_notify AFTER INSERT ON outbox_events
  FOR EACH STATEMENT EXECUTE FUNCTION outbox_notify();

-- migrate:down
DROP TRIGGER outbox_notify ON outbox_events;
DROP FUNCTION outbox_notify();
ALTER TABLE outbox_events DROP COLUMN locked_until;
