import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { decalChanged } from '@/lib/decal';
import { lang, t } from '@/lib/i18n';
import {
  errorText,
  newCodeDate,
  shortEuro,
  type NewCodeOptions,
  type PortalVehicle,
} from '@/lib/portal';
import { space, type as typeScale, useTheme } from '@/theme/tokens';
import { Banner, Button } from './ui';

/** `GET /v1/vehicles/:id/new-code`, reloadable (after „Sperren“, a payment, a new code). */
export function useNewCodeOptions(vehicleId: string, key?: unknown) {
  const [options, setOptions] = useState<NewCodeOptions | null>(null);
  const reload = useCallback(async () => {
    try {
      setOptions(await api<NewCodeOptions>(`/v1/vehicles/${vehicleId}/new-code`));
    } catch {
      setOptions(null);
    }
  }, [vehicleId]);
  // On focus (back from the payment or the design screen) and whenever the vehicle's code changes.
  useFocusEffect(
    useCallback(() => {
      void reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` only triggers a reload
    }, [reload, key]),
  );
  return { options, reload };
}

/**
 * What „Neuer Code“ offers (owner decision 2026-11-24): „Neuen Code erstellen (kostenlos)“ once per
 * contract year after „Sperren“; „Neuer Code + gedruckter Aufkleber (3 €)“ (Stripe, own screen);
 * within the cooldown both are off and the exact date is shown. Always: „höchstens alle 10 Tage“.
 */
export function NewCodeActions({
  vehicle,
  options,
  onCreated,
  tone = 'default',
}: {
  vehicle: Pick<PortalVehicle, 'id' | 'nickname'>;
  options: NewCodeOptions | null;
  onCreated: (v: PortalVehicle | null) => void | Promise<void>;
  /** On the red „Kein aktiver Code“ card the texts use its colours. */
  tone?: 'default' | 'danger';
}) {
  const c = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const color = tone === 'danger' ? c.dangerText : c.fg;
  const muted = tone === 'danger' ? c.dangerText : c.muted;

  if (!options) return null;
  const price = shortEuro(options.priceCents, lang());
  const waiting = options.reason === 'cooldown' && options.nextEligibleAt;
  // During the cooldown the free button stays visible (off) only if it would be the next step.
  const freeNext = !options.hasActiveCode && options.freeUsed < options.freePerYear;

  const createFree = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreated(await api<PortalVehicle>(`/v1/vehicles/${vehicle.id}/tokens`, { body: {} }));
      decalChanged();
    } catch (err) {
      // Created meanwhile (another device): just show the current state.
      if (err instanceof ApiError && err.body?.error === 'code_active') await onCreated(null);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const line = (text: string, testID?: string, strong = false) => (
    <Text
      testID={testID}
      style={[strong ? typeScale.label : typeScale.body, { color: strong ? color : muted }]}
    >
      {text}
    </Text>
  );

  return (
    <View style={s.wrap} testID="new-code-actions">
      {options.reason === 'subscription_required' ? (
        line(t('newCodeNoPlan'), 'new-code-no-plan')
      ) : (
        <>
          {waiting && (
            <Banner tone="info" testID="new-code-wait">
              {t('newCodeWait', { date: newCodeDate(options.nextEligibleAt!, lang()) })}
            </Banner>
          )}
          {options.reason === 'code_active' && line(t('newCodeActiveInfo'))}
          {options.reason === 'free_used' && line(t('newCodeFreeUsed'), 'new-code-free-used')}
          {(options.freeAvailable || (waiting && freeNext)) && (
            <Button
              label={t('newCodeFree')}
              busy={busy}
              disabled={!options.freeAvailable}
              onPress={() => void createFree()}
              testID="new-code"
            />
          )}
          {(options.paidAvailable || (waiting && !freeNext)) && (
            <Button
              label={t('newCodePaid', { price })}
              variant={options.freeAvailable ? 'secondary' : 'primary'}
              disabled={!options.paidAvailable}
              onPress={() =>
                router.push({ pathname: '/fahrzeug/neuer-code/[id]', params: { id: vehicle.id } })
              }
              testID="new-code-paid"
            />
          )}
          {line(t('newCodeFreeInfo'))}
        </>
      )}
      {line(t('newCodeLimit', { days: options.cooldownDays }), 'new-code-limit')}
      {error && line(error, 'new-code-error', true)}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.sm },
});
