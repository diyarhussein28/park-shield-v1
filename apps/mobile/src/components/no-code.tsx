import { StyleSheet, Text, View } from 'react-native';
import { t } from '@/lib/i18n';
import type { PortalVehicle } from '@/lib/portal';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { Icon } from './icons';
import { NewCodeActions, useNewCodeOptions } from './new-code';

/**
 * „Kein aktiver Code – Ihr Fahrzeug ist nicht geschützt“ (2026-11-21): after „Sperren“ the vehicle has
 * no code until the owner creates one. Since 2026-11-24 that is free once per contract year, else it
 * comes with the 3 € printed sticker, and at most every 10 days (`NewCodeActions`). Shown wherever
 * the vehicle appears (Start, Fahrzeuge, its page, the print screen).
 */
export function NoCodeCard({
  vehicle,
  onCreated,
}: {
  vehicle: Pick<PortalVehicle, 'id' | 'nickname'>;
  onCreated: (v: PortalVehicle | null) => void | Promise<void>;
}) {
  const c = useTheme();
  const { options } = useNewCodeOptions(vehicle.id);

  return (
    <View
      testID="no-code"
      accessibilityRole="alert"
      style={[s.card, { backgroundColor: c.dangerBg, borderColor: c.urgent }]}
    >
      <View style={s.head}>
        <Icon name="alert" size={24} color={c.dangerText} />
        <Text style={[typeScale.heading, { color: c.dangerText, flex: 1 }]}>
          {t('noCodeTitle')}
        </Text>
      </View>
      <Text style={[typeScale.body, { color: c.dangerText }]}>{t('noCodeText')}</Text>
      <NewCodeActions vehicle={vehicle} options={options} onCreated={onCreated} tone="danger" />
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
