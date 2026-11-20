import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { lang } from '@/lib/i18n';
import { errorText, openInBrowser, payInApp, type SubscriptionSummary } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { Badge, Check, Choice, Field, H3 } from './form';
import { Banner, Button, P, useTheme } from './ui';

export const PLAN_LABEL = { plus: 'Plus', premium: 'Premium' } as const;

/** Plan name, status, contract number and the renewal or end date (web: SubscriptionInfo). */
export function SubscriptionInfo({ sub }: { sub: SubscriptionSummary }) {
  const c = useTheme();
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  return (
    <View style={s.info}>
      <View style={s.line}>
        <Text style={{ color: c.fg, fontSize: 19, fontWeight: '700' }}>
          {pt('account.planName', { plan: PLAN_LABEL[sub.plan] })}
        </Text>
        <Badge tone={sub.status === 'active' ? 'ok' : 'warn'}>
          {sub.status === 'active' ? pt('account.statusActive') : pt('account.statusPastDue')}
        </Badge>
      </View>
      {sub.contractNo && <P>{pt('account.contractNo', { contractNo: sub.contractNo })}</P>}
      {end && (
        <P muted>
          {sub.cancelAtPeriodEnd
            ? pt('account.endsOn', { date: end })
            : pt('account.renewsOn', { date: end })}
        </P>
      )}
    </View>
  );
}

/** Stripe's page for the payment method, inside the app (back through /app/zurueck). */
export async function openPaymentPortal() {
  await payInApp((appReturn) =>
    api<{ url: string }>('/v1/billing/portal', { body: { appReturn } }),
  );
}

export function PastDue() {
  return (
    <Banner tone="warn">
      <P>{pt('account.pastDueNotice')}</P>
      <Button
        label={pt('account.paymentMethod')}
        variant="secondary"
        onPress={() => void openPaymentPortal()}
      />
    </Banner>
  );
}

interface CheckoutTexts {
  immediateStart: { version: number; text: string };
  terms: { version: number; text: string };
  renewalRule: string;
}

/**
 * § 312j BGB checkout, exactly as on the website: summary with price, term and renewal rule, the
 * versioned immediate-start declaration, and „Zahlungspflichtig bestellen“, disabled until it is
 * ticked. After an ended subscription it first asks whether the old sticker is still on the car.
 * Payment runs on Stripe's page inside the app; afterwards the API confirms it at once.
 */
