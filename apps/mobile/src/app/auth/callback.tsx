import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Banner, Button, Loading, P, Screen } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';

/**
 * The app's return address from the sign-in bridge page (AUTH.md): parkshield://auth/callback, Expo Go's
 * exp://…/--/auth/callback and the Universal Link /app/auth/callback all land here with `?token=`, on a
 * cold start as well as with the app already open. The token is redeemed once, then the app opens.
 */
export default function AuthCallback() {
  const router = useRouter();
  const { consumeLink } = useAuth();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [failed, setFailed] = useState<string | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (handled.current === (token ?? '')) return;
    handled.current = token ?? '';
    if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
      setFailed(t('linkInvalid'));
      return;
    }
    consumeLink(token).then(
      () => router.replace('/' as Href),
      (e: unknown) =>
        setFailed(e instanceof ApiError && e.status === 401 ? t('linkInvalid') : t('error')),
    );
  }, [token, consumeLink, router]);

  if (!failed) return <Loading />;
  return (
    <Screen>
      <Banner tone="err">{failed}</Banner>
      <P muted>{t('codeHint')}</P>
      <Button label={t('signInTitle')} onPress={() => router.replace('/anmelden')} />
    </Screen>
  );
}
