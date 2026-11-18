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
  'channels.webpush.enabled': { group: 'channels', schema: bool, default: true, killSwitch: true },
  'channels.email.enabled': { group: 'channels', schema: bool, default: true, killSwitch: true },
  'channels.whatsapp.enabled': { group: 'channels', schema: bool, default: true, killSwitch: true },
  'channels.sms.enabled': { group: 'channels', schema: bool, default: true, killSwitch: true },

  'escalation.default_minutes': { group: 'escalation', schema: int(1, 60), default: 7 },
  'followup.after_ack_minutes': { group: 'escalation', schema: int(5, 120), default: 15 },
  'followup.escalate_after_minutes': { group: 'escalation', schema: int(1, 60), default: 5 },

  'limits.plus.vehicles': { group: 'limits', schema: int(1, 20), default: 2 },
  'limits.plus.emergency_contacts': { group: 'limits', schema: int(0, 10), default: 1 },
  'limits.plus.whatsapp_per_month': { group: 'limits', schema: int(0, 1000), default: 10 },
  'limits.plus.sms_per_month': { group: 'limits', schema: int(0, 100), default: 5 },
  'limits.premium.vehicles': { group: 'limits', schema: int(1, 50), default: 5 },
  'limits.premium.emergency_contacts': { group: 'limits', schema: int(0, 10), default: 3 },
  'limits.premium.whatsapp_per_month': { group: 'limits', schema: int(0, 1000), default: 40 },
  'limits.premium.sms_per_month': { group: 'limits', schema: int(0, 100), default: 10 },
  'fair_use.warn_percent': { group: 'limits', schema: int(50, 100), default: 80 },
  'whatsapp.cost_micros': { group: 'limits', schema: int(0, 1_000_000), default: 55_000 },
  'sms.cost_micros': { group: 'limits', schema: int(0, 1_000_000), default: 100_000 },
  'plans.premium.purchasable': { group: 'limits', schema: bool, default: false },

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
  'abuse.phone_ban_months': { group: 'abuse', schema: int(1, 12), default: 12 },
  'abuse.phone_ban_vehicles': { group: 'abuse', schema: int(2, 50), default: 3 },
  'abuse.phone_ban_window_days': { group: 'abuse', schema: int(7, 365), default: 90 },
  'abuse.valkey_timeout_ms': { group: 'abuse', schema: int(50, 5000), default: 300 },
  // Phase 2 alert photos (ALERT_PHOTOS_ENABLED): which plans may receive photos, and what a photo
  // abuse report does. The per-vehicle scanner block is capped at 30 days (OW-08).
  'photos.plans': {
    group: 'limits',
    schema: z.array(z.enum(['plus', 'premium', 'business'])).max(3),
    default: ['premium'],
  },
  'photos.abuse_block_days': { group: 'abuse', schema: int(1, 30), default: 30 },
  'photos.abuse_upload_block_hours': { group: 'abuse', schema: int(1, 720), default: 24 },

  'refunds.withdrawal_days': { group: 'refunds', schema: int(14, 30), default: 14 },
  // The decal is an accessory, not custom-made: no § 312g deduction. TODO [LEGAL REVIEW]
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

  'health.whatsapp_failure_pct': { group: 'health', schema: int(1, 100), default: 5 },
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
};

export const SETTING_KEYS = Object.keys(SETTINGS);
