import { Pressable, StyleSheet, Text, View } from 'react-native';
import { lang, t } from '@/lib/i18n';
import type { AlertListItem } from '@/lib/types';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { BlockSenderButton, type BlockResult } from './block-sender';
import { AlertTypeIcon } from './icons';
import { Chip } from './ui';

export function statusLabel(a: AlertListItem): string {
  if (a.acknowledged) return t('acknowledged');
  if (a.status === 'expired') return t('expired');
  // The owner did not react for 30 minutes: the one SMS went out.
  if (a.escalationStage === 'sms_sent') return t('escalated');
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

/**
 * One alert in the feed: type icon, type, vehicle, time, status chip; urgent ones with a red stripe.
 * „Absender blockieren“ right on the card (Stage 3), never for test alerts; once blocked the card says
 * so instead.
 */
export function AlertCard({
  alert: a,
  onPress,
  blocked,
  onBlocked,
}: {
  alert: AlertListItem;
  onPress: () => void;
  blocked?: boolean;
  onBlocked?: (r: BlockResult) => void | Promise<void>;
}) {
  const c = useTheme();
  const urgent = a.severity === 'urgent';
  const type = lang() === 'en' ? a.type.en : a.type.de;
  return (
    <View
      style={[s.wrap, { backgroundColor: c.surface, borderColor: urgent ? c.urgent : c.border }]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${type}, ${a.vehicle.nickname}, ${statusLabel(a)}`}
        style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}
      >
        {urgent && (
          <View testID="urgent-stripe" style={[s.stripe, { backgroundColor: c.urgent }]} />
        )}
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
      {!a.isTest && (blocked || onBlocked) && (
        <View style={s.actions}>
          {blocked ? (
            <Chip tone="neutral">{t('blocked')}</Chip>
          ) : (
            <BlockSenderButton
              alertId={a.id}
              variant="ghost"
              onBlocked={onBlocked!}
              testID={`block-${a.id}`}
            />
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  card: {
    flexDirection: 'row',
    gap: space.md,
    padding: space.lg,
    paddingLeft: space.lg + 4,
    alignItems: 'flex-start',
  },
  actions: { paddingHorizontal: space.lg, paddingBottom: space.sm, alignItems: 'flex-start' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  text: { flex: 1, gap: space.xs },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  type: { fontWeight: '700', flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 2 },
});
