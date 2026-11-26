// One all-inclusive plan (owner decision 2026-11-21, docs/05-business.md §1). Runtime overrides of
// every limit and price live in app_settings; these are the defaults.
export type PlanCode = 'standard';
export const PLAN_CODE: PlanCode = 'standard';

export interface PlanLimits {
  vehicles: number;
  /** Safety cap for escalation SMS per account and calendar month (setting `sms.monthly_cap`). */
  smsPerMonth: number;
  includedDecals: number;
}

export const PLAN_LIMIT_DEFAULTS: PlanLimits = {
  // One vehicle per account for now; more need a second account (owner decision 2026-11-21).
  vehicles: 1,
  smsPerMonth: 20,
  // The free welcome print (shipped once); self-printing is always free.
  includedDecals: 1,
};

/**
 * Feature lines of the plan on the pricing page and in the welcome letter (i18n keys
 * landing.planF1 … F<n>), so both always match.
 */
export const PLAN_FEATURE_COUNT = 6;

/** Consumer price in euro cents per year, VAT included (PAngV). 19,99 € everywhere (owner decision 2026-11-25). */
export const PLAN_PRICE_CENTS = 1999;
/**
 * The same plan bought in the app through the App Store or Google Play (owner decision 2026-11-23):
 * 19,99 € like the Stripe price (owner decision 2026-11-25; before that the web price was 20,00 €). The store's own price string wins when it is
 * loaded; this is the default before that (onboarding, paywall). API fallback: `prices.store_year_cents`.
 */
export const STORE_PLAN_PRICE_CENTS = 1999;
export const VAT_RATE_DE = 0.19;

/**
 * How the plan is paid (owner decision 2026-11-26): `year` = 19,99 € every year (renews, cancellable),
 * `lifetime` = 29,99 € once (no renewal, nothing to cancel). Same plan, same features, one vehicle.
 */
export type PlanTerm = 'year' | 'lifetime';
/** Lifetime price in euro cents, VAT included, paid once (setting `prices.lifetime_cents`). */
export const LIFETIME_PRICE_CENTS = 2999;
/** The same lifetime plan bought in the App Store / Google Play (setting `prices.store_lifetime_cents`). */
export const STORE_LIFETIME_PRICE_CENTS = 2999;
/**
 * From which year on the lifetime plan costs less than the yearly one: the first n with
 * n × yearly > lifetime (19,99 € / 29,99 € → the 2nd year). Pure, used by every price comparison text.
 */
export function lifetimeCheaperFromYear(
  yearCents: number = PLAN_PRICE_CENTS,
  lifetimeCents: number = LIFETIME_PRICE_CENTS,
): number {
  if (yearCents <= 0) return 1;
  return Math.floor(lifetimeCents / yearCents) + 1;
}
/** What `years` of the yearly plan cost in total (the honest comparison on the paywall). */
export const yearlyTotalCents = (years: number, yearCents: number = PLAN_PRICE_CENTS) =>
  years * yearCents;

/**
 * Value of the personalised decal incl. shipping that is included in the yearly price, euro cents incl.
 * VAT (Part B, 2026-11-22; runtime setting `prices.sticker_value_cents`). Shown in the price breakdown;
 * kept on withdrawal once the decal was personalised (§ 312g Abs. 2 Nr. 1 BGB). TODO [LEGAL REVIEW]
 */
export const STICKER_VALUE_CENTS = 300;

/**
 * Paid add-ons, euro cents incl. VAT (05-business §1). A printed and shipped decal: the first one is
 * free (welcome print), every further one costs this (setting `prices.print_shipped_cents`).
 */
export const ADDON_PRICES_CENTS = { printShipped: 300 } as const;

/** Owner self-test window after "Aufkleber testen" (US-12). */
export const TEST_WINDOW_MINUTES = 10;
