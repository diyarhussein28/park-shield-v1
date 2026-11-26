import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CarArt } from '@/components/art';
import { BeRightBack } from '@/components/be-right-back';
import { CarPicture } from '@/components/car-picture';
import { Icon } from '@/components/icons';
import { NoCodeCard } from '@/components/no-code';
import { quoted } from '@/components/open-alert-card';
import { PushOffBanner } from '@/components/push-warning';
import { PastDue } from '@/components/subscription';
import { WelcomePrintCta } from '@/components/welcome-print-cta';
import { Banner, Button, Chip } from '@/components/ui';
import { api, authHeaders } from '@/lib/api';
import { showWelcomePrintCta } from '@/lib/billing';
import { useAlerts } from '@/lib/alerts-store';
import { HAS_FIREBASE } from '@/lib/config';
import { decalPreviewUrl, onDecalChange } from '@/lib/decal';
import { t } from '@/lib/i18n';
import {
  longDate,
  type PortalVehicle,
  type Protection,
  type SubscriptionSummary,
} from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { getFlag, setFlag } from '@/lib/prefs';
import { useOptionalProfile } from '@/lib/profile';
import { setupSteps, setupSummary } from '@/lib/setup';
import { vehiclePhoto } from '@/lib/vehicle-photo';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';

/**
 * Start (Home, Stage 4.1): „Hallo {Vorname}“, then the car (the owner's own photo or the
 * illustration; a tap picks a photo) with its protection status (protected, steps left, no active
 * code, plan ending), the current QR decal in small (style, headline, status) with „Ansehen /
 * Testen“ and „Design bearbeiten“, and one set-up step. Alerts are not listed here any more: they
 * live in the Warnungen tab with its badge; Home only links there.
 */
