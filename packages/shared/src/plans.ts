// Defaults for plans.limits; runtime overrides live in app_settings (docs/05-business.md §1).
export type PlanCode = 'plus' | 'premium';

export interface PlanLimits {
  vehicles: number;
  emergencyContacts: number;
  coDrivers: number;
  smsPerMonth: number;
  maskedCallMinutesPerMonth: number;
  includedDecals: number;
}

export const PLAN_LIMIT_DEFAULTS: Record<'plus' | 'premium', PlanLimits> = {
  plus: {
    vehicles: 2,
    // Channel matrix: PLUS = push + e-mail; no SMS, no escalation to trusted contacts.
    emergencyContacts: 0,
    coDrivers: 0,
    smsPerMonth: 0,
    maskedCallMinutesPerMonth: 0,
    includedDecals: 1,
  },
  premium: {
    vehicles: 5,
    emergencyContacts: 3,
    coDrivers: 3,
    smsPerMonth: 10,
    maskedCallMinutesPerMonth: 10,
    includedDecals: 1,
  },
};

/**
 * Plan catalog: how many feature lines each plan has on the pricing page (i18n keys
 * landing.<plan>F1 … F<n>). The welcome letter lists the same lines, so both always match.
 */
export const PLAN_FEATURE_COUNTS = { plus: 7, premium: 6 } as const;

/** Consumer prices in euro cents, VAT included (PAngV). */
export const PLAN_PRICES_CENTS = { plus: 1000, premium: 1500 } as const;
export const VAT_RATE_DE = 0.19;

/** Paid add-ons, euro cents incl. VAT, shipping included (05-business §1). */
export const ADDON_PRICES_CENTS = { replacementDecal: 590 } as const;

/** Owner self-test window after "Aufkleber testen" (US-12). */
export const TEST_WINDOW_MINUTES = 10;
