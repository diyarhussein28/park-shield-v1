import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { lang, t } from '@/lib/i18n';
import type { AlertListItem } from '@/lib/types';
import { radius, space, type as typeScale, useTheme, type Theme } from '@/theme/tokens';
import {
  BlockSenderButton,
  blockedText,
  SenderBlockedStatus,
  UnblockSenderButton,
} from './block-sender';
import { Icon, alertTypeIcon, type IconName } from './icons';

/** Done = „Ich komme“ or „Erledigt“ (resolved). */
export const isDone = (a: AlertListItem) => a.acknowledged || Boolean(a.resolved);

export function statusLabel(a: AlertListItem): string {
  if (isDone(a)) return t('acknowledged');
  if (a.status === 'expired') return t('expired');
  // The owner did not react for 30 minutes: the one SMS went out.
  if (a.escalationStage === 'sms_sent') return t('escalated');
  if (a.seenAt) return t('seen');
  return t('open');
}

type Tone = 'info' | 'ok' | 'neutral' | 'urgent';

const statusTone = (a: AlertListItem): Tone =>
  isDone(a)
    ? 'ok'
    : a.status === 'expired'
      ? 'neutral'
      : a.severity === 'urgent' && !a.seenAt
        ? 'urgent'
        : 'info';

/** „21.11., 23:11“ (de) · „11/21, 11:11 PM“ (en). */
export const shortTime = (iso: string) =>
  new Intl.DateTimeFormat(lang() === 'en' ? 'en-US' : 'de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/**
 * The soft purple of „Eigene Nachricht“ cards (design 2026-11-22). Not a theme token: it is used on
 * this card only; both pairs keep AA contrast for the icon on its container.
 */
const PURPLE = {
  light: { bg: '#faf7ff', border: '#c4b5fd', box: '#ede9fe', icon: '#6d28d9' },
  dark: { bg: '#1c1631', border: '#5b3fa8', box: '#2e1f57', icon: '#c4b5fd' },
};

/** Pill colours: Gesehen soft blue, Erledigt soft green, Test soft grey. */
const pillColors = (c: Theme, tone: Tone) =>
  ({
    info: [c.infoBg, c.infoFg],
    ok: [c.successBg, c.successFg],
    neutral: [c.secondary, c.secondaryFg],
    urgent: [c.dangerBg, c.dangerText],
  })[tone];

function Pill({ tone, icon, label }: { tone: Tone; icon?: IconName; label: string }) {
  const c = useTheme();
  const [bg, fg] = pillColors(c, tone);
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[s.pill, { backgroundColor: bg }]}
      testID={`pill-${tone}`}
    >
      {icon && <Icon name={icon} size={15} color={fg!} />}
      <Text style={[typeScale.caption, { color: fg, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

/**
 * One alert in the Warnungen tab (design 2026-11-22): a white rounded card on the light background,
 * a rounded-square icon tinted by the alert type, title and short time, vehicle and photo count,
 * status pills, and below a divider the block action — or, once the sender is blocked (server-side,
 * every alert of that sender), the blocked state and „Blockierung aufheben“. Never for test alerts.
 */
export function AlertCard({
  alert: a,
  onPress,
  onSenderChanged,
}: {
  alert: AlertListItem;
  onPress: () => void;
  onSenderChanged?: (blocked: boolean, until: string | null) => void | Promise<void>;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const urgent = a.severity === 'urgent';
  const custom = a.type.code === 'custom';
  const purple = PURPLE[dark ? 'dark' : 'light'];
  const type = lang() === 'en' ? a.type.en : a.type.de;
  const status = statusLabel(a);
  const done = isDone(a);
  const photos = a.photoCount ? t('photos', { count: a.photoCount }) : null;
  const subtitle = [`„${a.vehicle.nickname}“`, photos].filter(Boolean).join(' · ');
  const time = shortTime(a.createdAt);
  const cardBg = custom ? purple.bg : dark ? c.surface : c.bg;
  const border = urgent && !done ? c.urgent : custom ? purple.border : c.border;
  const boxBg = urgent ? c.dangerBg : custom ? purple.box : c.infoBg;
  const iconColor = urgent ? c.urgent : custom ? purple.icon : c.primary;
  const footer = !a.isTest && onSenderChanged;

  return (
    <View
      testID={`alert-card-${a.id}`}
      style={[s.wrap, { backgroundColor: cardBg, borderColor: border }]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[
          type,
          a.vehicle.nickname,
          photos,
          time,
          status,
          a.isTest ? t('test') : null,
          a.senderBlocked ? blockedText(a.blockedUntil) : null,
        ]
          .filter(Boolean)
          .join(', ')}
        style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={[s.box, { backgroundColor: boxBg }]}>
          <Icon name={alertTypeIcon(a.type.code)} size={26} color={iconColor} />
        </View>
        <View style={s.text}>
          <View style={s.head}>
            <Text style={[typeScale.body, s.type, { color: c.fg }]}>{type}</Text>
            <Text style={[typeScale.caption, s.time, { color: c.muted }]}>{time}</Text>
          </View>
          <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>{subtitle}</Text>
          <View style={s.pills}>
            <Pill tone={statusTone(a)} icon={done ? 'check' : undefined} label={status} />
            {a.isTest && <Pill tone="neutral" icon="flask" label={t('test')} />}
          </View>
        </View>
      </Pressable>
      {footer && (
        <View style={[s.footer, { borderTopColor: custom ? purple.border : c.border }]}>
          {a.senderBlocked ? (
            <>
              <SenderBlockedStatus until={a.blockedUntil} />
              <UnblockSenderButton
                alertId={a.id}
                variant="link"
                testID={`unblock-${a.id}`}
                onUnblocked={(r) => onSenderChanged(r.senderBlocked, r.blockedUntil)}
              />
            </>
          ) : (
            <BlockSenderButton
              alertId={a.id}
              variant="link"
              testID={`block-${a.id}`}
              onBlocked={(r) => onSenderChanged(true, r.blockedUntil)}
            />
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: radius.lg + 2, overflow: 'hidden' },
  card: { flexDirection: 'row', gap: space.lg, padding: space.lg, alignItems: 'flex-start' },
  box: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: space.xs },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  type: { fontWeight: '700', flexShrink: 1 },
  time: { flexShrink: 0, paddingTop: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  footer: {
    borderTopWidth: 1,
    marginHorizontal: space.lg,
    paddingVertical: space.xs,
    gap: 0,
  },
});
