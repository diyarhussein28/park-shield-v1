import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { ListRow } from '@/components/form';
import { Button, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { APP_VERSION } from '@/lib/config';
import { t } from '@/lib/i18n';
import type { ChannelsOverview } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { type as typeScale, useTheme } from '@/theme/tokens';

/**
 * „Mehr“: every portal screen that is not one of the three main tabs, each with the website's
 * one-line summary (web: the quick links on /konto), then sign-out and the app version.
 */
export default function More() {
  const c = useTheme();
  const router = useRouter();
  const { signOut } = useAuth();
  const [channels, setChannels] = useState<ChannelsOverview | null>(null);
  const [contacts, setContacts] = useState(0);

  useFocusEffect(
    useCallback(() => {
      void api<ChannelsOverview>('/v1/channels')
        .then(setChannels)
        .catch(() => setChannels(null));
      void api<{ contacts?: unknown[] }>('/v1/emergency-contacts')
        .then((r) => setContacts(r.contacts?.length ?? 0))
        .catch(() => setContacts(0));
    }, []),
  );

  return (
    <Screen>
      <ListRow
        icon="bell"
        title={pt('portal.notifications')}
        text={
          channels
            ? pt('channels.summaryPhone', {
                push: channels.push.devices.length,
                phone: channels.sms ? 'yes' : 'no',
              })
            : undefined
        }
        onPress={() => router.push('/benachrichtigungen')}
      />
      <ListRow
        icon="users"
        title={pt('portal.contacts')}
        text={pt('contacts.summary', { count: contacts })}
        onPress={() => router.push('/einstellungen')}
      />
      <ListRow
        icon="clock"
        title={pt('portal.history')}
        text={pt('portal.historyText')}
        onPress={() => router.push('/verlauf')}
      />
      <ListRow
        icon="alert"
        title={pt('deliveryHelp.link')}
        text={pt('portal.deliveryText')}
        onPress={() => router.push('/zustellung')}
      />
      <ListRow
        icon="database"
        title={pt('portal.data')}
        text={pt('portal.dataText')}
        onPress={() => router.push('/daten')}
      />
      <ListRow icon="help" title={t('help')} onPress={() => router.push('/hilfe')} />
      <Button
        label={t('signOut')}
        variant="danger"
        onPress={() => void signOut().then(() => router.replace('/anmelden'))}
      />
      <Text style={[typeScale.caption, { color: c.muted, textAlign: 'center' }]}>
        {t('appVersion', { version: APP_VERSION })}
      </Text>
    </Screen>
  );
}
