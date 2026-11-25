import { AuthOpen } from './auth-open';
import { pageMetadata } from '@/lib/meta';

export const generateMetadata = () =>
  pageMetadata('meta.appSignIn', { robots: { index: false, follow: false } });

/**
 * The bridge page of the app's sign-in e-mail (`/auth/open#t=…&r=…&c=…`, AUTH.md). It never signs
 * in when it loads (mail scanners and link previews cannot spend the link): only the app redeems the
 * token, after „In der App öffnen“. Everything after # stays in the browser.
 */
export default function AuthOpenPage() {
  return <AuthOpen />;
}
