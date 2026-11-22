import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { LogoMark, Wordmark } from '@/components/icons';
import { BrandTabBar } from '@/components/tab-bar';
import { useAlerts } from '@/lib/alerts-store';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
import { stackOptions } from '@/theme/navigation';
import { useTheme } from '@/theme/tokens';

/**
 * The four tabs (owner decision 2026-11-20): Start · Warnungen · Fahrzeuge · Konto, with the branded
 * tab bar; the badge on Warnungen counts alerts not opened yet. Everything else is pushed above the tabs.
 */
export default function TabsLayout() {
  const c = useTheme();
  // The badge counts alerts not opened yet (server-side), not „open“ ones (2026-11-22).
  const { unseen } = useAlerts();
  return (
    <Tabs
      tabBar={(props) => <BrandTabBar {...props} badges={{ alerts: unseen }} />}
      screenOptions={{
        ...stackOptions(c),
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('homeTitle'),
          // The website's header brand: the mark and „ParkShield“ (the screen title stays for VoiceOver).
          headerTitle: () => (
            <View
              accessibilityRole="header"
              accessibilityLabel={`ParkShield, ${t('homeTitle')}`}
              style={s.brand}
            >
              <LogoMark size={28} />
              <Wordmark size={20} maxScale={1.3} />
            </View>
          ),
        }}
      />
      {/* Own header in the screen: logo, wordmark and the large title (design 2026-11-22). */}
      <Tabs.Screen name="alerts" options={{ title: t('alertsTitle'), headerShown: false }} />
      <Tabs.Screen name="fahrzeuge" options={{ title: pt('portal.vehiclesTitle') }} />
      <Tabs.Screen name="konto" options={{ title: t('tabAccount') }} />
    </Tabs>
  );
}

const s = StyleSheet.create({ brand: { flexDirection: 'row', alignItems: 'center', gap: 8 } });
