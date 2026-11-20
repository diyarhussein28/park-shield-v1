import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ShieldArt } from '@/components/art';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { setFlag } from '@/lib/prefs';
import { requestPermission } from '@/lib/push';

/**
 * Our explanation first, then the system prompt (asked only once by iOS). Shown after the first QR
 * code, when the owner sees what it is for (P6), never by itself on Home.
 */
export default function AllowPush() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void setFlag('pushAsked', true);
  }, []);

  const allow = async () => {
    setBusy(true);
    // A grant also registers this device (requestPermission). „undetermined“ means iOS did not show
    // its dialog: the button stays, a second tap asks again.
    const p = await requestPermission().catch(() => 'undetermined' as const);
    if (p === 'granted') router.back();
    else if (p === 'denied') setDenied(true);
    setBusy(false);
  };

  return (
    <Screen>
      <ShieldArt size={112} />
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
