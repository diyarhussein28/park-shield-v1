import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choice, H3, Segmented } from '@/components/form';
import {
  CheckoutForm,
  PastDue,
  SubscriptionInfo,
  openPaymentPortal,
} from '@/components/subscription';
import { Banner, Button, Card, P, Screen, Section, Title, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { lang, t } from '@/lib/i18n';
import {
  downloadAndShare,
  errorText,
  euro,
  openInBrowser,
  type CreditNote,
  type InvoiceSummary,
  type PortalMe,
  type SubscriptionSummary,
} from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';

/**
 * „Abo & Konto“ (web: /konto/abo): subscription and checkout, upgrade, invoices and credit notes,
 * the summary e-mail, passkeys, withdrawal and cancellation, plus the app's profile and e-mail
 * language. Sign-out is on the „Mehr“ tab. Payment runs on Stripe's page inside the app.
 */
export default function Account() {
  const c = useTheme();
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [sub, setSub] = useState<SubscriptionSummary | null | undefined>(undefined);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [credits, setCredits] = useState<CreditNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, s] = await Promise.all([
        api<PortalMe>('/v1/me'),
        api<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
      ]);
      setMe(m);
      setSub(s.subscription);
      const [inv, cn] = await Promise.all([
        api<{ invoices: InvoiceSummary[] }>('/v1/billing/invoices').catch(() => ({ invoices: [] })),
        api<{ creditNotes: CreditNote[] }>('/v1/billing/credit-notes').catch(() => ({
          creditNotes: [],
        })),
      ]);
      setInvoices(inv.invoices);
      setCredits(cn.creditNotes);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const patchMe = async (body: Partial<PortalMe>, saved: string) => {
    setStatus(null);
    try {
      await api('/v1/me', { method: 'PATCH', body });
      setMe((m) => (m ? { ...m, ...body } : m));
      setStatus(saved);
    } catch (err) {
      setStatus(errorText(err));
    }
  };

  const removePasskey = async (id: string) => {
    await api(`/v1/me/passkeys/${id}`, { method: 'DELETE' }).catch(() => undefined);
    await load();
  };

  const creditNote = (cn: CreditNote) =>
    void downloadAndShare(
      `/v1/billing/credit-notes/${cn.id}/pdf`,
      `gutschrift-${cn.number}.pdf`,
      'application/pdf',
    ).catch((err) => setError(errorText(err)));

  const row = (label: string, value: string | null | undefined) => (
    <View style={s.row}>
      <Text style={{ color: c.muted, fontSize: 15 }}>{label}</Text>
      <Text style={{ color: c.fg, fontSize: 17, fontWeight: '600' }} selectable>
        {value || '–'}
      </Text>
    </View>
  );

  return (
    <Screen>
      <P muted>{pt('portal.planIntro')}</P>
      {welcome && sub && (
        <Banner tone="ok">{`${pt('account.welcomeTitle')} ${pt('account.welcomeText')}`}</Banner>
      )}
      {sub?.status === 'past_due' && <PastDue />}

      {sub === null && (
        <Section title={pt('portal.startTitle')} intro={pt('portal.startIntro')}>
          {([1, 2, 3] as const).map((i) => (
            <P key={i}>
              {i}. <Text style={{ fontWeight: '700' }}>{pt(`portal.start${i}Title`)}</Text> –{' '}
              {pt(`portal.start${i}Text`)}
            </P>
          ))}
        </Section>
      )}
      <Card>
        <Title>{pt('account.subscription')}</Title>
        {sub === undefined ? null : sub ? (
          <>
            <SubscriptionInfo sub={sub} />
            <Button
              label={pt('account.paymentMethod')}
              variant="secondary"
              onPress={() => void openPaymentPortal().then(load)}
            />
          </>
        ) : (
          <CheckoutForm
            onPaid={() => {
              setWelcome(true);
              void load();
            }}
          />
        )}
      </Card>

      {sub?.plan === 'plus' && (
        <Card>
          <Title>{pt('portal.upgradeTitle')}</Title>
          <P muted>{pt('portal.upgradeIntro')}</P>
          {(
            [
              'landing.premiumF2',
              'landing.premiumF3',
              'landing.premiumF4',
              // F5 (photos with alerts) is part of Plus too, so it is no reason to upgrade.
              'landing.premiumF6',
            ] as const
          ).map((k) => (
            <P key={k}>✓ {pt(k)}</P>
          ))}
          <P muted>{pt('portal.upgradeSoon')}</P>
        </Card>
      )}

      <Card>
        <Title>{pt('account.invoices')}</Title>
        {invoices.length === 0 ? (
          <P muted>{pt('account.noInvoices')}</P>
        ) : (
          invoices.map((i) =>
            i.pdfUrl ? (
              <Button
                key={i.id}
                variant="secondary"
                label={pt('account.invoiceLink', { number: i.number, date: new Date(i.createdAt) })}
                onPress={() => void openInBrowser(i.pdfUrl!)}
              />
            ) : (
              <P key={i.id}>{i.number}</P>
            ),
          )
        )}
        {credits.length > 0 && (
          <>
            <H3>{pt('account.creditNotes')}</H3>
            {credits.map((cn) => (
              <Button
                key={cn.id}
                variant="secondary"
                label={pt('account.creditNoteLink', {
                  number: cn.number,
                  date: new Date(cn.createdAt),
                  amount: euro(cn.amountCents, lang()),
                })}
                onPress={() => creditNote(cn)}
              />
            ))}
          </>
        )}
      </Card>

      {sub && me && (
        <Card>
          <Title>{pt('summarySettings.title')}</Title>
          <P muted>{pt('summarySettings.intro')}</P>
          <Choice
            legend={pt('summarySettings.label')}
            options={['monthly', 'weekly', 'off'] as const}
            value={me.summaryFrequency}
            onChange={(v) => void patchMe({ summaryFrequency: v }, pt('summarySettings.saved'))}
            label={(v) => pt(`summarySettings.${v}`)}
          />
        </Card>
      )}

      {me && (
        <Card>
          <Title>{t('accountProfile')}</Title>
          {row(t('email'), me.email)}
          {row(t('accountCustomerNo'), me.customerNo)}
          <Segmented
            legend={t('accountMailLang')}
            options={['de', 'en'] as const}
            value={me.preferredLang}
            onChange={(v) => void patchMe({ preferredLang: v }, pt('summarySettings.saved'))}
            label={(v) => (v === 'de' ? 'Deutsch' : 'English')}
          />
          <P muted>{t('accountMailLangHint')}</P>
        </Card>
      )}
      {status && <Banner tone="info">{status}</Banner>}

      {me && (
        <Card>
          <Title>{pt('account.passkeys')}</Title>
          <P muted>{pt('account.passkeysIntro')}</P>
          {me.passkeys.length === 0 ? (
            <P muted>{pt('account.noPasskeys')}</P>
          ) : (
            me.passkeys.map((p) => (
              <View key={p.id} style={s.passkey}>
                <P>
                  {p.label ?? 'Passkey'} ·{' '}
                  {pt('account.passkeyAddedOn', { date: new Date(p.createdAt) })}
                </P>
                <Button
                  variant="secondary"
                  label={pt('account.removePasskey', { label: p.label ?? 'Passkey' })}
                  onPress={() => void removePasskey(p.id)}
                />
              </View>
            ))
          )}
          <P muted>{t('passkeyAddOnWeb')}</P>
        </Card>
      )}

      {sub?.withdrawalOpenUntil && (
        <Card>
          <Title>{pt('withdraw.portalTitle')}</Title>
          <P>{pt('withdraw.portalText', { date: new Date(sub.withdrawalOpenUntil) })}</P>
          <Button
            variant="secondary"
            label={pt('common.footer.withdrawContract')}
            onPress={() => router.push('/widerrufen')}
          />
        </Card>
      )}

      {sub && !sub.cancelAtPeriodEnd && (
        <Card>
          <Title>{pt('account.cancelTitle')}</Title>
          <P>{pt('account.cancelText')}</P>
          <Button
            variant="secondary"
            label={pt('common.footer.cancelContract')}
            onPress={() => router.push('/kuendigen')}
          />
        </Card>
      )}

      {error && <Banner tone="err">{error}</Banner>}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { gap: 2 },
  passkey: { gap: 6 },
});
