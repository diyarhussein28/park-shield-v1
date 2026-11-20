import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { registerDevice, requestPermission } from '@/lib/push';

/** Our explanation first, then the system prompt (asked only once by iOS). */
export default function AllowPush() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const allow = async () => {
    setBusy(true);
    const p = await requestPermission().catch(() => 'denied' as const);
    if (p === 'granted') {
      await registerDevice().catch(() => false);
      router.back();
    } else setDenied(true);
    setBusy(false);
  };

  return (
    <Screen>
      <Title>{t('pushTitle')}</Title>
      <P>{t('pushWhy')}</P>
      <P muted>{t('pushWhat')}</P>
      {denied ? (
        <>
          <Banner tone="warn">{t('pushDeniedBanner')}</Banner>
          <Button label={t('back')} variant="secondary" onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Button
            label={t('pushAllow')}
            onPress={() => void allow()}
            busy={busy}
            testID="allow-push"
          />
          <Button label={t('pushLater')} variant="secondary" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}
