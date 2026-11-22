# Unified billing and the personalised sticker (2026-11-22)

Task: `ParkShield-Billing-and-Sticker-Prompt.md` (owner). Option **A** was chosen: **our backend is the
entitlement hub**. RevenueCat webhooks (App Store / Google Play) and Stripe webhooks (website) both
update our own `subscriptions` table; app, website and scanner read only that table through our API.

## 1. Data model

`subscriptions` (one live row per account, any provider), new columns
(migration `20261208000000_unified_billing`):

| Column                      | Meaning                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| `provider`                  | `stripe` (default) · `app_store` · `play_store`                          |
| `store_original_transaction_id` | Apple/Google original transaction id (unique per provider)           |
| `store_product_id`          | Store product id (`parkshield_yearly`)                                  |
| `store_last_transaction_id` | Latest store transaction (payment@ mail)                                |
| `will_renew`                | Auto-renew on (Stripe: `NOT cancel_at_period_end`)                      |
| `original_purchase_at`      | First purchase                                                          |
| `refunded_at`               | Store or Stripe refund of the subscription                              |
| `management_url`            | Store subscription management (RevenueCat `management_url`)             |
| `sticker_value_cents`       | Sticker value included in the price at purchase (setting, 300)          |
| `withdrawal_notice_version` | Version of the Widerrufsbelehrung shown at purchase                     |

The DB enum `subscription_state` is unchanged (it is used everywhere); the API derives the unified
status: `ACTIVE` · `CANCEL_SCHEDULED` · `BILLING_ISSUE` · `EXPIRED` · `REFUNDED` · `WITHDRAWN`
(`unifiedStatus()` in `billing/unified-status.ts`). Plan is always `ANNUAL_20_EUR` (`plan_code` =
`standard`, yearly).

`billing_webhook_events (provider, event_id)` stores every webhook event id once (replays are ignored).

`decal_orders` new columns: `personalized_at`, `design_snapshot` (jsonb: `template`, `cta`, `label`),
`canceled_at`. An order is printed from its snapshot, never from the current design.

Settings (`app_settings`): `prices.sticker_value_cents` (300, incl. MwSt.),
`legal.withdrawal_notice_version` (current Widerrufsbelehrung version).

## 2. API contract (app and website)

- `GET /v1/me` also returns `id` (the user UUID = RevenueCat `app_user_id`).
- `GET /v1/billing/subscription` — the summary adds:
  `provider`, `unifiedStatus`, `willRenew`, `managementUrl` (store only), `stickerValueCents`,
  `refundRoute` (`'apple' | 'google' | null`). For store subscriptions `withdrawalOpenUntil` stays set
  (the button stays), but it leads to the store's refund route instead of our form.
- `POST /v1/billing/store/prepare` `{ platform: 'ios' | 'android', immediateStartVersion, termsVersion }`
  → `{ appUserId }`. Same gates as the web checkout (`already_subscribed`, `profile_incomplete`,
  `phone_required`); stores the immediate-start consent exactly like the web checkout (source
  `app_store` / `play_store`). Call it **before** opening the store purchase sheet.
- `POST /v1/billing/store/sync` → `{ status: 'active' | 'pending' }`. Reads the subscriber from the
  RevenueCat REST API now (no waiting for the webhook). Also used after „Käufe wiederherstellen“.
- `POST /v1/webhooks/revenuecat` — RevenueCat webhook, `Authorization` header = `REVENUECAT_WEBHOOK_AUTH`.
- `GET /v1/vehicles/:id/print-options` adds
  `personalization: { label, labelValid, template, cta }` and `addressPrefill` (profile address).
- `POST /v1/vehicles/:id/order-print` body: `{ address, personalizationConfirmed: true, appReturn? }`.
  Without `personalizationConfirmed: true` → 400. Invalid vehicle label → 422 `label_invalid`.
- Vehicle label (`nickname`): required, 2–20 characters, letters/numbers/spaces/basic punctuation,
  bad-word filter (`label_invalid`).

## 3. Store differences (Apple/Google are the seller)

- Cancel: „Vertrag hier kündigen“ opens `managementUrl` (fallback: Apple
  `https://apps.apple.com/account/subscriptions`, Google
  `https://play.google.com/store/account/subscriptions`) with a short explanation.
- Withdrawal/refund: Apple `https://reportaproblem.apple.com`, Google Play order history
  `https://play.google.com/store/account/orderhistory`. Our refund calculation runs only for Stripe.
- PDF: „Vertragsbestätigung“, not an invoice; the receipt comes from Apple/Google.
- payment@ mail: provider, store transaction id, gross price.

## 4. Refund formula (Stripe only)

`computeStickerWithdrawalRefund` in `apps/api/src/legal/rules.ts`:

```
stickerExcluded = sticker_value_cents  if a sticker was personalised before the withdrawal, else 0
serviceBase     = paid − stickerExcluded
usedDays        = whole days from service start to receipt (0 without immediate-start consent)
serviceValue    = round(serviceBase × usedDays / days in the contract year)
refund          = max(0, paid − stickerExcluded − serviceValue)
```

Example: 2000, sticker 300, 10 days → 2000 − 300 − round(1700 × 10 / 365) = 1653 (16,53 €).
`// TODO [LEGAL REVIEW]` — see `LEGAL_REVIEW.md` §12.

## 5. Store set-up (owner accounts)

- RevenueCat project „ParkShield“, apps iOS `de.parkshield.app` and Android `de.parkshield.app`,
  entitlement `parkshield_pro`, product `parkshield_yearly` (yearly, 20,00 € or the closest price point),
  offering `default`. Webhook URL `https://<domain>/v1/webhooks/revenuecat`, Authorization header =
  `REVENUECAT_WEBHOOK_AUTH`. Customer attributes: none. No IDFA collection.
- Server env: `REVENUECAT_SECRET_KEY` (v1 secret API key `sk_…`), `REVENUECAT_WEBHOOK_AUTH`,
  `REVENUECAT_ENTITLEMENT_ID` (default `parkshield_pro`).
- App env (public SDK keys): `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (`appl_…`),
  `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (`goog_…`). Real purchases need a development build (not Expo
  Go): Apple sandbox tester, Play internal test track, RevenueCat sandbox.
