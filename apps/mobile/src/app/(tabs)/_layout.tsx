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
 * The four tabs (Warnungen · Fahrzeuge · Konto · Mehr) with the branded tab bar; the badge on
 * Warnungen counts open alerts. Everything else is pushed above the tabs by the root stack.
 */
export default function TabsLayout() {
  const c = useTheme();
  const { open } = useAlerts();
  return (
    <Tabs
      tabBar={(props) => <BrandTabBar {...props} badges={{ index: open }} />}
      screenOptions={{
        ...stackOptions(c),
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('alertsTitle'),
          // The website's header brand: the mark and „ParkShield“ (the screen title stays for VoiceOver).
          headerTitle: () => (
            <View
              accessibilityRole="header"
              accessibilityLabel={`ParkShield, ${t('alertsTitle')}`}
              style={s.brand}
            >
              <LogoMark size={28} />
              <Wordmark size={20} maxScale={1.3} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="fahrzeuge" options={{ title: pt('portal.vehiclesTitle') }} />
      <Tabs.Screen name="konto" options={{ title: pt('portal.planTitle') }} />
      <Tabs.Screen name="mehr" options={{ title: t('tabMore') }} />
    </Tabs>
  );
}

const s = StyleSheet.create({ brand: { flexDirection: 'row', alignItems: 'center', gap: 8 } });
