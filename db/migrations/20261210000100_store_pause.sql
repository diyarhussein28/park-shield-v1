-- migrate:up
-- Google Play lets a customer pause an auto-renewing subscription (on by default in Play Console).
-- RevenueCat reports it as `auto_resume_date` on the subscription: from the end of the paid period
-- until that date there is no protection and nothing is charged. The contract is not over: the row
-- stays `expired` (no entitlement) with `paused_until`, and comes back as the same contract when Play
-- resumes it (RENEWAL). While paused, checkout and the in-app purchase answer `subscription_paused`.
ALTER TABLE subscriptions ADD COLUMN paused_until timestamptz;

-- migrate:down
ALTER TABLE subscriptions DROP COLUMN paused_until;
