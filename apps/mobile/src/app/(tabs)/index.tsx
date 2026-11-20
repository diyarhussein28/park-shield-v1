import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertCard } from '@/components/alert-card';
import { SetupGuide } from '@/components/setup-guide';
import { PastDue } from '@/components/subscription';
import { Banner, Button, EmptyState, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { useAlerts } from '@/lib/alerts-store';
import { HAS_FIREBASE } from '@/lib/config';
import { t } from '@/lib/i18n';
import type { PortalVehicle, Protection, SubscriptionSummary } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { permission, type PushPermission } from '@/lib/push';
import { space, type as typeScale, useTheme } from '@/theme/tokens';

/** The explanation screen opens by itself once per app start, not on every return to the list. */
let askedThisStart = false;

/**
 * Warnungen: notices first (payment failed, push off), then the way in — the three start steps
 * without a plan, the set-up guide while protection is incomplete — then the alerts, newest first.
 */
export default function Alerts() {
  const c = useTheme();
  const router = useRouter();
  const { data, error, reload } = useAlerts();
  const [refreshing, setRefreshing] = useState(false);
  const [push, setPush] = useState<PushPermission | null>(null);
  const [sub, setSub] = useState<SubscriptionSummary | null | undefined>(undefined);
  const [protection, setProtection] = useState<Protection | null>(null);
  const [vehicles, setVehicles] = useState<PortalVehicle[]>([]);

  const load = useCallback(async () => {
    await reload();
    const s = await api<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription')
      .then((r) => r.subscription)
      .catch(() => undefined);
    setSub(s);
    if (s) {
      const [p, v] = await Promise.all([
        api<Protection>('/v1/me/protection').catch(() => null),
        api<{ vehicles: PortalVehicle[] }>('/v1/vehicles').catch(() => ({ vehicles: [] })),
      ]);
      setProtection(p);
      setVehicles(v.vehicles);
    }
    const perm = await permission().catch(() => 'undetermined' as const);
    setPush(perm);
    if (perm === 'undetermined' && !askedThisStart) {
      askedThisStart = true;
      router.push('/push-erlauben');
    }
  }, [router, reload]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const alerts = data?.alerts ?? [];
  const guide = sub && protection && (protection.percent < 100 || vehicles.length === 0);

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: c.bg }]} edges={['left', 'right']}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {sub?.status === 'past_due' && <PastDue />}
        {push === 'denied' && (
          <Banner tone="warn">
            <Text style={[typeScale.body, { color: c.warningFg }]}>{t('pushDeniedBanner')}</Text>
            <Button
              label={t('pushOpenSettings')}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          </Banner>
        )}
        {!HAS_FIREBASE && <Banner tone="info">{t('pushNoFirebase')}</Banner>}
        {error && <Banner tone="err">{t('offline')}</Banner>}

        {sub === null && (
          <Section title={pt('portal.startTitle')} intro={pt('portal.startIntro')}>
            {([1, 2, 3] as const).map((i) => (
              <View key={i} style={s.step}>
                <View style={[s.num, { backgroundColor: c.primary }]}>
                  <Text style={[typeScale.label, { color: c.primaryFg }]}>{i}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[typeScale.body, { color: c.fg, fontWeight: '700' }]}>
                    {pt(`portal.start${i}Title`)}
                  </Text>
                  <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>
                    {pt(`portal.start${i}Text`)}
                  </Text>
                </View>
              </View>
            ))}
            <Button label={pt('portal.start1Go')} onPress={() => router.navigate('/konto')} />
          </Section>
        )}
        {guide && (
          <SetupGuide
            protection={protection}
            vehicles={vehicles}
            onGo={(href) => router.push(href)}
          />
        )}

        {alerts.map((a) => (
          <AlertCard
            key={a.id}
            alert={a}
            onPress={() => router.push({ pathname: '/alerts/[id]', params: { id: a.id } })}
          />
        ))}
        {sub && data && alerts.length === 0 && (
          <EmptyState
            illustration="empty-alerts"
            title={t('emptyAlertsTitle')}
            text={t('emptyAlertsText')}
            action={{ label: t('emptyAlertsAction'), onPress: () => router.navigate('/fahrzeuge') }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: space.lg, gap: space.md },
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
