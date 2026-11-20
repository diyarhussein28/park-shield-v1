import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { CarArt } from '@/components/art';
import { Celebration } from '@/components/celebration';
import { Button, Screen } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getFlag } from '@/lib/prefs';
import { permission } from '@/lib/push';

/**
 * The two success moments (§5.5, P8): after the payment („Willkommen bei ParkShield“ → add the car)
 * and after the first QR code („Ihr Auto ist geschützt“ → the QR page; the notification permission is
 * asked here for the first time, with our explanation first, P6).
 */
export default function Success() {
  const router = useRouter();
  const { kind, vehicleId, nickname } = useLocalSearchParams<{
    kind?: string;
    vehicleId?: string;
    nickname?: string;
  }>();
  const paid = kind !== 'qr';

  const next = async () => {
    if (paid) {
      router.replace('/fahrzeuge');
      return;
    }
    router.replace({ pathname: '/fahrzeug/[id]', params: { id: vehicleId ?? '' } });
    const asked = await getFlag('pushAsked');
    const p = await permission().catch(() => 'granted' as const);
    if (!asked && p === 'undetermined') router.push('/push-erlauben');
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
      <View style={s.body}>
        <Celebration
          title={paid ? t('paySuccessTitle') : t('qrSuccessTitle')}
          text={paid ? t('paySuccessText') : t('qrSuccessText', { nickname: nickname ?? '' })}
        />
        {!paid && <CarArt width={240} protectedBadge />}
      </View>
      <Button
        label={paid ? t('addCarCta') : t('qrSuccessCta')}
        onPress={() => void next()}
        testID="success-next"
      />
    </Screen>
  );
}

const s = StyleSheet.create({ body: { flex: 1, justifyContent: 'center', gap: 16 } });
