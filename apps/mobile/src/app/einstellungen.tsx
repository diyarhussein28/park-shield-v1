import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Banner, Button, Card, P, Screen, Title, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { t, type Key } from '@/lib/i18n';
import type { ContactList, EscalationSettings } from '@/lib/types';

interface Sub {
  subscription: { plan: 'plus' | 'premium'; status: string } | null;
}
/**
 * „Notfallkontakte“ (web: /konto/notfallkontakte): escalation to trusted contacts (PREMIUM: on/off globally and per vehicle,
 * delay 3–30 min; PLUS sees it locked) and the contacts in escalation order. Plan, profile and
 * sign-out are on the account screen, vehicles and QR codes on their own screen.
 */
export default function Settings() {
  const c = useTheme();
  const [sub, setSub] = useState<Sub['subscription']>(null);
  const [esc, setEsc] = useState<EscalationSettings | null>(null);
  const [contacts, setContacts] = useState<ContactList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', ownerName: '' });
  const [inviting, setInviting] = useState(false);

  const premium = sub?.plan === 'premium';

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api<Sub>('/v1/billing/subscription');
      setSub(s.subscription);
      if (s.subscription?.plan === 'premium') {
        const [e, l] = await Promise.all([
          api<EscalationSettings>('/v1/app/escalation'),
          api<ContactList>('/v1/app/emergency-contacts'),
        ]);
        setEsc(e);
        setContacts(l);
        setForm((f) => ({ ...f, ownerName: f.ownerName || l.ownerName || '' }));
      }
    } catch {
      setError(t('error'));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const saveEsc = async (body: Record<string, unknown>) => {
    try {
      setEsc(await api<EscalationSettings>('/v1/app/escalation', { method: 'PUT', body }));
    } catch {
      setError(t('error'));
    }
  };

  const invite = async () => {
    setInviting(true);
    setError(null);
    try {
      setContacts(
        await api<ContactList>('/v1/app/emergency-contacts', {
          body: {
            name: form.name,
            phone: form.phone,
            ...(form.email ? { email: form.email } : {}),
            ownerName: form.ownerName,
          },
        }),
      );
      setForm((f) => ({ ...f, name: '', phone: '', email: '' }));
    } catch (e) {
      setError(
        e instanceof ApiError && e.body?.error ? `${t('error')} (${e.body.error})` : t('error'),
      );
    } finally {
      setInviting(false);
    }
  };

  const moveUp = async (i: number) => {
    if (!contacts || i === 0) return;
    const ids = contacts.contacts.map((x) => x.id);
    [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
    setContacts(
      await api<ContactList>('/v1/app/emergency-contacts/order', { method: 'PUT', body: { ids } }),
    );
  };
  const remove = async (id: string) => {
    await api(`/v1/app/emergency-contacts/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
  };

  const input = [s.input, { color: c.fg, borderColor: c.border }];
  return (
    <Screen>
      <Card>
        <Title>{t('escalationTitle')}</Title>
        {!premium ? (
          <Banner tone="info">{t('escalationLocked')}</Banner>
        ) : (
          esc && (
            <>
              <P muted>{t('escalationText')}</P>
              {esc.suggestEnable && <Banner tone="info">{t('escalationSuggest')}</Banner>}
              <View style={s.row}>
                <Text style={[s.rowText, { color: c.fg }]}>{t('escalationTitle')}</Text>
                <Switch
                  accessibilityLabel={t('escalationTitle')}
                  value={esc.enabled}
                  onValueChange={(v) => void saveEsc({ enabled: v })}
                />
              </View>
              <View style={s.row}>
                <Text style={[s.rowText, { color: c.fg }]}>
                  {t('escalationDelay', { minutes: esc.delayMinutes })}
                </Text>
                <View style={s.stepper}>
                  <Button
                    label="−"
                    variant="secondary"
                    disabled={esc.delayMinutes <= 3}
                    onPress={() => void saveEsc({ delayMinutes: esc.delayMinutes - 1 })}
                  />
                  <Button
                    label="+"
                    variant="secondary"
                    disabled={esc.delayMinutes >= 30}
                    onPress={() => void saveEsc({ delayMinutes: esc.delayMinutes + 1 })}
                  />
                </View>
              </View>
              {esc.vehicles.map((v) => (
                <View key={v.id} style={s.row}>
                  <Text style={[s.rowText, { color: c.fg }]}>
                    {t('escalationVehicle')}: „{v.nickname}“
                  </Text>
                  <Switch
                    accessibilityLabel={`${t('escalationVehicle')} ${v.nickname}`}
                    value={v.enabled ?? esc.enabled}
                    onValueChange={(on) => void saveEsc({ vehicles: [{ id: v.id, enabled: on }] })}
                  />
                </View>
              ))}
            </>
          )
        )}
      </Card>

      {premium && contacts && (
        <Card>
          <Title>{t('contacts')}</Title>
          {contacts.contacts.length === 0 && <P muted>{t('contactsEmpty')}</P>}
          {contacts.contacts.map((x, i) => (
            <View key={x.id} style={[s.contact, { borderColor: c.border }]}>
              <P>
                {x.position}. {x.name} · {x.phone ?? x.email} ·{' '}
                {t(`contactStatus_${x.status}` as Key)}
              </P>
              <View style={s.rowButtons}>
                {i > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void moveUp(i)}
                    style={s.linkBtn}
                  >
                    <Text style={{ color: c.primary, fontWeight: '700' }}>{t('contactUp')}</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void remove(x.id)}
                  style={s.linkBtn}
                >
                  <Text style={{ color: c.urgent, fontWeight: '700' }}>{t('contactRemove')}</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {contacts.contacts.length < contacts.limit && (
            <>
              <Text style={[s.rowText, { color: c.fg, fontWeight: '700' }]}>{t('contactAdd')}</Text>
              <TextInput
                accessibilityLabel={t('contactName')}
                placeholder={t('contactName')}
                placeholderTextColor={c.muted}
                value={form.name}
                onChangeText={(name) => setForm((f) => ({ ...f, name }))}
                style={input}
              />
              <TextInput
                accessibilityLabel={t('contactPhone')}
                placeholder={t('contactPhone')}
                placeholderTextColor={c.muted}
                keyboardType="phone-pad"
                value={form.phone}
                onChangeText={(phone) => setForm((f) => ({ ...f, phone }))}
                style={input}
              />
              <TextInput
                accessibilityLabel={t('contactEmail')}
                placeholder={t('contactEmail')}
                placeholderTextColor={c.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={form.email}
                onChangeText={(email) => setForm((f) => ({ ...f, email }))}
                style={input}
              />
              <TextInput
                accessibilityLabel={t('ownerName')}
                placeholder={t('ownerName')}
                placeholderTextColor={c.muted}
                value={form.ownerName}
                onChangeText={(ownerName) => setForm((f) => ({ ...f, ownerName }))}
                style={input}
              />
              <Button
                label={t('contactInvite')}
                onPress={() => void invite()}
                busy={inviting}
                disabled={!form.name.trim() || !form.phone.trim() || !form.ownerName.trim()}
              />
            </>
          )}
        </Card>
      )}

      {error && <Banner tone="err">{error}</Banner>}
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 2, borderRadius: 14, paddingHorizontal: 12, fontSize: 17 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 48,
  },
  rowText: { fontSize: 17, flexShrink: 1 },
  stepper: { flexDirection: 'row', gap: 6, width: 130 },
  contact: { borderTopWidth: 1, paddingTop: 8 },
  rowButtons: { flexDirection: 'row', gap: 16 },
  linkBtn: { minHeight: 44, justifyContent: 'center' },
});
