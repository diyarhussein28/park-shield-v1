import { StyleSheet, Text, View } from 'react-native';
import { pt } from '@/lib/portal-i18n';
import { space, type as typeScale, useTheme } from '@/theme/tokens';
import { Icon, type IconName } from './icons';
import { Section } from './ui';

const STEPS: { icon: IconName; n: 1 | 2 | 3 }[] = [
  { icon: 'qr', n: 1 },
  { icon: 'phone', n: 2 },
  { icon: 'bell', n: 3 },
];

/** „Was passiert beim Scannen?“ in three plain steps (web: HowScanningWorks on /konto). */
export function HowItWorks() {
  const c = useTheme();
  return (
    <Section title={pt('portal.howTitle')} intro={pt('portal.howIntro')}>
      {STEPS.map(({ icon, n }) => (
        <View key={n} style={s.step}>
          <View style={[s.icon, { backgroundColor: c.infoBg }]}>
            <Icon name={icon} size={20} color={c.primary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typeScale.body, { color: c.fg, fontWeight: '700' }]}>
              {n}. {pt(`portal.how${n}Title`)}
            </Text>
            <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>
              {pt(`portal.how${n}Text`)}
            </Text>
          </View>
        </View>
      ))}
    </Section>
  );
}

const s = StyleSheet.create({
  step: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
