import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Field } from '@/components/form';
import { Banner, Button, Card, P, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { lang } from '@/lib/i18n';
import { errorText, type PortalMe, type SubscriptionSummary } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';

/**
 * § 356a BGB online withdrawal (web: /widerrufen, pre-filled for the signed-in owner): exactly three
 * fields, no reason → „Widerruf bestätigen“ → receipt with date and time, and the receipt e-mail.
 */
export default function Withdraw() {
  const [name, setName] = useState('');
  const [contractRef, setContractRef] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState<Date | null>(null);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([
        api<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
        api<PortalMe>('/v1/me'),
      ])
        .then(([s, m]) => {
          setContractRef((v) => v || s.subscription?.contractNo || '');
          setEmail((v) => v || m.email);
        })
        .catch(() => undefined);
    }, []),
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ receivedAt: string }>('/v1/portal/withdrawals', {
        body: {
          name: name.trim(),
          contractRef: contractRef.trim(),
          email: email.trim(),
          locale: lang(),
        },
      });
      setReceivedAt(new Date(r.receivedAt));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (receivedAt) {
    return (
      <Screen>
        <Card>
          <Title>{pt('withdraw.receivedTitle')}</Title>
          <Banner tone="ok">{pt('withdraw.receivedText', { date: receivedAt })}</Banner>
          <P muted>{pt('cancel.receivedSave')}</P>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Title>{pt('withdraw.title')}</Title>
        <P>{pt('withdraw.intro')}</P>
        <Field
          label={pt('withdraw.nameLabel')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          maxLength={120}
        />
        <Field
          label={pt('withdraw.contractLabel')}
          hint={pt('withdraw.contractHint')}
          value={contractRef}
          onChangeText={setContractRef}
          autoCapitalize="characters"
          maxLength={254}
        />
        <Field
          label={pt('withdraw.emailLabel')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        {error && <Banner tone="err">{error}</Banner>}
        <Button
          label={pt('withdraw.submit')}
          variant="danger"
          busy={busy}
          disabled={name.trim().length < 2 || contractRef.trim().length < 4 || !email.includes('@')}
          onPress={() => void submit()}
        />
      </Card>
    </Screen>
  );
}
