import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertCard } from '@/components/alert-card';
import { Segmented } from '@/components/form';
import { HistoryList } from '@/components/history-list';
import { isOpen } from '@/components/open-alert-card';
import { PushOffBanner } from '@/components/push-warning';
import { Banner, EmptyState } from '@/components/ui';
import { useAlerts } from '@/lib/alerts-store';
import { t } from '@/lib/i18n';
import type { AlertListItem } from '@/lib/types';
import { space, useTheme } from '@/theme/tokens';

type View_ = 'now' | 'history';

/**
 * Warnungen (§5.1): every alert of the app, open ones first, and the 90-day history with muted
 * alerts and blocking (the former „Verlauf“ screen) in one place. The tab carries the open-alert badge.
 */
export default function Alerts() {
  const c = useTheme();
  const router = useRouter();
  const { data, error, reload } = useAlerts();
  const [view, setView] = useState<View_>('now');
  const [refreshing, setRefreshing] = useState(false);
  // Open alerts first; the sort is stable, so each group stays newest first.
  const rank = (a: AlertListItem) => (isOpen(a) ? 0 : 1);
  const alerts = [...(data?.alerts ?? [])].sort((a, b) => rank(a) - rank(b));

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
              await reload();
              setRefreshing(false);
            }}
          />
        }
      >
        <PushOffBanner pushReady={data?.pushReady} onChanged={reload} />
        <Segmented
          legend={t('alertsShow')}
          options={['now', 'history'] as const}
          value={view}
          onChange={setView}
          label={(v) => (v === 'now' ? t('alertsNow') : t('alertsHistory'))}
        />
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
  body: { padding: space.lg, gap: space.md },
  list: { gap: space.md },
});
