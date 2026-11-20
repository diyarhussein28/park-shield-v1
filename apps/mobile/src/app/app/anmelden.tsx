import * as Linking from 'expo-linking';
import { Redirect } from 'expo-router';
import { Loading } from '@/components/ui';
import { tokenFromLink } from '@/lib/auth';

/**
 * Universal Link / App Link https://park-shield.de/app/anmelden#t=… (the e-mail's sign-in link). The
 * router does not pass the fragment, so it is read from the raw URL and handed to the sign-in screen.
 */
export default function AppLinkSignIn() {
  const url = Linking.useURL();
  if (url === null) return <Loading />;
  const token = tokenFromLink(url);
  return token ? (
    <Redirect href={{ pathname: '/anmelden', params: { t: token } }} />
  ) : (
    <Redirect href="/anmelden" />
  );
}
