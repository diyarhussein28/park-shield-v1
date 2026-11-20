import { Pressable, StyleSheet, Text, View } from 'react-native';
import { lang, t } from '@/lib/i18n';
import type { AlertListItem } from '@/lib/types';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { AlertTypeIcon } from './icons';
import { Chip } from './ui';

export function statusLabel(a: AlertListItem): string {
  if (a.acknowledged) return t('acknowledged');
  if (a.status === 'expired') return t('expired');
  if (a.status === 'escalated') return t('escalated');
  if (a.seenAt) return t('seen');
  return t('open');
}

const statusTone = (a: AlertListItem) =>
  a.acknowledged
    ? 'ok'
    : a.status === 'expired'
      ? 'neutral'
      : a.severity === 'urgent'
        ? 'urgent'
        : 'info';

const time = (iso: string) =>
  new Intl.DateTimeFormat(lang(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/** One alert in the feed: type icon, type, vehicle, time, status chip; urgent ones with a red stripe. */
export function AlertCard({ alert: a, onPress }: { alert: AlertListItem; onPress: () => void }) {
  const c = useTheme();
  const urgent = a.severity === 'urgent';
  const type = lang() === 'en' ? a.type.en : a.type.de;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${type}, ${a.vehicle.nickname}, ${statusLabel(a)}`}
      style={({ pressed }) => [
        s.card,
        {
          backgroundColor: c.surface,
          borderColor: urgent ? c.urgent : c.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {urgent && <View testID="urgent-stripe" style={[s.stripe, { backgroundColor: c.urgent }]} />}
      <AlertTypeIcon code={a.type.code} urgent={urgent} size={24} />
      <View style={s.text}>
        <View style={s.head}>
          <Text style={[typeScale.body, s.type, { color: c.fg }]}>{type}</Text>
          <Text style={[typeScale.caption, { color: c.muted }]}>{time(a.createdAt)}</Text>
        </View>
        <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>
          „{a.vehicle.nickname}“{a.photoCount ? ` · ${t('photos', { count: a.photoCount })}` : ''}
        </Text>
        <View style={s.chips}>
          <Chip tone={statusTone(a)}>{statusLabel(a)}</Chip>
          {a.isTest && <Chip tone="neutral">{t('test')}</Chip>}
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    paddingLeft: space.lg + 4,
    overflow: 'hidden',
    alignItems: 'flex-start',
  },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  text: { flex: 1, gap: space.xs },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  type: { fontWeight: '700', flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 2 },
});
