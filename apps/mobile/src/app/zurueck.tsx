import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Loading } from '@/components/ui';

/**
 * Back from Stripe (`parkshield://zurueck?to=…&result=…`). On iOS the in-app browser catches this
 * address itself; on Android it can arrive as a deep link, so this screen sends the owner to the place
 * the payment started, where the screen confirms it (checkout) or reloads (order, payment method).
 */
export default function Back() {
  const router = useRouter();
  const { to } = useLocalSearchParams<{ to?: string }>();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace(to === 'order' ? '/fahrzeuge' : '/konto');
  }, [router, to]);
  return <Loading />;
}
