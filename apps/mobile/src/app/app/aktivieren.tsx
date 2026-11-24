import * as Linking from 'expo-linking';
import { Redirect } from 'expo-router';
import { Loading } from '@/components/ui';
import { claimCodeFromLink } from '@/lib/portal';

/**
 * Universal Link / App Link https://park-shield.de/app/aktivieren#c=… („Aufkleber einrichten“ on the
 * scanner page of a pre-printed partner decal, 2026-11-24). The router does not pass the fragment, so
 * it is read from the raw URL and handed to the set-up screen.
 */
export default function AppLinkClaim() {
  const url = Linking.useURL();
  if (url === null) return <Loading />;
  const code = claimCodeFromLink(url);
  return (
    <Redirect href={code ? { pathname: '/aktivieren', params: { c: code } } : '/aktivieren'} />
  );
}
