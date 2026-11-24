import { AppClaim } from './app-claim';

export const metadata = {
  title: 'Aufkleber in der ParkShield-App einrichten',
  robots: { index: false, follow: false },
};

/**
 * „Aufkleber einrichten“ from the scanner page of a pre-printed partner decal (`/app/aktivieren#c=…`,
 * 2026-11-24). With the app installed, iOS Universal Links / Android App Links open the app directly
 * and this page is never shown. Without it, the page offers the app's own link scheme; the code stays
 * in the fragment (never in a server log). The website itself sets nothing up any more.
 */
export default function AppClaimPage() {
  return <AppClaim />;
}
