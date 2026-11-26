# „Bin gleich zurück“ / "Be right back" — temporary status message per vehicle

Owner spec of 2026-11-26. Behind the feature flag **`VEHICLE_STATUS_ENABLED`** (API env, default off).
Progress and open questions: [`handover.md`](handover.md) §23.

## What it does

The owner sets a short, temporary status message on a vehicle (e.g. a 3–4 minute errand). While it is
active, anyone who scans the vehicle's decal sees the message first, the time left and a one-tap
„Ich warte“; everything below the card is the normal scan page. „Ich warte“ creates an alert of the new
type `waiting` (no text, no photo, never escalated).

## Rules

| Rule | Where |
| --- | --- |
| Per vehicle, durations 5 · 10 · 15 · 30 · 60 min (default 10) | `packages/shared/src/vehicle-status.ts` |
| `expires_at` ≤ now + 60 min, also after „+5 Min“ (`least(...)` in SQL) | `VehicleStatusService.extend` |
| One preset (key) or one custom text (≤ 150 grapheme clusters, ≤ 2 line breaks, no phone numbers, e-mail addresses, links/domains, @handles) | `checkStatusText` (API authoritative, the app runs the same function) |
| Only for a vehicle with a current code and a subscription the scan page accepts | `VehicleStatusService.assertEligible` (same rule as `scannerDecision`) |
| Deleted on „Beenden“, at expiry, on „Sperren“ (any revoke), at the end of the subscription and with the vehicle | service, worker sweep, DB triggers, `ON DELETE CASCADE` |
| No history; only `waiting_signal_count` per status | table `vehicle_status` |
| Max. 30 status changes per vehicle and hour | rate limit `vehicle_status.change` (`ratelimit.vehicle_status.change` in ops) |

Presets (`packages/i18n`, scanner namespace `brbPreset_<KEY>`, rendered in the reader's language):
`BACK_FEW_MIN`, `PLEASE_WAIT`, `QUICK_ERRAND`, `LOADING`.

## Data

Migration `20261212000000_vehicle_status.sql`: table `vehicle_status` (PK `vehicle_id`, `preset_key` or
`custom_text`, `duration_min`, `started_at`, `expires_at`, `version`, `waiting_signal_count`), the alert
type `waiting`, and two triggers (`qr_tokens` revoked → delete; the user has no active/past-due
subscription any more → delete). The database bound of `custom_text` is 600 code points: the spec's
150 counts grapheme clusters, and one emoji can be several code points.

## API

Owner (session or app bearer, ownership checked, 404 for someone else's vehicle):

| Route | |
| --- | --- |
| `GET /v1/vehicles/:id/status` | `{ enabled, status | null }` — `enabled` tells the app whether to offer the button |
| `PUT /v1/vehicles/:id/status` | `{ presetKey }` or `{ customText }`, `durationMin` (default 10); create/replace, `version`++ |
| `POST /v1/vehicles/:id/status/extend` | `{ minutes: 5 }`; 409 `at_cap` at 60 min |
| `DELETE /v1/vehicles/:id/status` | „Beenden“ |

Errors: 404 `feature_disabled`, 409 `vehicle_inactive` / `subscription_inactive`, 422
`text_empty` / `text_too_long` / `text_too_many_lines` / `text_contact_data`, 429 `rate_limited`.

Scanner: `GET /v1/scan/:code` carries `vehicleStatus: { presetKey, customText, secondsLeft, minutesLeft }`
or `null` (checked on every scan, `expires_at > now()`). `POST /v1/scan/:code/waiting` `{ lang, captcha }`
→ 201 `{ alertId, statusToken }`, 200 `{ already: true }` (same scanner, same status: nothing sent), 409
`no_status`; captcha, blocks and the alert rate limits as for any alert.

## Background jobs (how the spec's „jobs“ map to this codebase)

There is no BullMQ in use (the package is a dependency but never imported): every create/replace and
„+5 Min“ queues two **delayed outbox events** in the same transaction — `vehicle_status.prewarn` at
`expires_at − 60 s` and `vehicle_status.expire` at `expires_at`, both with `{ vehicleId, version }`.
A handler whose version is no longer the row's does nothing. The worker also sweeps expired rows every
5 s (`vehicle_status.sweep`), and every read checks `expires_at > now()` itself.

## Pushes (FCM)

- Pre-expiry: „Bin gleich zurück läuft in 1 Min ab – verlängern?“, category `PS_BRB` with the actions
  „+5 Min“ and „Beenden“ (the app calls the endpoints), data `{ vehicleId, kind: 'brb_expiring' }`.
- Expiry: a silent data push `{ vehicleId, kind: 'brb_ended' }` (no notification), the app drops the banner.
- „Ich warte“: „Jemand wartet an Ihrem Fahrzeug.“ — **without the vehicle label**: FCM pushes carry no
  label, plate or name (AGENTS.md §7, owner decision 2026-11-21). The app shows the label in the alert.

## Differences from the spec text (confirmed by the owner 2026-11-26)

1. Push text without `{Fahrzeugname}` (see above). With one vehicle per plan it names no less.
2. Texts use „Sie“ like the rest of the app and the scan page; the spec's „du“ texts were adapted.
3. Jobs are delayed outbox events + a sweep, not BullMQ (see above).
