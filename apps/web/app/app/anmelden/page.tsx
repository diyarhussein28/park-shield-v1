import { AppSignIn } from './app-sign-in';

export const metadata = {
  title: 'Anmeldung in der ParkShield-App',
  robots: { index: false, follow: false },
};

/**
 * The app's sign-in link (`/app/anmelden#t=…`). With the app installed, iOS Universal Links / Android
 * App Links open the app directly and this page is never shown. Without it, the page offers the app's
 * own link scheme and the browser sign-in with the same one-time token (still in the fragment only).
 */
export default function AppSignInPage() {
  return <AppSignIn />;
}
