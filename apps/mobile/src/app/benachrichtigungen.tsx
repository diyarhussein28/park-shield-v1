import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Check, Field, H3 } from '@/components/form';
import { SwitchRow } from '@/components/list';
import { PhoneCard } from '@/components/phone-setup';
import { PushOffBanner } from '@/components/push-warning';
import { Banner, Button, Card, Chip, P, Screen, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { APP_VERSION, HAS_FIREBASE } from '@/lib/config';
import { t } from '@/lib/i18n';
import {
  errorText,
  type ChannelsOverview,
  type QuietHours,
  type QuietRule,
  type Usage,
} from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { permission, registerDevice, requestPermission, type PushPermission } from '@/lib/push';

/**
 * „Benachrichtigungen“ (web: /konto/benachrichtigungen, 2026-11-21): alerts come by app push only, so
 * this screen has exactly three parts: the app notifications (permission, open the system settings,
 * the phones signed in), the verified mobile number for the one SMS after 30 minutes, and quiet hours.
 * E-mail, browser push, channel order and WhatsApp are gone.
 */
export default function Notifications() {
  const [data, setData] = useState<ChannelsOverview | null>(null);
  const [usage, setUsage] = useState<Usage | undefined>(undefined);
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [channels, used, q] = await Promise.all([
        api<ChannelsOverview>('/v1/channels'),
        api<Usage>('/v1/me/usage').catch(() => undefined),
        api<QuietHours>('/v1/quiet-hours'),
      ]);
      setData(channels);
      setUsage(used);
      setQuiet(q);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <Screen>
      <P muted>{t('notifIntro')}</P>
      {error && <Banner tone="err">{error}</Banner>}
      {data && <PushOffBanner pushReady={data.app.devices.length > 0} onChanged={reload} />}
      {data && <AppPushCard devices={data.app.devices} reload={reload} />}
      {data && <PhoneCard phone={data.sms?.phone ?? null} usage={usage} onChanged={reload} />}
      {quiet && <QuietHoursCard initial={quiet} />}
    </Screen>
  );
}

/**
 * This app's notifications: on or off (system permission and a registered device), a button to the
 * system settings, and the phones signed in to the app. Allowed but not registered yet (e.g. switched
 * on in the iOS settings): registers this device and reloads, so it counts at once.
 */
