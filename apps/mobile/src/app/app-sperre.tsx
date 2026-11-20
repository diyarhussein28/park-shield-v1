import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '@/components/icons';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { biometricInfo, biometricName, type BiometricInfo } from '@/lib/biometrics';
import { t } from '@/lib/i18n';
import { useLock } from '@/lib/lock';
import { useTheme } from '@/theme/tokens';

/**
 * After sign-up or the first sign-in (§6): offer Face ID (iPhone; Touch ID on older ones) or what the
 * Android phone has (fingerprint, face, device code). „Nicht jetzt“ is always possible; it can be
 * switched on later under Konto.
 */
export default function LockOffer() {
  const c = useTheme();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { setEnabled, lockAfterSeconds } = useLock();
  const [info, setInfo] = useState<BiometricInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void biometricInfo().then(setInfo);
  }, []);

  const go = () => router.replace((next === 'tarif' ? '/tarif' : '/') as Href);
  const method = biometricName(info?.kind ?? 'deviceCode');
  const minutes = Math.max(1, Math.round(lockAfterSeconds / 60));

  const enable = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await setEnabled(true);
    setBusy(false);
    if (ok) go();
    else setFailed(true);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
      <View style={[s.icon, { backgroundColor: c.infoBg }]}>
        <Icon
          name={
            info?.kind === 'fingerprint' || info?.kind === 'touchId'
              ? 'fingerprint'
              : info?.kind === 'deviceCode'
                ? 'lock'
                : 'faceId'
          }
          size={56}
          color={c.primary}
        />
      </View>
      <Title>{t('lockOfferTitle', { method })}</Title>
      <P muted>{t('lockOfferText', { method, minutes })}</P>
      {info && !info.available ? (
        <>
          <Banner tone="info">{t('lockUnavailable')}</Banner>
          <Button label={t('continue')} onPress={go} testID="lock-continue" />
        </>
      ) : (
        <>
          <Button
            label={t('lockOfferYes', { method })}
            onPress={() => void enable()}
            busy={busy}
            disabled={!info}
            testID="lock-yes"
          />
          {failed && <Banner tone="warn">{t('lockFailed')}</Banner>}
          <Button label={t('lockOfferNo')} variant="ghost" onPress={go} testID="lock-no" />
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  icon: {
    alignSelf: 'center',
    width: 112,
    height: 112,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
});
