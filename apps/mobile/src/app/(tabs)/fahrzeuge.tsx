import { PLAN_LIMIT_DEFAULTS } from '@parkshield/shared/plans';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HowItWorks } from '@/components/how-it-works';
import { Icon } from '@/components/icons';
import { NoCodeCard } from '@/components/no-code';
import { VehicleForm, type VehicleInput } from '@/components/vehicle-forms';
import { Banner, Button, Chip, EmptyState, P, Screen, Section, useTheme } from '@/components/ui';
import { api, ApiError, authHeaders } from '@/lib/api';
import { decalPreviewUrl, onDecalChange } from '@/lib/decal';
import { t } from '@/lib/i18n';
import { errorText, type PortalVehicle, type SubscriptionSummary } from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { radius, space, type as typeScale } from '@/theme/tokens';

/**
 * Fahrzeuge (web: /konto/fahrzeuge): one card per vehicle with its QR code (or „Kein aktiver Code“
 * with „Neuen Code erstellen“), „Fahrzeug hinzufügen“ while the plan's vehicle limit allows (one
 * vehicle for now; no upgrade prompt), and „Was passiert beim Scannen?“. Without a plan the notice
 * leads to the plan.
 */
export default function Vehicles() {
  const c = useTheme();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<PortalVehicle[] | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // The API's limit (setting `limits.vehicles`) when it told us, else the plan default.
  const [limit, setLimit] = useState(PLAN_LIMIT_DEFAULTS.vehicles);

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([
        api<{ vehicles: PortalVehicle[] }>('/v1/vehicles'),
        api<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
      ]);
      setVehicles(v.vehicles);
      setSubscribed(Boolean(s.subscription));
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void authHeaders().then(setHeaders);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // A saved design, a blocked or a new code shows at once (Stage 4.3).
  useEffect(() => onDecalChange(() => void load()), [load]);

  const add = async (v: VehicleInput) => {
    setError(null);
    try {
      const firstCar = (vehicles?.length ?? 0) === 0;
      const created = await api<PortalVehicle>('/v1/vehicles', { body: v });
      setFormKey((k) => k + 1);
      await load();
      // The first QR code is a success moment (P8); further cars open their page directly.
      if (firstCar)
        router.push({
          pathname: '/erfolg',
          params: { kind: 'qr', vehicleId: created.id, nickname: created.nickname },
        });
      else router.push({ pathname: '/fahrzeug/[id]', params: { id: created.id } });
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'vehicle_limit') {
        const body = err.body as { limit?: number };
        if (typeof body.limit === 'number') setLimit(body.limit);
        await load();
      } else if (err instanceof ApiError && err.status === 400) {
        // Say what is wrong instead of „Etwas ist schiefgelaufen“ (QA 2026-11-20).
        setError(t('vehicleInvalid'));
      } else setError(errorText(err));
    }
  };

  return (
    <Screen>
      {vehicles?.map((v) => (
        <Pressable
          key={v.id}
          accessibilityRole="button"
          accessibilityLabel={`${v.nickname}, ${pt('vehicles.open')}`}
          onPress={() => router.push({ pathname: '/fahrzeug/[id]', params: { id: v.id } })}
          style={({ pressed }) => [
            s.card,
            { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <View style={[s.thumb, { borderColor: c.border }]}>
            {v.decal && v.decal.status !== 'revoked' && headers ? (
              <Image
                source={{ uri: decalPreviewUrl(v)!, headers }}
                contentFit="contain"
                style={s.thumbImage}
                accessible={false}
              />
            ) : (
              <Icon name="qr" size={32} color={c.muted} />
            )}
          </View>
          <View style={s.text}>
            <Text style={[typeScale.heading, { color: c.fg }]}>{v.nickname}</Text>
            <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>
              {[v.plate, v.color, v.makeModel].filter(Boolean).join(' · ')}
            </Text>
            {!v.decal && <Chip tone="urgent">{t('noCodeChip')}</Chip>}
            {v.decal && (
              <Chip tone={v.decal.status === 'assigned' ? 'ok' : 'info'}>
                {pt('vehicles.decalStatus', {
                  hint: v.decal.codeHint,
                  status: pt(`vehicles.status_${v.decal.status}` as MessageKey),
                })}
              </Chip>
            )}
            <Text style={[typeScale.label, { color: c.primary }]}>{pt('vehicles.open')} ›</Text>
          </View>
        </Pressable>
      ))}
      {vehicles
        ?.filter((v) => !v.decal)
        .map((v) => (
          <NoCodeCard key={`no-code-${v.id}`} vehicle={v} onCreated={() => load()} />
        ))}

      {subscribed === false ? (
        <Section title={pt('vehicles.add')}>
          <Banner tone="info">{pt('vehicles.noSubscription')}</Banner>
          <Button label={t('homeNoPlanCta')} onPress={() => router.push('/tarif')} />
        </Section>
      ) : (
        subscribed && (
          <>
            {vehicles?.length === 0 && (
              <EmptyState
                illustration="empty-vehicles"
                title={t('emptyVehiclesTitle')}
                text={t('emptyVehiclesText')}
              />
            )}
            {vehicles && vehicles.length >= limit ? (
              <P muted>{t('vehicleLimitNote', { limit })}</P>
            ) : (
              <Section
                title={pt('vehicles.add')}
                intro={pt('portal.addIntro')}
                style={
                  vehicles?.length === 0 ? { borderColor: c.primary, borderWidth: 2 } : undefined
                }
              >
                <VehicleForm key={formKey} submitLabel={pt('vehicles.add')} onSubmit={add} />
              </Section>
            )}
          </>
        )
      )}
      {error && <Banner tone="warn">{error}</Banner>}
      <HowItWorks />
    </Screen>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: 76, height: 76 },
  text: { flex: 1, gap: space.xs },
});
