import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CarArt } from '@/components/art';
import { Icon } from '@/components/icons';
import { NoCodeCard } from '@/components/no-code';
import { isOpen, OpenAlertCard } from '@/components/open-alert-card';
import { PushOffBanner } from '@/components/push-warning';
import { PastDue } from '@/components/subscription';
import { Banner, Button, Chip } from '@/components/ui';
import { api } from '@/lib/api';
import { openAlertCount, useAlerts } from '@/lib/alerts-store';
import { HAS_FIREBASE } from '@/lib/config';
import { t } from '@/lib/i18n';
import type { PortalVehicle, Protection, SubscriptionSummary } from '@/lib/portal';
import { getFlag, setFlag } from '@/lib/prefs';
import { setupSteps, setupSummary } from '@/lib/setup';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';

/**
 * Start (Home, §5.1): open alerts first, then the protection status with the car, then one compact
 * set-up step with one button. The three-step explainer lives in the onboarding only (P9).
 */
export default function Home() {
  const c = useTheme();
  const router = useRouter();
  const { data, error, reload } = useAlerts();
  const [refreshing, setRefreshing] = useState(false);
  const [sub, setSub] = useState<SubscriptionSummary | null | undefined>(undefined);
  const [protection, setProtection] = useState<Protection | null>(null);
  const [vehicles, setVehicles] = useState<PortalVehicle[] | null>(null);
  const [hidden, setHidden] = useState(true);
  // „Ich komme“ from a card: a short confirmation instead of a card that silently disappears.
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (!answered) return;
    const id = setTimeout(() => setAnswered(false), 6000);
    return () => clearTimeout(id);
  }, [answered]);

  const load = useCallback(async () => {
    void reload();
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
    setHidden(await getFlag('setupDismissed'));
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (data?.alerts ?? []).filter(isOpen);
  const steps = protection && vehicles ? setupSteps(protection, vehicles) : null;
  const summary = steps ? setupSummary(steps) : null;
  const first = vehicles?.[0] ?? null;

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: c.bg }]} edges={['left', 'right']}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
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
        {error && <Banner tone="err">{t('offline')}</Banner>}
        {answered && (
          <Banner tone="ok" testID="coming-sent">
            {t('comingDone')}
          </Banner>
        )}

        {open.length > 0 && (
          <View style={s.section}>
            <Text
              accessibilityRole="header"
              style={[typeScale.caption, s.kicker, { color: c.urgent }]}
            >
              {t('homeOpenAlerts', { count: openAlertCount(open) }).toUpperCase()}
            </Text>
            {open.map((a) => (
              <OpenAlertCard
                key={a.id}
                alert={a}
                onAnswered={(sent) => {
                  if (sent) setAnswered(true);
                  void reload();
                }}
              />
            ))}
          </View>
        )}

        {sub?.status === 'past_due' && <PastDue />}
        {/* Alerts are push only: without it the first sign is the SMS after 30 minutes. No
            automatic permission prompt here (P6): the banner only asks on its button. */}
        {sub && <PushOffBanner pushReady={data?.pushReady} onChanged={reload} />}

        {sub && first && !first.decal && <NoCodeCard vehicle={first} onCreated={() => load()} />}

        {sub === null && (
          <View
            testID="home-no-plan"
            style={[s.hero, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <CarArt width={260} />
            <Text accessibilityRole="header" style={[typeScale.title, s.center, { color: c.fg }]}>
              {t('homeNoPlanTitle')}
            </Text>
            <Text style={[typeScale.body, s.center, { color: c.muted }]}>
              {t('homeNoPlanText')}
            </Text>
            <Button
              label={t('homeNoPlanCta')}
              onPress={() => router.push('/tarif')}
              testID="home-plans"
            />
          </View>
        )}

        {sub && vehicles && vehicles.length === 0 && (
          <View style={[s.hero, { backgroundColor: c.surface, borderColor: c.border }]}>
            <CarArt width={260} />
            <Text accessibilityRole="header" style={[typeScale.title, s.center, { color: c.fg }]}>
              {t('homeNoCarTitle')}
            </Text>
            <Text style={[typeScale.body, s.center, { color: c.muted }]}>{t('homeNoCarText')}</Text>
            <Button label={t('addCarCta')} onPress={() => router.navigate('/fahrzeuge')} />
          </View>
        )}

        {sub && vehicles && first?.decal && summary && (
          <Pressable
            testID="home-status"
            accessibilityRole="button"
            accessibilityLabel={`${
              summary.complete
                ? t('homeProtectedTitle', { nickname: first.nickname })
                : t('homeAlmostTitle', { nickname: first.nickname })
            }, ${summary.complete ? t('homeProtected') : t('homeStepsLeft', { count: summary.left })}`}
            onPress={() => router.push({ pathname: '/fahrzeug/[id]', params: { id: first.id } })}
            style={({ pressed }) => [
              s.hero,
              { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <CarArt width={260} protectedBadge={summary.complete} />
            <Text style={[typeScale.title, s.center, { color: c.fg }]}>
              {summary.complete
                ? t('homeProtectedTitle', { nickname: first.nickname })
                : t('homeAlmostTitle', { nickname: first.nickname })}
            </Text>
            {summary.complete ? (
              <View style={[s.badge, { backgroundColor: c.successBg }]}>
                <Icon name="shieldCheck" size={18} color={c.successFg} />
                <Text style={[typeScale.label, { color: c.successFg }]}>{t('homeProtected')}</Text>
              </View>
            ) : (
              <Chip tone="warn">{t('homeStepsLeft', { count: summary.left })}</Chip>
            )}
            {vehicles.length > 1 && (
              <Text style={[typeScale.caption, { color: c.muted }]}>
                {t('homeMoreCars', { count: vehicles.length - 1 })}
              </Text>
            )}
          </Pressable>
        )}

        {sub && summary?.next && !hidden && (vehicles?.length ?? 0) > 0 && (
          <View testID="setup-strip" style={[s.strip, { backgroundColor: c.infoBg }]}>
            <View style={s.stripHead}>
              <Text style={[typeScale.caption, { color: c.infoFg, flex: 1 }]}>
                {t('setupNext').toUpperCase()} ·{' '}
                {t('setupProgress', { done: summary.done, total: summary.total })}
              </Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  setHidden(true);
                  void setFlag('setupDismissed', true);
                }}
              >
                <Text
                  style={[typeScale.caption, { color: c.infoFg, textDecorationLine: 'underline' }]}
                >
                  {t('setupHide')}
                </Text>
              </Pressable>
            </View>
            <Text style={[typeScale.body, { color: c.infoFg, fontWeight: '700' }]}>
              {summary.next.title}
            </Text>
            <Button
              label={summary.next.go}
              onPress={() => router.push(summary.next!.href)}
              testID="setup-go"
            />
          </View>
        )}

        {sub && data && open.length === 0 && (
          <View style={s.quiet}>
            <Icon name="shieldCheck" size={20} color={c.muted} />
            <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>
              {t('homeAllQuiet')}
            </Text>
          </View>
        )}

        {!HAS_FIREBASE && (
          <Text testID="dev-note" style={[typeScale.caption, s.center, { color: c.muted }]}>
            {t('footerDevNote', { text: t('pushNoFirebase') })}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },
  section: { gap: space.md },
  kicker: { letterSpacing: 0.8, fontWeight: '800' },
  alert: { borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
  hero: {
    borderWidth: 1,
    borderRadius: radius.lg + 4,
    padding: space.xl,
    gap: space.md,
    alignItems: 'center',
  },
  center: { textAlign: 'center' },
  badge: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  strip: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  quiet: { flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center' },
});
