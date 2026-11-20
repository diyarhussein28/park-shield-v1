import { StyleSheet, Text, View } from 'react-native';
import { t, type Key } from '@/lib/i18n';
import { space, type as typeScale, useTheme } from '@/theme/tokens';
import { Illustration } from './illustration';
import { Section } from './ui';

const STEPS: Key[] = ['decalGuideStep1', 'decalGuideStep2', 'decalGuideStep3'];

/** „So bringen Sie den Aufkleber an“: where and how the decal goes on the car, then test it. */
export function DecalGuide() {
  const c = useTheme();
  return (
    <Section title={t('decalGuideTitle')}>
      <Illustration name="decal-placement" />
      {STEPS.map((k, i) => (
        <View key={k} style={s.step}>
          <View style={[s.num, { backgroundColor: c.primary }]}>
            <Text style={[typeScale.label, { color: c.primaryFg }]}>{i + 1}</Text>
          </View>
          <Text style={[typeScale.body, { color: c.fg, flex: 1 }]}>{t(k)}</Text>
        </View>
      ))}
    </Section>
  );
}

const s = StyleSheet.create({
  step: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  num: {
    minWidth: 28,
    minHeight: 28,
    paddingHorizontal: 4,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
