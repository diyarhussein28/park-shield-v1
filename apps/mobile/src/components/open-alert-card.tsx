import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ago } from '@/lib/ago';
import { api, ApiError } from '@/lib/api';
import { lang, t } from '@/lib/i18n';
import type { AlertListItem } from '@/lib/types';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { AlertTypeIcon, Icon } from './icons';
import { Button } from './ui';

/** German „…“, English “…”. */
export const quoted = (s: string) => (lang() === 'en' ? `“${s}”` : `„${s}“`);

export const isOpen = (a: AlertListItem) => !a.acknowledged && a.status !== 'expired';

/**
 * One open alert, first thing on Home (P1): warm colour (urgent ones red), how long ago, the car, and
 * „Ich komme“ right on the card. A tap elsewhere opens the alert.
 */
export function OpenAlertCard({
  alert: a,
  onAnswered,
}: {
  alert: AlertListItem;
  /** true when „Ich komme“ went through. */
  onAnswered: (sent: boolean) => void;
}) {
  const c = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const urgent = a.severity === 'urgent';
  const type = lang() === 'en' ? a.type.en : a.type.de;
  const [bg, border, fg] = urgent
    ? [c.dangerBg, c.urgent, c.dangerText]
    : [c.accentSubtle, c.accent, c.accentSubtleFg];

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const coming = async () => {
    setBusy(true);
    let sent = false;
    try {
      await api(`/v1/app/alerts/${a.id}/ack`, { body: { reply: 'coming' } });
      sent = true;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) {
        router.push({ pathname: '/alerts/[id]', params: { id: a.id } });
      }
    } finally {
      setBusy(false);
      onAnswered(sent);
    }
  };

  return (
    <View testID="open-alert" style={[s.alert, { backgroundColor: bg, borderColor: border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${type}, ${quoted(a.vehicle.nickname)}, ${ago(a.createdAt, now)}`}
        accessibilityHint={t('alertsShow')}
        onPress={() => router.push({ pathname: '/alerts/[id]', params: { id: a.id } })}
        style={s.alertHead}
      >
        <AlertTypeIcon code={a.type.code} urgent={urgent} size={26} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[typeScale.heading, { color: c.fg }]}>{type}</Text>
          <Text style={[typeScale.label, { color: fg }]}>
            {quoted(a.vehicle.nickname)} · {ago(a.createdAt, now)}
          </Text>
        </View>
        <Icon name="chevronRight" size={20} color={fg} />
      </Pressable>
      <Button
        label={t('coming')}
        size="lg"
        onPress={() => void coming()}
        busy={busy}
        testID="home-coming"
      />
    </View>
  );
}

const s = StyleSheet.create({
  alert: { borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
});
