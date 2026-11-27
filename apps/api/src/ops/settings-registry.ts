import { z } from 'zod';
import { DEFAULT_VERIFY_COUNTRIES } from '../abuse/phone';

export type SettingGroup =
  | 'channels'
  | 'escalation'
  | 'limits'
  | 'abuse'
  | 'refunds'
  | 'contracts'
  | 'health'
  | 'reminders'
  | 'chat'
  | 'general';

interface Def {
  group: SettingGroup;
  schema: z.ZodType;
  default: unknown;
  /** Kill switches (AD-15): shown separately, a reason is required. */
  killSwitch?: true;
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const bool = z.boolean();

/**
 * AD-14: what ops may change without a deploy. Only these keys are editable, each with its type
 * and bounds; the code reads them through SettingsService with the same defaults (hard rule 6).
 */
export const SETTINGS: Record<string, Def> = {
  'channels.native_push.enabled': {
    group: 'channels',
    schema: bool,
    default: true,
    killSwitch: true,
  },
  'channels.webpush.enabled': { group: 'channels', schema: bool, default: true, killSwitch: true },
  'channels.email.enabled': { group: 'channels', schema: bool, default: true, killSwitch: true },
  'channels.sms.enabled': { group: 'channels', schema: bool, default: true, killSwitch: true },

  // Escalation (owner decision 2026-11-21): reminder push, then ONE SMS (both counted from the alert).
  'escalation.reminder_minutes': { group: 'escalation', schema: int(1, 60), default: 10 },
  'escalation.sms_minutes': { group: 'escalation', schema: int(5, 240), default: 30 },
  'followup.after_ack_minutes': { group: 'escalation', schema: int(5, 120), default: 15 },
  // Owner-initiated live chat.
  'chat.inactivity_minutes': { group: 'chat', schema: int(5, 120), default: 20 },
  'chat.max_minutes': { group: 'chat', schema: int(30, 720), default: 180 },
  'chat.max_message_chars': { group: 'chat', schema: int(50, 1000), default: 500 },
  // The person at the vehicle (anonymous, the spam risk). The key keeps its old name.
  'chat.max_messages_per_side': { group: 'chat', schema: int(1, 100), default: 20 },
  // The owner (a paying, signed-in customer): 0 = no limit. The chat still ends after inactivity or
  // its longest duration.
  'chat.max_owner_messages': { group: 'chat', schema: int(0, 1000), default: 0 },
  'chat.quick_replies': {
    group: 'chat',
    schema: z.object({
      de: z.array(z.string().min(1).max(120)).max(8),
      en: z.array(z.string().min(1).max(120)).max(8),
    }),
    default: {
      de: [
        'Ich bin in 2 Minuten am Fahrzeug.',
        'Ich komme sofort.',
        'Vielen Dank für den Hinweis!',
        'Ich kümmere mich darum.',
      ],
      en: [
        'I will be at the car in 2 minutes.',
        'I am coming right away.',
        'Thank you for letting me know!',
        'I will take care of it.',
      ],
    },
  },

  // One all-inclusive plan (owner decision 2026-11-21): one vehicle per account for now.
  'limits.vehicles': { group: 'limits', schema: int(1, 20), default: 1 },
  // Safety cap for escalation SMS per account and calendar month (NT-05).
  'sms.monthly_cap': { group: 'limits', schema: int(0, 200), default: 20 },
  'fair_use.warn_percent': { group: 'limits', schema: int(50, 100), default: 80 },
  'sms.cost_micros': { group: 'limits', schema: int(0, 1_000_000), default: 100_000 },
  // Prices in euro cents incl. 19 % VAT. The yearly price must match the Stripe price
  // (STRIPE_PRICE_YEARLY); it is what the app, the website and the fake checkout show.
  'prices.plan_year_cents': { group: 'limits', schema: int(100, 100_000), default: 1999 },
  // A printed and shipped decal after the free welcome print (one-time Stripe payment).
  'prices.print_shipped_cents': { group: 'limits', schema: int(0, 5000), default: 300 },
  // B2 (2026-11-22): value of the personalised sticker incl. shipping included in the yearly price
  // (incl. VAT). Stored on each subscription at purchase; withheld on a withdrawal after
  // personalisation (§ 312g Abs. 2 Nr. 1 BGB). TODO [LEGAL REVIEW]
  // App Store / Google Play yearly price for contract confirmations when RevenueCat reports none.
  'prices.store_year_cents': { group: 'limits', schema: int(100, 100_000), default: 1999 },
  'prices.sticker_value_cents': { group: 'limits', schema: int(0, 2000), default: 300 },
  // Lifetime plan (owner decision 2026-11-26): paid once, no renewal. Stripe charges exactly this
  // (one-time Checkout); the store price string wins in the app, this is the fallback for confirmations.
  'prices.lifetime_cents': { group: 'limits', schema: int(100, 100_000), default: 2999 },
  'prices.store_lifetime_cents': { group: 'limits', schema: int(100, 100_000), default: 2999 },
  // New decal code (owner decision 2026-11-24): at most one per vehicle in this many days, counted
  // from the newest code of the vehicle; and this many free new codes after a „Sperren“ per
  // subscription year (more cost the 3 € print, `prices.print_shipped_cents`).
  'codes.reissue_cooldown_days': { group: 'limits', schema: int(0, 365), default: 10 },
  'codes.free_reissues_per_year': { group: 'limits', schema: int(0, 12), default: 1 },

  'abuse.code_alerts_per_hour': { group: 'abuse', schema: int(1, 1000), default: 10 },
  'abuse.scanner_vehicles_per_day': { group: 'abuse', schema: int(1, 100), default: 3 },
  'abuse.scanner_reports_per_day': { group: 'abuse', schema: int(1, 100), default: 2 },
  'moderation.sample_rate': { group: 'abuse', schema: z.number().min(0).max(1), default: 0.1 },
  // Abuse protection (Protected Mode, phone check, phone bans). Defaults match the code.
  'abuse.protected_mode_reports': { group: 'abuse', schema: int(1, 20), default: 2 },
  'abuse.protected_mode_window_days': { group: 'abuse', schema: int(1, 90), default: 30 },
  'abuse.protected_mode_days': { group: 'abuse', schema: int(1, 90), default: 30 },
  'abuse.verification_minutes': { group: 'abuse', schema: int(5, 30), default: 30 },
  'abuse.verify_countries': {
    group: 'abuse',
    schema: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(60),
    default: DEFAULT_VERIFY_COUNTRIES,
  },
  // The owner's mobile number (required, escalation SMS): allowed countries, DE + EU by default.
  'owner_phone.countries': {
    group: 'abuse',
    schema: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(60),
    default: DEFAULT_VERIFY_COUNTRIES,
  },
  'abuse.phone_ban_months': { group: 'abuse', schema: int(1, 12), default: 12 },
  'abuse.phone_ban_vehicles': { group: 'abuse', schema: int(2, 50), default: 3 },
  'abuse.phone_ban_window_days': { group: 'abuse', schema: int(7, 365), default: 90 },
  'abuse.valkey_timeout_ms': { group: 'abuse', schema: int(50, 5000), default: 300 },
  // Phase 2 alert photos (ALERT_PHOTOS_ENABLED): what a photo abuse report does. The per-vehicle
  // scanner block is capped at 30 days (OW-08). Photos are part of the single plan.
  'photos.abuse_block_days': { group: 'abuse', schema: int(1, 30), default: 30 },
  'photos.abuse_upload_block_hours': { group: 'abuse', schema: int(1, 720), default: 24 },

  'refunds.withdrawal_days': { group: 'refunds', schema: int(14, 30), default: 14 },
  // Replaced by `prices.sticker_value_cents` (personalised sticker, 2026-11-22); kept for old ops
  // screens only, no longer read by the refund calculation. TODO [LEGAL REVIEW]
  'refunds.custom_decal_cost_cents': { group: 'refunds', schema: int(0, 2000), default: 0 },
  'withdrawal.require_decal_return': { group: 'refunds', schema: bool, default: false },

  // Owner decision 2026-11-18: consumers renew by 12 months, charged once a year.
  // TODO [LEGAL REVIEW: § 309 Nr. 9 BGB] `monthly_after_first_term` is the fallback if the lawyer objects.
  'renewal.mode_b2c': {
    group: 'contracts',
    schema: z.enum(['annual', 'monthly_after_first_term']),
    default: 'annual',
  },
  'renewal.mode_b2b': { group: 'contracts', schema: z.enum(['annual']), default: 'annual' },
  'renewal.reminder_days': { group: 'contracts', schema: int(7, 90), default: 30 },
  'scanner.past_due_grace_days': { group: 'contracts', schema: int(0, 60), default: 21 },
  'fulfillment.mode': {
    group: 'contracts',
    schema: z.enum(['on_demand', 'from_stock']),
    default: 'on_demand',
  },
  // Days the old code keeps working after a stock sticker was shipped (2026-11-27).
  'fulfillment.old_code_grace_days': { group: 'contracts', schema: int(1, 60), default: 14 },

  'health.sms_failure_pct': { group: 'health', schema: int(1, 100), default: 5 },
  'health.email_failure_pct': { group: 'health', schema: int(1, 100), default: 5 },
  'health.push_failure_pct': { group: 'health', schema: int(1, 100), default: 10 },
  'health.stripe_webhook_failures': { group: 'health', schema: int(1, 1000), default: 1 },
  'health.print_stuck_hours': { group: 'health', schema: int(1, 168), default: 24 },
  'health.renotify_hours': { group: 'health', schema: int(1, 168), default: 6 },

  'reminders.activation_days': {
    group: 'reminders',
    schema: z.array(int(1, 90)).min(1).max(5),
    default: [3, 7, 14],
  },
  'reminders.decal_health_months': { group: 'reminders', schema: int(1, 36), default: 11 },

  'ops.alert_email': {
    group: 'general',
    schema: z.email().max(254),
    default: 'datenschutz@parkshield.de',
  },
  'support.reply_hours_plus': { group: 'general', schema: int(1, 168), default: 48 },
  'staff.inactive_days': { group: 'general', schema: int(30, 365), default: 90 },
  'staff.review_interval_days': { group: 'general', schema: int(30, 180), default: 90 },
  // Customers download their welcome letter under „Dokumente“ in the portal (off: ops only).
  'welcome_letter.in_portal': { group: 'general', schema: bool, default: false },
  // Short URL as text under downloaded QR codes (SVG and PDF).
  'qr.caption': { group: 'general', schema: bool, default: true },
  // App lock (Face ID / fingerprint): asked again after this many seconds in the background.
  'app.lock_after_seconds': { group: 'general', schema: int(0, 3600), default: 300 },
};

export const SETTING_KEYS = Object.keys(SETTINGS);