export function CheckoutForm({ onPaid }: { onPaid: () => void }) {
  const c = useTheme();
  const [promo, setPromo] = useState('');
  const [immediate, setImmediate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<CheckoutTexts | null | 'error'>(null);
  const [resubscribe, setResubscribe] = useState(false);
  const [sticker, setSticker] = useState<'keep' | 'replace' | null>(null);
  const [stickerMissing, setStickerMissing] = useState(false);
  const [state, setState] = useState<'idle' | 'confirming' | 'failed' | 'canceled'>('idle');

  useEffect(() => {
    let live = true;
    void Promise.all([
      api<CheckoutTexts>(`/v1/legal/checkout-texts?locale=${lang()}`),
      api<{ hadSubscription?: boolean }>('/v1/billing/subscription').catch(() => ({
        hadSubscription: false,
      })),
    ])
      .then(([tx, sub]) => {
        if (!live) return;
        setTexts(tx);
        setResubscribe(Boolean(sub.hadSubscription));
      })
      .catch(() => live && setTexts('error'));
    return () => {
      live = false;
    };
  }, []);

  // Back from Stripe: confirm with Stripe right away instead of waiting for the webhook.
  const confirm = async (sessionId: string | null) => {
    setState('confirming');
    for (let i = 0; i < 6; i++) {
      const r = await api<{ status: 'active' | 'pending' }>('/v1/billing/checkout/confirm', {
        body: sessionId ? { sessionId } : {},
      }).catch(() => ({ status: 'pending' as const }));
      if (r.status === 'active') {
        setState('idle');
        onPaid();
        return;
      }
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    setState('failed');
  };

  const submit = async () => {
    if (!immediate || !texts || texts === 'error') return;
    if (resubscribe && !sticker) {
      setStickerMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      plan: 'plus',
      immediateStart: true,
      immediateStartVersion: texts.immediateStart.version,
      termsVersion: texts.terms.version,
      ...(promo.trim() ? { promoCode: promo.trim() } : {}),
    };
    try {
      const r = await payInApp((appReturn) =>
        resubscribe
          ? api<{ url: string }>('/v1/portal/subscriptions/renew', {
              body: { ...body, stickerStillAttached: sticker === 'keep', appReturn },
            })
          : api<{ url: string }>('/v1/billing/checkout', { body: { ...body, appReturn } }),
      );
      if (r.result === 'canceled') setState('canceled');
      // Closed by hand: maybe paid, maybe not; one confirmation round tells.
      else await confirm(r.sessionId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'confirming')
    return (
      <Banner tone="info">{`${pt('account.checkoutSuccess')} ${pt('account.confirming')}`}</Banner>
    );
  if (texts === null) return <P muted>{pt('checkout.textsLoading')}</P>;
  if (texts === 'error') return <Banner tone="err">{pt('checkout.textsMissing')}</Banner>;

  return (
    <View style={s.form}>
      {state === 'failed' && <Banner tone="warn">{pt('account.confirmFailed')}</Banner>}
      {state === 'canceled' && <Banner tone="warn">{pt('account.checkoutCanceled')}</Banner>}
      <P muted>{pt('account.noSubscription')}</P>
      <View style={s.info}>
        <H3>{pt('checkout.summaryTitle')}</H3>
        <Text style={{ color: c.fg, fontSize: 24, fontWeight: '800' }}>
          {pt('checkout.priceLine')}
        </Text>
        <P>{pt('checkout.summaryTerm')}</P>
        <P>
          <Text style={{ fontWeight: '700' }}>{pt('checkout.summaryRenewal')}:</Text>{' '}
          {texts.renewalRule}
        </P>
      </View>
      {resubscribe && (
        <>
          <Choice
            legend={pt('checkout.stickerQuestion')}
            options={['keep', 'replace'] as const}
            value={sticker}
            onChange={(v) => {
              setSticker(v);
              setStickerMissing(false);
            }}
            label={(v) => (v === 'keep' ? pt('checkout.stickerYes') : pt('checkout.stickerNo'))}
          />
          {sticker === 'replace' && <P muted>{pt('checkout.stickerNoHint')}</P>}
          {stickerMissing && <Banner tone="err">{pt('checkout.stickerRequired')}</Banner>}
        </>
      )}
      <Field
        label={pt('checkout.promoLabel')}
        optional={pt('common.optional')}
        value={promo}
        onChangeText={setPromo}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={40}
      />
      {/* TODO [LEGAL REVIEW: mandatory immediate-start consent] text comes from legal_texts */}
      <Check label={texts.immediateStart.text} checked={immediate} onChange={setImmediate} />
      {!immediate && <P muted>{pt('checkout.immediateRequired')}</P>}
      <P muted>
        {pt('checkout.withdrawalNotice')}{' '}
        <Text
          style={s.link}
          accessibilityRole="link"
          onPress={() => void openInBrowser('/widerruf')}
        >
          {pt('checkout.withdrawalLink')}
        </Text>
        . {texts.terms.text}{' '}
        <Text style={s.link} accessibilityRole="link" onPress={() => void openInBrowser('/agb')}>
          {pt('common.footer.terms')}
        </Text>{' '}
        ·{' '}
        <Text
          style={s.link}
          accessibilityRole="link"
          onPress={() => void openInBrowser('/datenschutz')}
        >
          {pt('common.footer.privacy')}
        </Text>
      </P>
      {error && <Banner tone="err">{error}</Banner>}
      <Button
        label={pt('checkout.pay')}
        onPress={() => void submit()}
        busy={busy}
        disabled={!immediate}
      />
    </View>
  );
}

const s = StyleSheet.create({
  info: { gap: 4 },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  form: { gap: 12 },
  link: { textDecorationLine: 'underline', fontWeight: '700' },
});
