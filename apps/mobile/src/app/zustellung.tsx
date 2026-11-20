import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Banner, Button, Card, P, Screen, Title, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { lang } from '@/lib/i18n';
import { errorText, type DeliveryHelp } from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';

/** Plain-language reason for a delivery outcome (SP-05). Unknown provider codes get a generic text. */
function reasonText(status: string, reason: string | null): string | null {
  if (!reason) return null;
  const known = [
    'quiet_hours',
    'sensitive_spot',
    'kill_switch',
    'fair_use',
    'http_404',
    'http_410',
  ];
  if (known.includes(reason)) return pt(`deliveryHelp.r_${reason}` as MessageKey);
  if (reason.startsWith('http_')) return pt('deliveryHelp.r_push_error');
  return status === 'failed' ? pt('deliveryHelp.r_error') : null;
}

/** SP-05 „Warnung nicht bekommen?“ (web: /konto/zustellung): set-up checks and the latest attempts. */
export default function DeliveryHelpScreen() {
  const c = useTheme();
  const router = useRouter();
  const [data, setData] = useState<DeliveryHelp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void api<DeliveryHelp>('/v1/me/deliveries')
        .then(setData)
        .catch((err) => setError(errorText(err)));
    }, []),
  );

  const Check = ({
    ok,
    children,
    fix,
  }: {
    ok: boolean;
    children: ReactNode;
    fix?: { href: Href; label: string };
  }) => (
    <View style={{ gap: 6 }}>
      <P>
        {ok ? '✓ ' : '! '}
        {children}
      </P>
      {!ok && fix && (
        <Button label={fix.label} variant="secondary" onPress={() => router.push(fix.href)} />
      )}
    </View>
  );
  const channel = (ch: string) => pt('channels.channelName', { channel: ch });

  if (!data) return <Screen>{error ? <Banner tone="err">{error}</Banner> : <P muted>…</P>}</Screen>;
  const s = data.setup;
  const notifications = {
    href: '/benachrichtigungen' as Href,
    label: pt('deliveryHelp.goNotifications'),
  };

  return (
    <Screen>
      <P muted>{pt('deliveryHelp.intro')}</P>
      <Card>
        <Title>{pt('deliveryHelp.checksTitle')}</Title>
        <Check ok={s.pushDevices > 0 && s.pushFailing === 0} fix={notifications}>
          {s.pushDevices === 0
            ? pt('deliveryHelp.noPush')
            : s.pushFailing > 0
              ? pt('deliveryHelp.pushFailing', { count: s.pushFailing })
              : pt('deliveryHelp.okPush', { count: s.pushDevices })}
        </Check>
        <Check ok={s.appDevices > 0 && s.appFailing === 0}>
          {s.appDevices > 0
            ? pt('deliveryHelp.okApp', { count: s.appDevices })
            : pt('deliveryHelp.noApp')}
        </Check>
        <Check ok={s.sms}>
          {s.sms ? pt('deliveryHelp.okSms') : pt('deliveryHelp.noSms')}
          {s.sms && s.smsUsage.limit > 0 ? ` ${pt('deliveryHelp.smsUsage', s.smsUsage)}` : ''}
        </Check>
        {s.quietHours > 0 && (
          <Check ok={false} fix={notifications}>
            {pt('deliveryHelp.quietHours', { count: s.quietHours })}
          </Check>
        )}
        {!s.decalTested && (
          <Check ok={false} fix={{ href: '/fahrzeuge', label: pt('deliveryHelp.goTest') }}>
            {pt('deliveryHelp.notTested')}
          </Check>
        )}
        {s.switchedOff.length > 0 && (
          <Check ok={false}>
            {pt('deliveryHelp.switchedOff', { channels: s.switchedOff.map(channel).join(', ') })}
          </Check>
        )}
      </Card>
      <Card>
        <Title>{pt('deliveryHelp.attemptsTitle')}</Title>
        {data.attempts.length === 0 ? (
          <P muted>{pt('deliveryHelp.none')}</P>
        ) : (
          data.attempts.map((d, i) => {
            const why = reasonText(d.status, d.reason);
            return (
              <View
                key={`${d.alertId}-${i}`}
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 10 }}
              >
                <P style={{ fontWeight: '700' }}>
                  {pt('deliveryHelp.attempt', {
                    type: lang() === 'en' ? d.type.en : d.type.de,
                    nickname: d.nickname,
                    channel: channel(d.channel),
                    at: new Date(d.at),
                  })}
                </P>
                <P>{pt(`deliveryHelp.s_${d.status}` as MessageKey)}</P>
                {why && <P muted>{`${pt('deliveryHelp.fix')}: ${why}`}</P>}
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}