function AppPushCard({
  devices,
  reload,
}: {
  devices: ChannelsOverview['app']['devices'];
  reload: () => Promise<void>;
}) {
  const [push, setPush] = useState<PushPermission | null>(null);
  const none = devices.length === 0;
  useFocusEffect(
    useCallback(() => {
      void permission()
        .then(async (p) => {
          setPush(p);
          if (p === 'granted' && none && (await registerDevice().catch(() => false))) {
            await reload();
          }
        })
        .catch(() => setPush(null));
    }, [none, reload]),
  );
  const allow = async () => {
    const p = await requestPermission().catch(() => 'undetermined' as const);
    setPush(p);
    if (p === 'granted') await reload();
  };
  const on = push === 'granted' && !none;
  return (
    <Card>
      <View style={s.head}>
        <Title>{t('appPushTitle')}</Title>
        <Chip tone={on ? 'ok' : 'warn'}>{on ? t('pushActive') : t('pushInactive')}</Chip>
      </View>
      {!HAS_FIREBASE ? (
        <Banner tone="warn">{t('pushNoFirebase')}</Banner>
      ) : push === 'granted' ? (
        <P>{t('notificationsOn')}</P>
      ) : push === 'undetermined' ? (
        <Button label={t('pushTitle')} onPress={() => void allow()} testID="push-allow-card" />
      ) : null}
      {/* Always reachable: Focus modes, sounds and the lock screen are set in the system. */}
      <Button
        label={t('pushOpenSettings')}
        variant="secondary"
        onPress={() => void Linking.openSettings()}
        testID="open-settings"
      />
      <H3>{t('appDevices')}</H3>
      {devices.length === 0 ? (
        <P muted>{t('appDevicesNone')}</P>
      ) : (
        devices.map((d) => (
          <P key={d.id}>
            {t('appDevice', {
              platform: d.platform === 'ios' ? 'iPhone' : 'Android',
              version: d.appVersion ?? APP_VERSION,
              date: new Date(d.lastSeenAt).toLocaleDateString(),
            })}
          </P>
        ))
      )}
    </Card>
  );
}

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** OW-06 / US-26: quiet hours per weekday; urgent alerts bypass them by default. */
function QuietHoursCard({ initial }: { initial: QuietHours }) {
  const [data, setData] = useState(initial);
  const [days, setDays] = useState<number[]>([...DAYS]);
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('07:00');
  const [urgentBypass, setUrgentBypass] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayText = (list: number[]) => {
    const key = list.join(',');
    if (key === '0,1,2,3,4,5,6') return pt('quiet.everyDay');
    if (key === '0,1,2,3,4') return pt('quiet.weekdays');
    if (key === '5,6') return pt('quiet.weekend');
    return list.map((d) => pt(`quiet.day${d}` as MessageKey)).join(', ');
  };
  const ruleText = (r: QuietRule) =>
    pt('quiet.rule', { days: dayText(r.days), start: r.start, end: r.end });

  const add = async () => {
    setError(null);
    if (!days.length) {
      setError(pt('quiet.daysRequired'));
      return;
    }
    setBusy(true);
    try {
      setData(
        await api<QuietHours>('/v1/quiet-hours', {
          body: { days: [...days].sort(), start, end, urgentBypass },
        }),
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.body?.error === 'rule_limit'
          ? pt('quiet.limit', { limit: 7 })
          : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    await api(`/v1/quiet-hours/${id}`, { method: 'DELETE' }).catch(() => undefined);
    setData(await api<QuietHours>('/v1/quiet-hours'));
  };

  return (
    <Card>
      <Title>{pt('quiet.title')}</Title>
      <P>{pt('quiet.intro')}</P>
      {data.rules.length === 0 ? (
        <P muted>{pt('quiet.none')}</P>
      ) : (
        data.rules.map((r) => (
          <View key={r.id} style={s.item}>
            <P style={{ fontWeight: '700' }}>
              {ruleText(r)} · {r.urgentBypass ? pt('quiet.ruleUrgent') : pt('quiet.ruleAll')}
            </P>
            <Button
              variant="secondary"
              label={pt('quiet.removeLabel', { rule: ruleText(r) })}
              onPress={() => void remove(r.id)}
            />
          </View>
        ))
      )}
      <H3>{pt('quiet.add')}</H3>
      <P style={{ fontWeight: '700' }}>{pt('quiet.days')}</P>
      {DAYS.map((d) => (
        <Check
          key={d}
          label={pt(`quiet.dayLong${d}` as MessageKey)}
          checked={days.includes(d)}
          onChange={(on) => setDays((list) => (on ? [...list, d] : list.filter((x) => x !== d)))}
        />
      ))}
      <Field
        label={pt('quiet.from')}
        value={start}
        onChangeText={setStart}
        placeholder="22:00"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        error={start && !TIME.test(start) ? 'HH:MM' : null}
      />
      <Field
        label={pt('quiet.to')}
        value={end}
        onChangeText={setEnd}
        placeholder="07:00"
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        error={end && !TIME.test(end) ? 'HH:MM' : null}
      />
      <P muted>{`${pt('quiet.overnight')} ${pt('quiet.timezone', { timezone: data.timezone })}`}</P>
      <SwitchRow title={pt('quiet.urgentBypass')} value={urgentBypass} onChange={setUrgentBypass} />
      <P muted>{pt('quiet.urgentHint')}</P>
      {/* Owner decision 2026-11-21: never an SMS in quiet hours; the urgent bypass is push only. */}
      <P muted>{t('quietSmsNote')}</P>
      {error && <Banner tone="err">{error}</Banner>}
      <Button
        label={pt('quiet.add')}
        busy={busy}
        disabled={!TIME.test(start) || !TIME.test(end)}
        onPress={() => void add()}
      />
    </Card>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  item: { gap: 6 },
});
