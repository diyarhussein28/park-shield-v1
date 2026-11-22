import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertCard } from '@/components/alert-card';
import { HistoryList } from '@/components/history-list';
import { LogoMark, Wordmark } from '@/components/icons';
import { isOpen } from '@/components/open-alert-card';
import { PushOffBanner } from '@/components/push-warning';
import { Banner, EmptyState } from '@/components/ui';
import { useAlerts } from '@/lib/alerts-store';
import { t } from '@/lib/i18n';
import type { AlertListItem } from '@/lib/types';
import { radius, space, touch, type as typeScale, useTheme } from '@/theme/tokens';

type View_ = 'now' | 'history';

/**
 * „Aktuell“ / „Verlauf (90 Tage)“ (design 2026-11-22): the active segment filled in ParkShield blue
 * with white text, the other on a soft tint. A radio group for screen readers, each segment ≥ 48 pt.
 */
function ViewSwitch({ value, onChange }: { value: View_; onChange: (v: View_) => void }) {
  const c = useTheme();
  return (
    <View style={s.switchWrap}>
      <Text style={[typeScale.label, { color: c.fg }]}>{t('alertsShow')}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('alertsShow')}
        style={[s.switch, { backgroundColor: c.secondary }]}
      >
        {(['now', 'history'] as const).map((v) => {
          const on = v === value;
          const label = v === 'now' ? t('alertsNow') : t('alertsHistory');
          return (
            <Pressable
              key={v}
              testID={`view-${v}`}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: on }}
              onPress={() => onChange(v)}
              style={[s.segment, on && { backgroundColor: c.primary }]}
            >
              <Text
                style={[
                  typeScale.label,
                  { color: on ? c.primaryFg : c.fg, textAlign: 'center', fontWeight: '600' },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Warnungen (§5.1): every alert of the app, open ones first, and the 90-day history with muted
 * alerts and blocking in one place. Own header (logo, wordmark, large title) as in the design of
 * 2026-11-22. The tab carries the badge of unopened alerts.
 */
export default function Alerts() {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const router = useRouter();
  const { data, error, reload, senderChanged } = useAlerts();
  const [view, setView] = useState<View_>('now');
  const [refreshing, setRefreshing] = useState(false);
  // Fresh state (block status, seen, badge) every time the tab comes into view.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  // Open alerts first; the sort is stable, so each group stays newest first.
  const rank = (a: AlertListItem) => (isOpen(a) ? 0 : 1);
  const alerts = [...(data?.alerts ?? [])].sort((a, b) => rank(a) - rank(b));
  // Light background, white cards (dark: the other way round, as everywhere in the app).
  const bg = dark ? c.bg : c.surface;

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: bg }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await reload();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={s.header}>
          <View style={s.brand} accessible accessibilityLabel="ParkShield">
            <LogoMark size={30} />
            <Wordmark size={22} maxScale={1.3} />
          </View>
          <Text accessibilityRole="header" style={[typeScale.display, s.title, { color: c.fg }]}>
            {t('alertsTitle')}
          </Text>
        </View>
        <PushOffBanner pushReady={data?.pushReady} onChanged={reload} />
        <ViewSwitch value={view} onChange={setView} />
        {view === 'history' ? (
          <HistoryList />
        ) : (
          <View style={s.list}>
            {error && <Banner tone="err">{t('offline')}</Banner>}
            {alerts.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                onPress={() => router.push({ pathname: '/alerts/[id]', params: { id: a.id } })}
                onSenderChanged={(blocked, until) => senderChanged(a.id, blocked, until)}
              />
            ))}
            {data && alerts.length === 0 && (
              <EmptyState
                illustration="empty-alerts"
                title={t('emptyAlertsTitle')}
                text={t('emptyAlertsText')}
                action={{
                  label: t('emptyAlertsAction'),
                  onPress: () => router.navigate('/fahrzeuge'),
                }}
              />
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: space.lg, gap: space.lg },
  header: { gap: space.md, paddingTop: space.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { fontSize: 34, lineHeight: 41 },
  list: { gap: space.md },
  switchWrap: { gap: space.sm },
  switch: { flexDirection: 'row', borderRadius: radius.md + 2, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: touch.min,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
});
