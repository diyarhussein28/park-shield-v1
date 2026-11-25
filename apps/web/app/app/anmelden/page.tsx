import { AppSignIn } from './app-sign-in';
import { pageMetadata } from '@/lib/meta';

export const generateMetadata = () =>
  pageMetadata('meta.appSignIn', { robots: { index: false, follow: false } });

/**
 * The app's sign-in link (`/app/anmelden#t=…`). With the app installed, iOS Universal Links / Android
 * App Links open the app directly and this page is never shown. Without it, the page offers the app's
 * own link scheme with the same one-time token (still in the fragment only). There is no browser
 * sign-in any more (app first, 2026-11-24).
 */
export default function AppSignInPage() {
  return <AppSignIn />;
}
