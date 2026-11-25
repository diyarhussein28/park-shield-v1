import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Choice, Field } from '@/components/form';
import { ReceiptActions } from '@/components/receipt';
import { StoreManageCard } from '@/components/subscription';
import { isStoreProvider } from '@/lib/billing';
import { Banner, Button, Card, P, Screen, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { errorText, type SubscriptionSummary } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';

/**
 * Store subscribers (App Store / Google Play) see the store's subscription management instead.
 *
 * § 312k BGB „Verträge hier kündigen“ for the signed-in owner (web: /kuendigen, pre-filled): kind,
 * optional reason, effective date, optional confirmation address → „Jetzt kündigen“ → receipt with
 * date and time, and the confirmation e-mail. No extra step before it takes effect.
 */
export default function Cancel() {
  const [contract, setContract] = useState<string | null>(null);
  const [sub, setSub] = useState<SubscriptionSummary | null>(null);
  const [type, setType] = useState<'ordinary' | 'extraordinary'>('ordinary');
  const [reason, setReason] = useState('');
  const [effective, setEffective] = useState<'next' | 'date'>('next');
  const [date, setDate] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receivedAt: Date; endsAt: Date | null } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void api<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription')
        .then((r) => {
          setContract(r.subscription?.contractNo ?? null);
          setSub(r.subscription);
        })
        .catch(() => setContract(null));
    }, []),
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ receivedAt: string; endsAt: string | null }>(
        '/v1/portal/cancellations',
        {
          body: {
            type,
            ...(type === 'extraordinary' && reason.trim() ? { reason: reason.trim() } : {}),
            effective,
            ...(effective === 'date' && date ? { date } : {}),
            ...(confirmationEmail.trim() ? { confirmationEmail: confirmationEmail.trim() } : {}),
          },
        },
      );
      setDone({ receivedAt: new Date(r.receivedAt), endsAt: r.endsAt ? new Date(r.endsAt) : null });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <Card>
          <Title>{pt('cancel.receivedTitle')}</Title>
          <Banner tone="ok">{pt('cancel.receivedText', { date: done.receivedAt })}</Banner>
          {done.endsAt && <P>{pt('cancel.endsText', { date: done.endsAt })}</P>}
          <P muted>{pt('cancel.receivedSave')}</P>
          <ReceiptActions
            receipt={{
              title: pt('cancel.receivedTitle'),
              lines: [
                pt('cancel.receivedText', { date: done.receivedAt }),
                ...(done.endsAt ? [pt('cancel.endsText', { date: done.endsAt })] : []),
              ],
            }}
          />
        </Card>
      </Screen>
    );
  }

  // A6: a store subscription is cancelled at Apple / Google (our backend cannot cancel it there).
  if (sub && isStoreProvider(sub.provider)) {
    return (
      <Screen>
        <Title>{pt('cancel.title')}</Title>
        <StoreManageCard sub={sub} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Title>{pt('cancel.title')}</Title>
        <P>{pt('cancel.intro')}</P>
        {contract && (
          <Banner tone="info">{pt('cancel.signedInHint', { contractNo: contract })}</Banner>
        )}
        <Choice
          legend={pt('cancel.kindLabel')}
          options={['ordinary', 'extraordinary'] as const}
          value={type}
          onChange={setType}
          label={(v) => pt(v === 'ordinary' ? 'cancel.ordinary' : 'cancel.extraordinary')}
        />
        {type === 'extraordinary' && (
          <Field
            label={pt('cancel.reasonLabel')}
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={1000}
          />
        )}
        <Choice
          legend={pt('cancel.dateLabel')}
          options={['next', 'date'] as const}
          value={effective}
          onChange={setEffective}
          label={(v) => pt(v === 'next' ? 'cancel.dateNext' : 'cancel.dateOn')}
        />
        {effective === 'date' && (
          <Field
            label={pt('cancel.dateValue')}
            hint={`${pt('cancel.dateHint')} (JJJJ-MM-TT)`}
            value={date}
            onChangeText={setDate}
            placeholder="2027-12-31"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        )}
        <Field
          label={pt('cancel.confirmLabel')}
          hint={pt('cancel.confirmHint')}
          optional={pt('common.optional')}
          value={confirmationEmail}
          onChangeText={setConfirmationEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        {error && <Banner tone="err">{error}</Banner>}
        <Button
          label={pt('cancel.submit')}
          variant="danger"
          busy={busy}
          disabled={effective === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(date)}
          onPress={() => void submit()}
        />
      </Card>
    </Screen>
  );
}
