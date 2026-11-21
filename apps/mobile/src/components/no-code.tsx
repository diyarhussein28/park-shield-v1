import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { errorText, type PortalVehicle } from '@/lib/portal';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { Icon } from './icons';
import { Button } from './ui';

/**
 * „Kein aktiver Code – Ihr Fahrzeug ist nicht geschützt“ (2026-11-21): after „Sperren“ the vehicle has
 * no code until the owner creates one, explicitly and free of charge (POST /v1/vehicles/:id/tokens,
 * which keeps the last design). Shown wherever the vehicle appears (Start, Fahrzeuge, its page).
 */
export function NoCodeCard({
  vehicle,
  onCreated,
}: {
  vehicle: Pick<PortalVehicle, 'id' | 'nickname'>;
  onCreated: (v: PortalVehicle | null) => void | Promise<void>;
}) {
  const c = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreated(await api<PortalVehicle>(`/v1/vehicles/${vehicle.id}/tokens`, { body: {} }));
    } catch (err) {
      // Created meanwhile (another device): just show the current state.
      if (err instanceof ApiError && err.body?.error === 'code_active') await onCreated(null);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

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
      <Button label={t('newCode')} busy={busy} onPress={() => void create()} testID="new-code" />
      {error && <Text style={[typeScale.label, { color: c.dangerText }]}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
