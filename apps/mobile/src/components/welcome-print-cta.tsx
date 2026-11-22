import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { t } from '@/lib/i18n';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { Button } from './ui';

/**
 * „Aufkleber gestalten und zusenden lassen – kostenlos“ (B1): shown on Start and Fahrzeuge until the
 * welcome print is ordered. The welcome print is no longer queued by itself; it waits for the
 * customer's confirmation on the print screen (design, label, address).
 */
export function WelcomePrintCta({ vehicleId }: { vehicleId: string }) {
  const c = useTheme();
  const router = useRouter();
  return (
    <View testID="welcome-print-cta" style={[s.box, { backgroundColor: c.infoBg }]}>
      <Text style={[typeScale.body, { color: c.infoFg, fontWeight: '700' }]}>
        {t('welcomeCta')}
      </Text>
      <Text style={[typeScale.caption, { color: c.infoFg }]}>{t('welcomeCtaText')}</Text>
      <Button
        label={t('welcomeCtaButton')}
        onPress={() =>
          router.push({ pathname: '/fahrzeug/drucken/[id]', params: { id: vehicleId } })
        }
        testID="welcome-print-go"
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
});
