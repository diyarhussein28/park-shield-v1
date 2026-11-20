import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Group, Row, SwitchRow } from '@/components/list';
import { PLAN_LABEL } from '@/components/subscription';
import { Banner } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { biometricInfo, biometricName, type BiometricKind } from '@/lib/biometrics';
import { APP_VERSION } from '@/lib/config';
import { t } from '@/lib/i18n';
import { useLock } from '@/lib/lock';
import type { ChannelsOverview, PortalMe, SubscriptionSummary } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { clearAccountFlags } from '@/lib/prefs';
import { useProfile } from '@/lib/profile';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';

/**
 * Konto (§5.1, P12): who is signed in, then one grouped iOS-style list with everything that used to be
 * under „Mehr“ (notifications, trusted contacts, „Warnung nicht erhalten?“, data, help), the app lock
 * switch, and „Abmelden“ as a plain red row at the very end.
 */
export default function Account() {
  const c = useTheme();
  const router = useRouter();
  const { signOut } = useAuth();
  const { data: profile } = useProfile();
  const lock = useLock();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [sub, setSub] = useState<SubscriptionSummary | null | undefined>(undefined);
  const [channels, setChannels] = useState<ChannelsOverview | null>(null);
  const [contacts, setContacts] = useState(0);
  const [kind, setKind] = useState<BiometricKind>('deviceCode');
  const [lockError, setLockError] = useState(false);

  useEffect(() => {
    void biometricInfo().then((i) => setKind(i.kind));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void api<PortalMe>('/v1/me')
        .then(setMe)
        .catch(() => undefined);
      void api<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription')
        .then((r) => setSub(r.subscription))
        .catch(() => undefined);
      void api<ChannelsOverview>('/v1/channels')
        .then(setChannels)
        .catch(() => setChannels(null));
      void api<{ contacts?: unknown[] }>('/v1/emergency-contacts')
        .then((r) => setContacts(r.contacts?.length ?? 0))
        .catch(() => setContacts(0));
    }, []),
  );

  const p = profile?.profile;
  const name = p ? `${p.firstName} ${p.lastName}` : (me?.email ?? '');
  const initials = p ? `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase() : '·';
  const method = biometricName(kind);
  const planDetail = sub
    ? `${PLAN_LABEL[sub.plan]} · ${sub.status === 'active' ? pt('account.statusActive') : pt('account.statusPastDue')}`
    : sub === null
      ? t('planNone')
      : undefined;

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: c.bg }]} edges={['left', 'right']}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.body}>
        <View
          style={s.who}
          accessible
          accessibilityLabel={[name, me?.email, me?.customerNo].filter(Boolean).join(', ')}
        >
          <View style={[s.avatar, { backgroundColor: c.accent }]}>
            <Text style={[typeScale.heading, { color: c.accentFg }]}>{initials}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[typeScale.heading, { color: c.fg }]} numberOfLines={2}>
              {name}
            </Text>
            {p && me && (
              <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>
                {me.email}
              </Text>
            )}
            {me?.customerNo && (
              <Text style={[typeScale.caption, { color: c.muted }]}>
                {t('accountCustomerNo')} {me.customerNo}
              </Text>
            )}
          </View>
        </View>

        <Group title={t('groupPlan')}>
          <Row
            icon="card"
            iconTone="accent"
            title={t('planRow')}
            detail={planDetail}
            onPress={() => router.push('/abo')}
            testID="row-plan"
          />
        </Group>

        <Group title={t('groupSettings')}>
          <Row
            icon="bell"
            title={pt('portal.notifications')}
            subtitle={
              channels
                ? pt('channels.summaryPhone', {
                    push: channels.push.devices.length,
                    phone: channels.sms ? 'yes' : 'no',
                  })
                : undefined
            }
            onPress={() => router.push('/benachrichtigungen')}
            testID="row-notifications"
          />
          <Row
            icon="users"
            title={pt('portal.contacts')}
            subtitle={pt('contacts.summary', { count: contacts })}
            onPress={() => router.push('/einstellungen')}
            testID="row-contacts"
          />
          <Row
            icon="user"
            title={pt('profile.title')}
            subtitle={p ? `${p.street}, ${p.postalCode} ${p.city}` : undefined}
            onPress={() => router.push({ pathname: '/profil', params: { flow: 'edit' } })}
            testID="row-profile"
          />
        </Group>

        <Group
          title={t('groupSecurity')}
          footer={t('lockSettingHint', {
            minutes: Math.max(1, Math.round(lock.lockAfterSeconds / 60)),
          })}
        >
          <SwitchRow
            icon={kind === 'fingerprint' || kind === 'touchId' ? 'fingerprint' : 'faceId'}
            title={t('lockSetting', { method })}
            value={Boolean(lock.enabled)}
            onChange={(on) => {
              setLockError(false);
              void lock.setEnabled(on).then((ok) => setLockError(!ok));
            }}
            testID="lock-switch"
          />
        </Group>
        {lockError && <Banner tone="warn">{t('lockFailed')}</Banner>}

        <Group title={t('groupHelp')}>
          <Row
            icon="alert"
            title={pt('deliveryHelp.link')}
            onPress={() => router.push('/zustellung')}
            testID="row-delivery"
          />
          <Row
            icon="database"
            title={pt('portal.data')}
            onPress={() => router.push('/daten')}
            testID="row-data"
          />
          <Row
            icon="help"
            title={t('help')}
            onPress={() => router.push('/hilfe')}
            testID="row-help"
          />
        </Group>

        <Group>
          <Row
            destructive
            title={t('signOut')}
            onPress={() =>
              void signOut()
                .then(clearAccountFlags)
                .then(() => router.replace('/anmelden'))
            }
            testID="sign-out"
          />
        </Group>
        <Text style={[typeScale.caption, { color: c.muted, textAlign: 'center' }]}>
          {t('appVersion', { version: APP_VERSION })}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: space.lg, gap: space.xl, paddingBottom: space.xxxl },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
