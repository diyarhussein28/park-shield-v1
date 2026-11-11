// Defaults for plans.limits; runtime overrides live in app_settings (docs/05-business.md §1).
export type PlanCode = 'plus' | 'premium' | 'business';

export interface PlanLimits {
  vehicles: number;
  emergencyContacts: number;
  coDrivers: number;
  whatsappPerMonth: number;
  smsPerMonth: number;
  maskedCallMinutesPerMonth: number;
  includedDecals: number;
}

export const PLAN_LIMIT_DEFAULTS: Record<'plus' | 'premium', PlanLimits> = {
  plus: {
    vehicles: 2,
    emergencyContacts: 1,
    coDrivers: 0,
    whatsappPerMonth: 10,
    smsPerMonth: 0,
    maskedCallMinutesPerMonth: 0,
    includedDecals: 1,
  },
  premium: {
    vehicles: 5,
    emergencyContacts: 3,
    coDrivers: 3,
    whatsappPerMonth: 40,
    smsPerMonth: 5,
    maskedCallMinutesPerMonth: 10,
    includedDecals: 1,
  },
};

/** Consumer prices in euro cents, VAT included (PAngV). */
export const PLAN_PRICES_CENTS = { plus: 1000, premium: 1500 } as const;
export const VAT_RATE_DE = 0.19;

/** Paid add-ons, euro cents incl. VAT, shipping included (05-business §1). */
export const ADDON_PRICES_CENTS = { replacementDecal: 590 } as const;

/** Owner self-test window after "Aufkleber testen" (US-12). */
export const TEST_WINDOW_MINUTES = 10;
