/** The one subscription status every surface shows (A4), derived from our record. */
export type UnifiedStatus =
  'ACTIVE' | 'CANCEL_SCHEDULED' | 'BILLING_ISSUE' | 'PAUSED' | 'EXPIRED' | 'REFUNDED' | 'WITHDRAWN';

export function unifiedStatus(
  s: {
    status: string;
    cancel_at_period_end: boolean;
    will_renew: boolean;
    refunded_at: Date | null;
    withdrawn_at: Date | null;
    paused_until?: Date | null;
  },
  now = new Date(),
): UnifiedStatus {
  if (s.status === 'withdrawn' || s.withdrawn_at) return 'WITHDRAWN';
  if (s.refunded_at) return 'REFUNDED';
  if (s.status === 'past_due') return 'BILLING_ISSUE';
  if (s.status === 'active') {
    return s.cancel_at_period_end || !s.will_renew ? 'CANCEL_SCHEDULED' : 'ACTIVE';
  }
  if (s.paused_until && s.paused_until.getTime() > now.getTime()) return 'PAUSED';
  return 'EXPIRED';
}

/** Store management fallbacks when RevenueCat reports no management URL (A6). */
export const STORE_MANAGE_URL = {
  app_store: 'https://apps.apple.com/account/subscriptions',
  play_store: 'https://play.google.com/store/account/subscriptions',
} as const;
