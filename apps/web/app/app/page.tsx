import { AppAccount } from './app-account';

export const metadata = { title: 'ParkShield-App' };
// The store links are runtime settings of the server (APP_STORE_URL, PLAY_STORE_URL), not build-time.
export const dynamic = 'force-dynamic';

/**
 * The website's only account page (owner decision 2026-11-24, app first): registration, sign-in, the
 * owner portal and the checkout live in the ParkShield app. `/anmelden` and `/konto/*` redirect here
 * (next.config.ts), so links in older e-mails and letters land on this page. Cancelling and withdrawing
 * stay possible on the website without signing in (§ 312k / § 356a BGB).
 */
export default function AppPage() {
  return (
    <AppAccount
      appStoreUrl={storeUrl(process.env.APP_STORE_URL)}
      playStoreUrl={storeUrl(process.env.PLAY_STORE_URL)}
    />
  );
}

/** Only https links to the two stores are shown; anything else (or nothing) means "coming soon". */
function storeUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' &&
      (url.hostname === 'apps.apple.com' || url.hostname === 'play.google.com')
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