export default function Home() {
  const c = useTheme();
  const router = useRouter();
  const { data, error, reload, open } = useAlerts();
  const firstName = useOptionalProfile()?.data?.profile?.firstName?.trim();
  const [refreshing, setRefreshing] = useState(false);
  const [sub, setSub] = useState<SubscriptionSummary | null | undefined>(undefined);
  const [protection, setProtection] = useState<Protection | null>(null);
  const [vehicles, setVehicles] = useState<PortalVehicle[] | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [hidden, setHidden] = useState(true);
  const [welcomeFree, setWelcomeFree] = useState(false);

  const load = useCallback(async () => {
    void reload();
    const s = await api<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription')
      .then((r) => r.subscription)
      .catch(() => undefined);
    setSub(s);
    if (s) {
      const [p, v, o] = await Promise.all([
        api<Protection>('/v1/me/protection').catch(() => null),
        api<{ vehicles: PortalVehicle[] }>('/v1/vehicles').catch(() => ({ vehicles: [] })),
        api<{ includedAvailable?: boolean }>('/v1/orders').catch(() => ({
          includedAvailable: false,
        })),
      ]);
      setWelcomeFree(Boolean(o.includedAvailable));
      setProtection(p);
      setVehicles(v.vehicles);
      const car = v.vehicles[0];
      setPhoto(car ? vehiclePhoto(car.id) : null);
    }
    setHidden(await getFlag('setupDismissed'));
  }, [reload]);

  useEffect(() => {
    void authHeaders().then(setHeaders);
  }, []);
  // On focus (back from the photo or design screen) and at once when a decal changes (Stage 4.3).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => onDecalChange(() => void load()), [load]);

  const steps = protection && vehicles ? setupSteps(protection, vehicles) : null;
  const summary = steps ? setupSummary(steps) : null;
  const first = vehicles?.[0] ?? null;
  const decal = first?.decal ?? null;
  const preview = first ? decalPreviewUrl(first) : null;
  const ending = sub?.cancelAtPeriodEnd && sub.currentPeriodEnd ? sub.currentPeriodEnd : null;

  // The status pill: no active code beats everything, then a plan that ends, then the set-up steps.
  const status: { tone: 'ok' | 'warn' | 'urgent'; text: string } | null =
    first && summary
      ? !decal
        ? { tone: 'urgent', text: t('noCodeChip') }
        : ending
          ? { tone: 'warn', text: t('homeEnding', { date: longDate(ending) }) }
          : summary.complete
            ? { tone: 'ok', text: t('homeProtected') }
            : { tone: 'warn', text: t('homeStepsLeft', { count: summary.left }) }
      : null;
  const title = first
    ? !decal
      ? quoted(first.nickname)
      : summary?.complete
        ? t('homeProtectedTitle', { nickname: first.nickname })
        : t('homeAlmostTitle', { nickname: first.nickname })
    : '';

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
        <Text accessibilityRole="header" style={[typeScale.title, { color: c.fg }]} testID="hello">
          {firstName ? t('homeHello', { name: firstName }) : t('homeHelloNoName')}
        </Text>
        {error && <Banner tone="err">{t('offline')}</Banner>}

        {sub?.status === 'past_due' && <PastDue sub={sub} />}
        {/* Alerts are push only: without it the first sign is the SMS after 30 minutes. No
            automatic permission prompt here (P6): the banner only asks on its button. */}
        {sub && <PushOffBanner pushReady={data?.pushReady} onChanged={reload} />}

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

        {sub && first && !decal && <NoCodeCard vehicle={first} onCreated={() => load()} />}

        {sub && first && status && (
          <View
            testID="home-status"
            style={[s.hero, { backgroundColor: c.surface, borderColor: c.border }]}
          >
            <Pressable
              testID="car"
              accessibilityRole="button"
              accessibilityLabel={t('carPhotoTitle')}
              accessibilityHint={t('carPhotoHint')}
              onPress={() =>
                router.push({
                  pathname: '/fahrzeug/foto/[id]',
                  params: { id: first.id, nickname: first.nickname },
                })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            >
              <CarPicture
                uri={photo}
                nickname={first.nickname}
                protectedBadge={Boolean(decal) && summary?.complete && !ending}
              />
            </Pressable>
            <Text style={[typeScale.title, s.center, { color: c.fg }]}>{title}</Text>
            {status.tone === 'ok' ? (
              <View style={[s.badge, { backgroundColor: c.successBg }]}>
                <Icon name="shieldCheck" size={18} color={c.successFg} />
                <Text style={[typeScale.label, { color: c.successFg }]}>{status.text}</Text>
              </View>
            ) : (
              <Chip tone={status.tone}>{status.text}</Chip>
            )}
            {first.plate && (
              <Text style={[typeScale.caption, { color: c.muted }]}>
                {[first.plate, first.makeModel].filter(Boolean).join(' · ')}
              </Text>
            )}
            {/* „Bin gleich zurück“: the button, or the running status with its countdown. */}
            {decal && <BeRightBack vehicleId={first.id} />}

            {decal && preview && (
              <View testID="home-decal" style={[s.decal, { borderColor: c.border }]}>
                <View style={[s.thumb, { borderColor: c.border }]}>
                  {headers && (
                    <Image
                      testID="home-decal-image"
                      source={{ uri: preview, headers }}
                      contentFit="contain"
                      style={s.thumbImage}
                      accessible={false}
                    />
                  )}
                </View>
                <View style={s.decalText}>
                  <Text style={[typeScale.label, { color: c.fg }]}>{t('homeDecalTitle')}</Text>
                  <Text style={[typeScale.caption, { color: c.muted }]}>
                    {pt(`decal.template_${decal.template}` as MessageKey)}
                  </Text>
                  <Text style={[typeScale.caption, { color: c.fg }]} numberOfLines={2}>
                    {quoted(decal.cta)}
                  </Text>
                  <Chip tone={decal.status === 'assigned' ? 'ok' : 'info'}>
                    {pt(`vehicles.status_${decal.status}` as MessageKey)}
                  </Chip>
                </View>
              </View>
            )}
            {decal && (
              <View style={s.actions}>
                <View style={s.action}>
                  <Button
                    label={t('homeViewTest')}
                    variant="secondary"
                    onPress={() =>
                      router.push({ pathname: '/fahrzeug/[id]', params: { id: first.id } })
                    }
                    testID="home-view"
                  />
                </View>
                <View style={s.action}>
                  <Button
                    label={t('homeEditDesign')}
                    variant="secondary"
                    onPress={() =>
                      router.push({ pathname: '/fahrzeug/design/[id]', params: { id: first.id } })
                    }
                    testID="home-design"
                  />
                </View>
              </View>
            )}
            {vehicles && vehicles.length > 1 && (
              <Text style={[typeScale.caption, { color: c.muted }]}>
                {t('homeMoreCars', { count: vehicles.length - 1 })}
              </Text>
            )}
          </View>
        )}

        {sub &&
          first &&
          showWelcomePrintCta({ includedAvailable: welcomeFree, hasDecal: Boolean(decal) }) && (
            <WelcomePrintCta vehicleId={first.id} />
          )}

        {sub && decal && summary?.next && !hidden && (
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

        {/* No alert cards on Home (Stage 4.1): one line, and the badge on the Warnungen tab. */}
        {sub && data && open > 0 && (
          <Button
            label={t('homeOpenAlertsLink', { count: open })}
            variant="ghost"
            onPress={() => router.navigate('/alerts')}
            testID="home-alerts-link"
          />
        )}
        {sub && data && open === 0 && (
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
  decal: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: space.md,
    borderTopWidth: 1,
    paddingTop: space.md,
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
  decalText: { flex: 1, gap: 4, alignItems: 'flex-start' },
  actions: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: { flexGrow: 1, flexBasis: 140 },
  strip: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  stripHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  quiet: { flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'center' },
});
