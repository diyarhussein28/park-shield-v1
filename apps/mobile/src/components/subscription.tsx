import {
  LIFETIME_PRICE_CENTS,
  PLAN_PRICE_CENTS,
  STORE_LIFETIME_PRICE_CENTS,
  STORE_PLAN_PRICE_CENTS,
  type PlanTerm,
} from '@parkshield/shared/plans';
import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { api } from '@/lib/api';
import {
  STICKER_VALUE_CENTS,
  isStoreProvider,
  refundRouteUrl,
  storeErrorKey,
  storeManageUrl,
  type BillingProvider,
} from '@/lib/billing';
import {
  isStoreBillingAvailable,
  lifetimePackage,
  purchaseYearly,
  restoreStorePurchases,
  yearlyPackage,
} from '@/lib/purchases';
import { lang, t, type Key } from '@/lib/i18n';
import {
  errorText,
  euro,
  longDate,
  openInBrowser,
  payInApp,
  type EndedSubscription,
  type PausedSubscription,
  type PortalMe,
  type SubscriptionSummary,
} from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { radius, space, type as typeScale } from '@/theme/tokens';
import { Badge, Check, Choice, Field } from './form';
import { Icon } from './icons';
import { LifetimeOffer } from './lifetime-offer';
import { Collapsible } from './list';
import { Banner, Button, Card, P, Title, useTheme } from './ui';

/** The one plan's price (19,99 € incl. VAT), formatted for the app's language. */
export const planPrice = () => euro(PLAN_PRICE_CENTS, lang());

/**
 * The price before the store's own price string is loaded: 19,99 € where the app buys through the App
 * Store or Google Play, else the web price (Stripe fallback, test environments).
 */
export const appPlanPrice = () =>
  isStoreBillingAvailable() ? euro(STORE_PLAN_PRICE_CENTS, lang()) : planPrice();

/**
 * The price the customer will actually pay here: the store's own price (App Store 19,99 €) when the
 * purchase goes through the store, else the web price. Every price on the paywall uses this one.
 */
