import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choice, H3, Segmented } from '@/components/form';
import {
  ContractCard,
  PastDue,
  PlanFeatures,
  SubscriptionInfo,
  openPaymentPortal,
  openStoreManagement,
  endedText,
  stickerValueText,
  storeName,
} from '@/components/subscription';
import { Banner, Button, Card, P, Screen, Title, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { isStoreProvider } from '@/lib/billing';
import { lang, t } from '@/lib/i18n';
import { LANG_NAMES, switchLanguage } from '@/lib/language';
import {
  downloadAndShare,
  errorText,
  euro,
  openInBrowser,
  type CreditNote,
  type EndedSubscription,
  type InvoiceSummary,
  type OrderSummary,
  type PortalMe,
  type SubscriptionSummary,
} from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';

/**
 * „Abo und Rechnungen“ (web: /konto/abo), pushed from the Konto tab: „ParkShield · Aktiv“ with what the
 * one plan includes, invoices and credit notes, the summary e-mail, customer number and e-mail
 * language, passkeys, and one „Vertrag“ card (withdrawal while the period runs, then cancellation).
 * Without a plan it leads to the plan (/tarif), where Stripe's page opens in the app.
 */
export default function Subscription() {
  const c = useTheme();
  const router = useRouter();
  const [me, setMe] = useState<PortalMe | null>(null);
  const [sub, setSub] = useState<SubscriptionSummary | null | undefined>(undefined);
  const [ended, setEnded] = useState<EndedSubscription | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [credits, setCredits] = useState<CreditNote[]>([]);
  const [purchases, setPurchases] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, s] = await Promise.all([
        api<PortalMe>('/v1/me'),
        api<{ subscription: SubscriptionSummary | null; ended?: EndedSubscription | null }>(
          '/v1/billing/subscription',
        ),
      ]);
      setMe(m);
      setSub(s.subscription);
      setEnded(s.ended ?? null);
      const [inv, cn, orders] = await Promise.all([
        api<{ invoices: InvoiceSummary[] }>('/v1/billing/invoices').catch(() => ({ invoices: [] })),
        api<{ creditNotes: CreditNote[] }>('/v1/billing/credit-notes').catch(() => ({
          creditNotes: [],
        })),
        api<{ orders: OrderSummary[] }>('/v1/orders').catch(() => ({ orders: [] })),
      ]);
      setInvoices(inv.invoices);
      setCredits(cn.creditNotes);
      // The 3 € purchases (printed sticker, new code + sticker), paid with Stripe (2026-11-24).
      setPurchases(
        orders.orders.filter(
          (o) => o.paidPrint && (o.totalCents ?? 0) > 0 && o.status !== 'pending_payment',
        ),
      );
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
      {sub?.status === 'past_due' && <PastDue sub={sub} />}

      <Card>
        <Title>{pt('account.subscription')}</Title>
        {sub === undefined ? null : sub ? (
          <>
            <SubscriptionInfo sub={sub} />
            <Text style={{ color: c.fg, fontSize: 15, fontWeight: '700' }}>
              {t('planIncludes')}
            </Text>
            <PlanFeatures />
            <P muted>{stickerValueText(sub.stickerValueCents)}</P>
            {isStoreProvider(sub.provider) ? (
              // A6: Apple/Google manage payment and renewal of store subscriptions.
              <Button
                label={t('storeManageButton', { store: storeName(sub.provider) })}
                variant="secondary"
                onPress={() => openStoreManagement(sub)}
              />
            ) : (
              <Button
                label={pt('account.paymentMethod')}
                variant="secondary"
                onPress={() => void openPaymentPortal().then(load)}
              />
            )}
          </>
        ) : (
          <>
            {/* 2026-11-25: say why an earlier plan ended instead of „noch kein Abo“. */}
            {ended ? (
              <View testID="sub-ended">
                <P>{endedText(ended)}</P>
              </View>
            ) : (
              <P muted>{pt('account.noSubscription')}</P>
            )}
            <Button label={t('homeNoPlanCta')} onPress={() => router.push('/tarif')} />
          </>
        )}
      </Card>

      <Card>
        <Title>{pt('account.invoices')}</Title>
        {isStoreProvider(sub?.provider) && (
          <P muted>{t('storeReceipts', { store: storeName(sub?.provider) })}</P>
        )}
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

      {purchases.length > 0 && (
        <Card>
          <Title>{t('purchasesTitle')}</Title>
          <View testID="purchases">
            {purchases.map((o) => (
              <P key={o.id}>
                {t('purchaseLine', {
                  what: o.newCode ? t('purchaseNewCode') : t('purchasePrint'),
                  date: new Date(o.createdAt).toLocaleDateString(
                    lang() === 'en' ? 'en-GB' : 'de-DE',
                  ),
                  price: euro(o.totalCents ?? 0, lang()),
                })}
                {o.status === 'refunded' ? ` · ${t('purchaseRefunded')}` : ''}
              </P>
            ))}
          </View>
        </Card>
      )}

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
            value={lang()}
            onChange={(v) => void switchLanguage(v)}
            label={(v) => LANG_NAMES[v]}
          />
          <P muted>{t('accountMailLangHint')}</P>
        </Card>
      )}
      {status && <Banner tone="info">{status}</Banner>}

      {/* Passkeys can no longer be added (the website's passkey UI was removed on 2026-11-24 and the app
          has no WebAuthn yet): the card only lists existing ones so they can be removed. */}
      {me && me.passkeys.length > 0 && (
        <Card>
          <Title>{pt('account.passkeys')}</Title>
          <P muted>{pt('account.passkeysIntro')}</P>
          {me.passkeys.map((p) => (
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
          ))}
        </Card>
      )}

      {sub && (
        <ContractCard
          sub={sub}
          onWithdraw={() => router.push('/widerrufen')}
          onCancel={() => router.push('/kuendigen')}
        />
      )}

      {error && <Banner tone="err">{error}</Banner>}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { gap: 2 },
  passkey: { gap: 6 },
});
