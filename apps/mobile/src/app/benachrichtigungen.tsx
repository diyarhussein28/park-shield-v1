import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Check, Field, H3 } from '@/components/form';
import { PhoneSetup } from '@/components/phone-setup';
import { Banner, Button, Card, P, Screen, Title, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { APP_VERSION, HAS_FIREBASE } from '@/lib/config';
import { t } from '@/lib/i18n';
import {
  errorText,
  type ChannelsOverview,
  type OrderableChannel,
  type PushDevice,
  type QuietHours,
  type QuietRule,
  type Usage,
} from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { permission, requestPermission, type PushPermission } from '@/lib/push';

/**
 * „Benachrichtigungen“ (web: /konto/benachrichtigungen): mobile number for SMS, this app's push and the
 * other devices, e-mail, the order normal alerts follow, and quiet hours.
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
      <P muted>{pt('channels.intro')}</P>
      {error && <Banner tone="err">{error}</Banner>}
      {data && <PhoneSetup overview={data} usage={usage} onChange={reload} />}
      {data && <AppPushCard devices={data.app.devices} />}
      {data && <BrowserPushCard devices={data.push.devices} reload={reload} />}
      {data && (
        <Card>
          <Title>{pt('channels.emailTitle')}</Title>
          <P>{pt('channels.emailText', { email: data.email.address })}</P>
        </Card>
      )}
      {data && (
        <OrderCard
          order={data.order}
          setUp={{
            native_push: data.app.devices.length > 0,
            webpush: data.push.devices.length > 0,
            email: true,
            sms: Boolean(data.sms),
          }}
          onSaved={(order) => setData((d) => (d ? { ...d, order } : d))}
        />
      )}
      {quiet && <QuietHoursCard initial={quiet} />}
    </Screen>
  );
}

/** This app's notifications: system permission, and the phones signed in to the app. */
function AppPushCard({ devices }: { devices: ChannelsOverview['app']['devices'] }) {
  const [push, setPush] = useState<PushPermission | null>(null);
  useFocusEffect(
    useCallback(() => {
      void permission()
        .then(setPush)
        .catch(() => setPush(null));
    }, []),
  );
  const date = (iso: string) => new Date(iso);
  return (
    <Card>
      <Title>{t('notifications')}</Title>
      {!HAS_FIREBASE ? (
        <Banner tone="warn">{t('pushNoFirebase')}</Banner>
      ) : push === 'granted' ? (
        <P>{t('notificationsOn')}</P>
      ) : (
        <>
          <Banner tone="warn">{t('pushDeniedBanner')}</Banner>
          {push === 'undetermined' ? (
            <Button label={t('pushAllow')} onPress={() => void requestPermission().then(setPush)} />
          ) : (
            <Button
              label={t('pushOpenSettings')}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          )}
        </>
      )}
      <H3>{t('appDevices')}</H3>
      {devices.length === 0 ? (
        <P muted>{t('appDevicesNone')}</P>
      ) : (
        devices.map((d) => (
          <P key={d.id}>
            {t('appDevice', {
              platform: d.platform === 'ios' ? 'iPhone' : 'Android',
              version: d.appVersion ?? APP_VERSION,
              date: date(d.lastSeenAt).toLocaleDateString(),
            })}
          </P>
        ))
      )}
    </Card>
  );
}

/** Browser push on other devices (set up on the website); removable here. */
function BrowserPushCard({
  devices,
  reload,
}: {
  devices: PushDevice[];
  reload: () => Promise<void>;
}) {
  const deviceText = (d: PushDevice) =>
    d.label ??
    pt('channels.pushDevice', { platform: d.platform ?? 'desktop', date: new Date(d.createdAt) });
  return (
    <Card>
      <Title>{pt('channels.pushTitle')}</Title>
      <P muted>{t('browserPushHint')}</P>
      <H3>{pt('channels.pushDevices')}</H3>
      {devices.length === 0 ? (
        <P muted>{pt('channels.pushNoDevices')}</P>
      ) : (
        devices.map((d) => (
          <View key={d.id} style={s.item}>
            <P>{deviceText(d)}</P>
            <Button
              variant="secondary"
              label={pt('channels.pushRemoveLabel', { device: deviceText(d) })}
              onPress={() =>
                void api(`/v1/push-subscriptions/${d.id}`, { method: 'DELETE' }).then(reload)
              }
            />
          </View>
        ))
      )}
    </Card>
  );
}

/** US-22 / OW-05: the order normal alerts follow, with up/down buttons. */
function OrderCard({
  order,
  setUp,
  onSaved,
}: {
  order: OrderableChannel[];
  setUp: Record<OrderableChannel, boolean>;
  onSaved: (order: OrderableChannel[]) => void;
}) {
  const c = useTheme();
  const [status, setStatus] = useState<string | null>(null);
  const name = (channel: OrderableChannel) => pt('channels.channelName', { channel });

  const move = async (index: number, by: -1 | 1) => {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    setStatus(null);
    try {
      onSaved(
        (
          await api<{ order: OrderableChannel[] }>('/v1/channels/order', {
            method: 'PUT',
            body: { order: next },
          })
        ).order,
      );
      setStatus(pt('channels.orderSaved'));
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  return (
    <Card>
      <Title>{pt('channels.orderTitle')}</Title>
      <P>{pt('channels.orderIntro')}</P>
      {order.map((ch, i) => (
        <View key={ch} style={[s.orderRow, { borderColor: c.border }]}>
          <P style={{ flex: 1, fontWeight: '700' }}>
            {i + 1}. {name(ch)}
            {!setUp[ch] ? ` (${pt('channels.orderNotSetUp')})` : ''}
          </P>
          <View style={s.arrows}>
            <Button
              label="↑"
              variant="secondary"
              disabled={i === 0}
              accessibilityHint={pt('channels.orderUp', { channel: name(ch) })}
              onPress={() => void move(i, -1)}
            />
            <Button
              label="↓"
              variant="secondary"
              disabled={i === order.length - 1}
              accessibilityHint={pt('channels.orderDown', { channel: name(ch) })}
              onPress={() => void move(i, 1)}
            />
          </View>
        </View>
      ))}
      {status && <P muted>{status}</P>}
      <P muted>{pt('channels.orderNote')}</P>
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
      <Check label={pt('quiet.urgentBypass')} checked={urgentBypass} onChange={setUrgentBypass} />
      <P muted>{pt('quiet.urgentHint')}</P>
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
  item: { gap: 6 },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  arrows: { flexDirection: 'row', gap: 6, width: 120 },
});