export function usePlanPrice(): string {
  const [price, setPrice] = useState(appPlanPrice);
  useEffect(() => {
    if (!isStoreBillingAvailable()) return;
    let on = true;
    void yearlyPackage()
      .then((p) => on && p && setPrice(p.product.priceString))
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, []);
  return price;
}

/** „Im Preis enthalten: personalisierter Aufkleber … im Wert von 3,00 €.“ (B2). */
export const stickerValueText = (cents: number = STICKER_VALUE_CENTS) =>
  t('stickerValueLine', { price: euro(cents, lang()) });

/** The text for a failed store purchase or restore: the store's reason when known, else generic. */
export const storePurchaseErrorText = (err: unknown) => {
  const key = storeErrorKey(err);
  return key
    ? t(key, { store: storeName(Platform.OS === 'ios' ? 'app_store' : 'play_store') })
    : errorText(err);
};

/** Why the last plan ended: withdrawn, refunded, expired, or moved to another ParkShield account. */
export const endedText = (e: EndedSubscription) => {
  const date = longDate(e.endedAt);
  if (e.reason === 'withdrawn') return t('endedWithdrawn', { date });
  if (e.reason === 'refunded') return t('endedRefunded', { date });
  if (e.reason === 'moved') return t('endedMoved', { date, store: storeName(e.provider) });
  return t('endedExpired', { date });
};

/** „Apple“ / „Google Play“ for a store subscription. */
export const storeName = (p: BillingProvider | null | undefined) =>
  p === 'play_store' ? t('storeNameGoogle') : t('storeNameApple');

/** „Gekauft im App Store / bei Google Play / auf park-shield.de“. */
export const providerText = (p: BillingProvider | null | undefined) =>
  p === 'app_store'
    ? t('providerAppStore')
    : p === 'play_store'
      ? t('providerPlayStore')
      : t('providerWeb');

/** Opens the store's subscription management (A6: our backend cannot cancel store subscriptions). */
export const openStoreManagement = (sub: SubscriptionSummary) => {
  const url = storeManageUrl(sub);
  if (url) void Linking.openURL(url);
};

/** „Ihr Tarif enthält“: everything is included in the one plan (owner decision 2026-11-21). */
export const PLAN_FEATURES: Key[] = [
  'planF1',
  'planF2',
  'planF3',
  'planF4',
  'planF5',
  'planF6',
  'planF7',
];

export function PlanFeatures() {
  const c = useTheme();
  return (
    <View style={s.features} testID="plan-features">
      {PLAN_FEATURES.map((k) => (
        <View key={k} style={s.feature}>
          <View style={[s.check, { backgroundColor: c.successBg }]}>
            <Icon name="check" size={14} color={c.successFg} />
          </View>
          <Text style={[typeScale.label, { color: c.fg, fontWeight: '400', flex: 1 }]}>{t(k)}</Text>
        </View>
      ))}
    </View>
  );
}

/** „ParkShield · Aktiv“, contract number and the renewal or end date (web: SubscriptionInfo). */
export function SubscriptionInfo({ sub }: { sub: SubscriptionSummary }) {
  const c = useTheme();
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  return (
    <View style={s.info}>
      <View style={s.line}>
        <Text style={{ color: c.fg, fontSize: 19, fontWeight: '700' }}>{t('planName')}</Text>
        <Badge tone={sub.status === 'active' ? 'ok' : 'warn'}>
          {sub.status === 'active' ? pt('account.statusActive') : pt('account.statusPastDue')}
        </Badge>
      </View>
      {sub.contractNo && <P>{pt('account.contractNo', { contractNo: sub.contractNo })}</P>}
      <P muted>{providerText(sub.provider)}</P>
      {sub.lifetime && <P>{t('lifetimeActive')}</P>}
      {!sub.lifetime && end && (
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

export function PastDue({ sub }: { sub?: SubscriptionSummary | null }) {
  const store = isStoreProvider(sub?.provider);
  return (
    <Banner tone="warn">
      <P>{pt('account.pastDueNotice')}</P>
      <Button
        label={
          store
            ? t('storeManageButton', { store: storeName(sub?.provider) })
            : pt('account.paymentMethod')
        }
        variant="secondary"
        onPress={() => (store && sub ? openStoreManagement(sub) : void openPaymentPortal())}
      />
    </Banner>
  );
}

interface CheckoutTexts {
  immediateStart: { version: number; text: string };
  terms: { version: number; text: string };
  renewalRule: string;
}

export type CheckoutState = 'idle' | 'confirming' | 'failed' | 'canceled' | 'failed_store';

/**
 * § 312j BGB checkout (P3, P7) as one plan card like the website's (owner 2026-11-28): the plan with
 * its price and features, then price, term and renewal right above the buttons, together with the
 * versioned immediate-start declaration (required, never pre-ticked) and the sticker notice (B3, no extra
 * checkbox), then the yellow „Zahlungspflichtig bestellen“ and the Lifetime button. AGB and privacy links
 * stay visible under the card; the withdrawal notice and the voucher code fold away under „Details“.
 *
 * In a real build with the store key (A2) the subscription is an Apple / Google in-app purchase
 * through RevenueCat: first `/v1/billing/store/prepare` (gates and the consent, exactly as on the
 * website), then the store sheet, then `/v1/billing/store/sync`. In Expo Go and without a key the
 * Stripe page opens inside the app (test-only fallback). Only a real success says „Zahlung erhalten“;
 * a cancelled or closed payment says that nothing was charged.
 */
export function CheckoutForm({ onPaid }: { onPaid: () => void }) {
  const c = useTheme();
  const store = isStoreBillingAvailable();
  const [promo, setPromo] = useState('');
  const [immediate, setImmediate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [texts, setTexts] = useState<CheckoutTexts | null | 'error'>(null);
  const [resubscribe, setResubscribe] = useState(false);
  const [live, setLive] = useState<SubscriptionSummary | null>(null);
  // Google Play „Pause“: the contract runs on; resume it in Play, never a second purchase.
  const [paused, setPaused] = useState<PausedSubscription | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [pkg, setPkg] = useState<PurchasesPackage | null | 'error'>(null);
  // Lifetime (2026-11-26): the store's non-consumable; null = the store offers none (no button).
  const [lifePkg, setLifePkg] = useState<PurchasesPackage | null>(null);
  const [busyTerm, setBusyTerm] = useState<PlanTerm>('year');
  const [sticker, setSticker] = useState<'keep' | 'replace' | null>(null);
  const [stickerMissing, setStickerMissing] = useState(false);
  const [state, setState] = useState<CheckoutState>('idle');

  useEffect(() => {
    let on = true;
    void Promise.all([
      api<CheckoutTexts>(`/v1/legal/checkout-texts?locale=${lang()}`),
      api<{
        subscription?: SubscriptionSummary | null;
        hadSubscription?: boolean;
        paused?: PausedSubscription | null;
      }>('/v1/billing/subscription').catch(() => ({
        subscription: null,
        hadSubscription: false,
        paused: null,
      })),
      api<PortalMe>('/v1/me').catch(() => null),
    ])
      .then(([tx, sub, me]) => {
        if (!on) return;
        setTexts(tx);
        setResubscribe(Boolean(sub.hadSubscription));
        setLive(sub.subscription ?? null);
        setPaused(sub.paused ?? null);
        setUserId(me?.id ?? null);
      })
      .catch(() => on && setTexts('error'));
    if (store) {
      void yearlyPackage()
        .then((p) => on && setPkg(p ?? 'error'))
        .catch(() => on && setPkg('error'));
      void lifetimePackage()
        .then((p) => on && setLifePkg(p))
        .catch(() => undefined);
    }
    return () => {
      on = false;
    };
  }, [store]);

  // The store's own price (19,99 €, the same as Stripe) when the store is used.
  const price = store && pkg && pkg !== 'error' ? pkg.product.priceString : planPrice();
  const lifePrice =
    store && lifePkg ? lifePkg.product.priceString : euro(LIFETIME_PRICE_CENTS, lang());
  // The real amounts behind the comparison texts (the store's prices when it sells the plan).
  const yearCents =
    store && pkg && pkg !== 'error'
      ? Math.round(pkg.product.price * 100)
      : store
        ? STORE_PLAN_PRICE_CENTS
        : PLAN_PRICE_CENTS;
  const lifeCents =
    store && lifePkg
      ? Math.round(lifePkg.product.price * 100)
      : store
        ? STORE_LIFETIME_PRICE_CENTS
        : LIFETIME_PRICE_CENTS;
  const lifetimeOffered = !store || Boolean(lifePkg);

  const check = (sessionId: string | null) =>
    api<{ status: 'active' | 'pending' }>('/v1/billing/checkout/confirm', {
      body: sessionId ? { sessionId } : {},
    }).catch(() => ({ status: 'pending' as const }));

  const syncStore = () =>
    api<{ status: 'active' | 'pending' }>('/v1/billing/store/sync', { body: {} }).catch(() => ({
      status: 'pending' as const,
    }));

  // Back from Stripe or the store with success: confirm right away instead of waiting for the webhook.
  const confirm = async (probe: () => Promise<{ status: 'active' | 'pending' }>) => {
    setState('confirming');
    for (let i = 0; i < 6; i++) {
      if ((await probe()).status === 'active') {
        setState('idle');
        onPaid();
        return;
      }
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    setState(probe === syncStore ? 'failed_store' : 'failed');
  };

  const submitStore = async (term: PlanTerm) => {
    const chosen = term === 'lifetime' ? lifePkg : pkg;
    if (!texts || texts === 'error' || !chosen || chosen === 'error') return;
    // Proof of what was agreed, stored before the store sheet opens (same as the web checkout).
    const prepared = await api<{ appUserId: string }>('/v1/billing/store/prepare', {
      body: {
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        immediateStartVersion: texts.immediateStart.version,
        termsVersion: texts.terms.version,
      },
    });
    const id = prepared.appUserId || userId;
    if (!id) throw new Error('no_user');
    const r = await purchaseYearly(chosen, id);
    if (r === 'canceled') setState('canceled');
    else await confirm(syncStore);
  };

  const submitStripe = async (term: PlanTerm) => {
    if (!texts || texts === 'error') return;
    const lifetime = term === 'lifetime';
    const body = {
      plan: 'standard',
      ...(lifetime ? { term: 'lifetime' } : {}),
      immediateStart: true,
      immediateStartVersion: texts.immediateStart.version,
      termsVersion: texts.terms.version,
      ...(promo.trim() && !lifetime ? { promoCode: promo.trim() } : {}),
    };
    const r = await payInApp((appReturn) =>
      resubscribe
        ? api<{ url: string }>('/v1/portal/subscriptions/renew', {
            body: { ...body, stickerStillAttached: sticker === 'keep', appReturn },
          })
        : api<{ url: string }>('/v1/billing/checkout', { body: { ...body, appReturn } }),
    );
    if (r.result === 'success') await confirm(() => check(r.sessionId));
    else if (r.result === 'canceled') setState('canceled');
    // Closed by hand: almost always not paid. One quiet check, no „thank you“ (P3).
    else if ((await check(null)).status === 'active') onPaid();
    else setState('canceled');
  };

  const submit = async (term: PlanTerm = 'year') => {
    if (!immediate || !texts || texts === 'error') return;
    if (!store && resubscribe && !sticker) {
      setStickerMissing(true);
      return;
    }
    setBusy(true);
    setBusyTerm(term);
    setError(null);
    setInfo(null);
    setState('idle');
    try {
      await (store ? submitStore(term) : submitStripe(term));
    } catch (err) {
      setError(store ? storePurchaseErrorText(err) : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // „Käufe wiederherstellen“ (App Store rule): the store re-sends the purchases, our API reads them.
  const restore = async () => {
    if (!userId) return;
    setRestoring(true);
    setError(null);
    setInfo(null);
    try {
      await restoreStorePurchases(userId);
      if ((await syncStore()).status === 'active') onPaid();
      else setInfo(t('restoreNone'));
    } catch (err) {
      setError(storePurchaseErrorText(err));
    } finally {
      setRestoring(false);
    }
  };

  if (state === 'confirming') return <Banner tone="info">{t('payChecking')}</Banner>;
  if (texts === null) return <P muted>{pt('checkout.textsLoading')}</P>;
  if (texts === 'error') return <Banner tone="err">{pt('checkout.textsMissing')}</Banner>;

  // A4: never a second subscription. Say where it was bought and how to manage it.
  if (live) {
    return (
      <View style={s.form} testID="already-subscribed">
        <Banner tone="ok">{t('alreadySubscribed')}</Banner>
        <P>{providerText(live.provider)}</P>
        {isStoreProvider(live.provider) ? (
          <>
            <P muted>{t('storeManageText', { store: storeName(live.provider) })}</P>
            <Button
              variant="secondary"
              label={t('storeManageButton', { store: storeName(live.provider) })}
              onPress={() => openStoreManagement(live)}
            />
          </>
        ) : (
          <P muted>{t('manageWeb')}</P>
        )}
      </View>
    );
  }

  if (paused) {
    return (
      <View style={s.form} testID="subscription-paused">
        <Banner tone="warn">{pt('account.pausedTitle')}</Banner>
        <P>{pt('account.pausedText', { date: new Date(paused.pausedUntil) })}</P>
        <Button
          label={pt('account.pausedResume')}
          onPress={() => void Linking.openURL(paused.managementUrl)}
        />
      </View>
    );
  }

  const storeMissing = store && pkg === 'error';
  return (
    <View style={s.form}>
      {state === 'failed' && <Banner tone="warn">{pt('account.confirmFailed')}</Banner>}
      {state === 'failed_store' && <Banner tone="warn">{t('storeConfirmFailed')}</Banner>}
      {state === 'canceled' && (
        <Banner tone="info" testID="pay-canceled">
          {t('payCanceled')}
        </Banner>
      )}
      {/* One card like the website's pricing card (owner 2026-11-28): the plan, then everything § 312j
          BGB needs directly above the buttons, then both buttons. */}
      <View
        testID="plan-card"
        style={[s.card, { backgroundColor: c.surface, borderColor: c.accent }]}
      >
        <PlanHeader price={price} />
        <PlanFeatures />
        <View style={[s.rule, { backgroundColor: c.border }]} />
        {/* Price, term and renewal stay visible directly above „Zahlungspflichtig bestellen“. */}
        <View style={s.facts} testID="pay-facts">
          <Text style={[typeScale.caption, { color: c.muted }]}>
            {`${t('paywallYearly')} · ${pt('checkout.summaryTerm')}`}
          </Text>
          <Text style={[typeScale.caption, { color: c.muted }]}>
            <Text style={{ fontWeight: '700', color: c.fg }}>{pt('checkout.summaryRenewal')}:</Text>{' '}
            {texts.renewalRule}
          </Text>
          {/* TODO [LEGAL REVIEW] price breakdown (B2) */}
          <Text style={[typeScale.caption, { color: c.muted }]}>{stickerValueText()}</Text>
        </View>
        {!store && resubscribe && (
          <>
            <Choice
              legend={pt('checkout.stickerQuestion')}
              options={['keep', 'replace'] as const}
              value={sticker}
              disabled={busy}
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
        {/* TODO [LEGAL REVIEW: mandatory immediate-start consent] text comes from legal_texts */}
        <Check
          label={texts.immediateStart.text}
          checked={immediate}
          onChange={setImmediate}
          disabled={busy}
          testID="immediate-start"
        />
        {/* TODO [LEGAL REVIEW] § 312g Abs. 2 Nr. 1 BGB: info line next to the consent, no checkbox (B3). */}
        <View testID="sticker-notice">
          <Text style={[typeScale.caption, { color: c.muted }]}>{t('stickerNotice')}</Text>
        </View>
        {storeMissing && <Banner tone="warn">{t('storeUnavailable')}</Banner>}
        {error && <Banner tone="err">{error}</Banner>}
        {info && <Banner tone="info">{info}</Banner>}
        {/* § 312j BGB: the button names the obligation to pay and the price. */}
        <Button
          variant="accent"
          label={t('payButton', { price })}
          onPress={() => void submit('year')}
          busy={busy && busyTerm === 'year'}
          disabled={busy || !immediate || (store && (!pkg || pkg === 'error'))}
          testID="pay"
        />
        {lifetimeOffered && (
          <LifetimeOffer
            price={lifePrice}
            yearCents={yearCents}
            lifetimeCents={lifeCents}
            onPress={() => void submit('lifetime')}
            busy={busy && busyTerm === 'lifetime'}
            disabled={busy || !immediate}
          />
        )}
        {/* QA 2026-11-25: the hint keeps its space once the box is ticked, so nothing below it jumps. */}
        <View
          testID="immediate-required"
          style={{ opacity: immediate ? 0 : 1 }}
          accessibilityElementsHidden={immediate}
          importantForAccessibility={immediate ? 'no-hide-descendants' : 'auto'}
        >
          <Text style={[typeScale.caption, { color: c.muted, textAlign: 'center' }]}>
            {pt('checkout.immediateRequired')}
          </Text>
        </View>
      </View>
      <View style={s.secure}>
        <Icon name="lock" size={16} color={c.muted} />
        <Text style={[typeScale.caption, { color: c.muted, flexShrink: 1 }]}>
          {store
            ? Platform.OS === 'ios'
              ? t('payStoreSecureIos')
              : t('payStoreSecureAndroid')
            : t('paySecure')}
        </Text>
      </View>
      <P muted>
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
      {store && (
        <Button
          variant="ghost"
          label={t('restorePurchases')}
          onPress={() => void restore()}
          busy={restoring}
          disabled={!userId}
          testID="restore"
        />
      )}
      <Collapsible title={t('paywallDetails')} testID="pay-details">
        <P muted>
          {pt('checkout.withdrawalNotice')}{' '}
          <Text
            style={s.link}
            accessibilityRole="link"
            onPress={() => void openInBrowser('/widerruf')}
          >
            {pt('checkout.withdrawalLink')}
          </Text>
          . {texts.terms.text}
        </P>
        {!store && (
          <Field
            label={pt('checkout.promoLabel')}
            optional={pt('common.optional')}
            value={promo}
            onChangeText={setPromo}
            editable={!busy}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={40}
            ltr
          />
        )}
      </Collapsible>
    </View>
  );
}

/**
 * The top of the plan card, like the website's: „ParkShield“, „Alles inklusive, für ein Fahrzeug“ and
 * the price set large with „/ Jahr inkl. 19 % MwSt.“ (the store's own price when the store sells it).
 */
function PlanHeader({ price }: { price: string }) {
  const c = useTheme();
  const line = pt('landing.priceInclVat', { price });
  const at = line.indexOf(price);
  return (
    <View
      accessible
      accessibilityLabel={`${t('planName')} · ${t('planPriceLine', { price })}`}
      testID="price-line"
      style={{ gap: 2 }}
    >
      <Text style={[typeScale.title, { color: c.fg }]}>{t('planName')}</Text>
      <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>
        {pt('landing.planFor')}
      </Text>
      <Text style={[typeScale.body, { color: c.muted, marginTop: space.sm }]}>
        {at > 0 && line.slice(0, at)}
        <Text style={[typeScale.title, s.price, { color: c.fg }]}>{price}</Text>
        {at < 0 ? ` ${line}` : ` ${line.slice(at + price.length).trim()}`}
      </Text>
    </View>
  );
}

/**
 * „Vertrag“ (owner decision 2026-11-21): one card instead of separate withdrawal and cancel cards.
 * While the withdrawal period runs (`withdrawalOpenUntil` in the future) „Vertrag widerrufen“ stays on
 * it, as visible as „Vertrag hier kündigen“ (§ 356a BGB: permanently available, prominently placed,
 * on the interface where the contract was concluded); afterwards only the cancel part remains.
 *
 * Store subscriptions (A6, Apple/Google are the seller): both buttons stay, but „Vertrag hier
 * kündigen“ leads to the store's subscription management and „Vertrag widerrufen“ to the store's
 * refund route (our refund calculation is for website subscriptions only). The screens behind
 * `onWithdraw` / `onCancel` show the same, with our own forms kept below.
 */
export function ContractCard({
  sub,
  onWithdraw,
  onCancel,
  now = new Date(),
}: {
  sub: SubscriptionSummary;
  onWithdraw: () => void;
  onCancel: () => void;
  now?: Date;
}) {
  const withdrawal =
    sub.withdrawalOpenUntil && new Date(sub.withdrawalOpenUntil) > now
      ? sub.withdrawalOpenUntil
      : null;
  const store = isStoreProvider(sub.provider);
  const name = storeName(sub.provider);
  return (
    <Card>
      <Title>{t('contractTitle')}</Title>
      {/* TODO [LEGAL REVIEW] § 356a BGB withdrawal button wording, placement and the date shown. */}
      {withdrawal && (
        <View style={s.part} testID="contract-withdraw">
          <P>{t('withdrawUntil', { date: longDate(withdrawal) })}</P>
          {store && <P muted>{t('storeWithdrawText', { store: name })}</P>}
          <Button
            variant="secondary"
            label={t('withdrawButton')}
            onPress={onWithdraw}
            testID="withdraw"
          />
        </View>
      )}
      {/* TODO [LEGAL REVIEW] § 312k BGB cancellation text (annual renewal, end of the paid year). */}
      {sub.lifetime ? (
        <View style={s.part} testID="contract-lifetime">
          <P>{t('lifetimeNothingToCancel')}</P>
        </View>
      ) : store ? (
        <View style={s.part} testID="contract-cancel-store">
          {sub.cancelAtPeriodEnd && sub.currentPeriodEnd && (
            <P>{pt('account.endsOn', { date: new Date(sub.currentPeriodEnd) })}</P>
          )}
          <P muted>{t('storeManageText', { store: name })}</P>
          <Button
            variant="secondary"
            label={t('cancelButton')}
            onPress={() => openStoreManagement(sub)}
            accessibilityHint={t('storeCancelButton', { store: name })}
            testID="cancel"
          />
        </View>
      ) : sub.cancelAtPeriodEnd ? (
        sub.currentPeriodEnd && (
          <P>{pt('account.endsOn', { date: new Date(sub.currentPeriodEnd) })}</P>
        )
      ) : (
        <View style={s.part} testID="contract-cancel">
          <P>{pt('account.cancelText')}</P>
          <Button
            variant="secondary"
            label={t('cancelButton')}
            onPress={onCancel}
            testID="cancel"
          />
        </View>
      )}
    </Card>
  );
}

/** The store's refund route for a store subscriber (A6): Apple „Problem melden“, Google Play orders. */
export function StoreRefundCard({ sub }: { sub: SubscriptionSummary }) {
  const url = refundRouteUrl(sub);
  if (!isStoreProvider(sub.provider) || !url) return null;
  const name = storeName(sub.provider);
  return (
    <Card>
      <View testID="store-refund" style={s.part}>
        <P>{t('storeWithdrawText', { store: name })}</P>
        <Button
          label={t('storeRefundButton', { store: name })}
          onPress={() => void Linking.openURL(url)}
        />
      </View>
    </Card>
  );
}

/** The store's subscription management for a store subscriber (A6, „Vertrag hier kündigen“). */
export function StoreManageCard({ sub }: { sub: SubscriptionSummary }) {
  if (!isStoreProvider(sub.provider)) return null;
  const name = storeName(sub.provider);
  return (
    <Card>
      <View testID="store-manage" style={s.part}>
        <P>{t('storeManageText', { store: name })}</P>
        <Button
          label={t('storeManageButton', { store: name })}
          onPress={() => openStoreManagement(sub)}
        />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  part: { gap: 8 },
  info: { gap: 4 },
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  form: { gap: 12 },
  card: { borderRadius: radius.lg, borderWidth: 2, padding: space.lg, gap: space.md },
  rule: { height: StyleSheet.hairlineWidth },
  facts: { gap: 4 },
  price: { fontSize: 40, lineHeight: 46 },
  link: { textDecorationLine: 'underline', fontWeight: '700' },
  secure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  features: { gap: 8 },
  feature: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
