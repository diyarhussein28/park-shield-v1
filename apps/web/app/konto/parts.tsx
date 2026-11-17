'use client';

import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
  Text,
  useI18n,
} from '@parkshield/ui';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Section } from '@/components/konto-shell';
import { api, errorText } from '@/lib/api-client';
import type { CreditNote, InvoiceSummary, Me, SubscriptionSummary } from '@/lib/api-server';
import { usePendingClaim } from '@/lib/pending-claim';
import { useBrowserValue } from '@/lib/use-browser-value';

export const PLAN_LABEL = { plus: 'Plus', premium: 'Premium' } as const;

export async function openPaymentPortal() {
  const { url } = await api<{ url: string }>('/v1/billing/portal', { body: {} });
  window.location.assign(url);
}

/** Plan name, status, contract number and the renewal or end date. */
export function SubscriptionInfo({ sub }: { sub: SubscriptionSummary }) {
  const { t } = useI18n();
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-semibold">
          {t('account.planName', { plan: PLAN_LABEL[sub.plan] })}
        </span>
        <Badge tone={sub.status === 'active' ? 'success' : 'warning'}>
          {sub.status === 'active' ? t('account.statusActive') : t('account.statusPastDue')}
        </Badge>
      </div>
      {sub.contractNo && (
        <Text className="wrap-anywhere">
          {t('account.contractNo', { contractNo: sub.contractNo })}
        </Text>
      )}
      {end && (
        <Text muted>
          {sub.cancelAtPeriodEnd
            ? t('account.endsOn', { date: end })
            : t('account.renewsOn', { date: end })}
        </Text>
      )}
    </div>
  );
}

export function PastDue() {
  const { t } = useI18n();
  return (
    <Notice tone="warning">
      <p>{t('account.pastDueNotice')}</p>
      <Button variant="secondary" onClick={() => void openPaymentPortal()} className="mt-3">
        {t('account.paymentMethod')}
      </Button>
    </Notice>
  );
}

interface CheckoutTexts {
  immediateStart: { version: number; text: string };
  terms: { version: number; text: string };
  renewalRule: string;
}

/**
 * § 312j BGB checkout: summary with price, term and the renewal rule from the server's configuration,
 * the immediate-start declaration exactly as stored (versioned, its hash is recorded with the order),
 * and the button „Zahlungspflichtig bestellen“, disabled until the declaration is ticked.
 * After an ended subscription it first asks whether the old sticker is still on the car.
 */
export function CheckoutForm() {
  const { t, locale } = useI18n();
  const pending = usePendingClaim();
  const [typed, setPromo] = useState<string | null>(null);
  // A partner decal brings its promo code along (AD-07); the person may still change it.
  const promo = typed ?? pending?.promoCode ?? '';
  const [immediate, setImmediate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<CheckoutTexts | null | 'error'>(null);
  const [resubscribe, setResubscribe] = useState(false);
  const [sticker, setSticker] = useState<'keep' | 'replace' | null>(null);
  const [stickerMissing, setStickerMissing] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([
      api<CheckoutTexts>(`/v1/legal/checkout-texts?locale=${locale}`, { method: 'GET' }),
      api<{ hadSubscription?: boolean }>('/v1/billing/subscription', { method: 'GET' }).catch(
        () => ({ hadSubscription: false }),
      ),
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
  }, [locale]);

  async function submit(e: FormEvent) {
    e.preventDefault();
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
      const { url } = resubscribe
        ? await api<{ url: string }>('/v1/portal/subscriptions/renew', {
            body: { ...body, stickerStillAttached: sticker === 'keep' },
          })
        : await api<{ url: string }>('/v1/billing/checkout', { body });
      window.location.assign(url);
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  }

  if (texts === null) return <Text muted>{t('checkout.textsLoading')}</Text>;
  if (texts === 'error') return <Notice tone="danger">{t('checkout.textsMissing')}</Notice>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Text muted>{t('account.noSubscription')}</Text>
      <section aria-labelledby="checkout-summary" className="flex flex-col gap-1">
        <h3 id="checkout-summary" className="font-semibold">
          {t('checkout.summaryTitle')}
        </h3>
        <p className="text-2xl font-bold">{t('checkout.priceLine')}</p>
        <Text>{t('checkout.summaryTerm')}</Text>
        <Text>
          <span className="font-semibold">{t('checkout.summaryRenewal')}:</span> {texts.renewalRule}
        </Text>
      </section>
      {resubscribe && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">{t('checkout.stickerQuestion')}</legend>
          {(['keep', 'replace'] as const).map((v) => (
            <label key={v} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="sticker"
                className="size-5"
                checked={sticker === v}
                onChange={() => {
                  setSticker(v);
                  setStickerMissing(false);
                }}
              />
              {v === 'keep' ? t('checkout.stickerYes') : t('checkout.stickerNo')}
            </label>
          ))}
          {sticker === 'replace' && <Text muted>{t('checkout.stickerNoHint')}</Text>}
          {stickerMissing && (
            <p className="font-semibold text-danger-text" role="alert">
              {t('checkout.stickerRequired')}
            </p>
          )}
        </fieldset>
      )}
      <Field label={t('checkout.promoLabel')} optionalLabel={t('common.optional')}>
        {({ id }) => (
          <Input
            id={id}
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
            autoComplete="off"
            maxLength={40}
            className="max-w-xs"
          />
        )}
      </Field>
      {/* TODO [LEGAL REVIEW: mandatory immediate-start consent] text comes from legal_texts */}
      <Checkbox
        label={texts.immediateStart.text}
        checked={immediate}
        onChange={(e) => setImmediate(e.target.checked)}
        aria-describedby={immediate ? undefined : 'immediate-required'}
      />
      {!immediate && (
        <p id="immediate-required" className="text-sm text-muted">
          {t('checkout.immediateRequired')}
        </p>
      )}
      <Text className="text-sm">
        {t('checkout.withdrawalNotice')}{' '}
        <Link className="underline" href="/widerruf">
          {t('checkout.withdrawalLink')}
        </Link>
        . {texts.terms.text}{' '}
        <Link className="underline" href="/agb">
          {t('common.footer.terms')}
        </Link>{' '}
        ·{' '}
        <Link className="underline" href="/datenschutz">
          {t('common.footer.privacy')}
        </Link>
      </Text>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" size="lg" busy={busy} disabled={!immediate} className="sm:w-fit">
        {t('checkout.pay')}
      </Button>
    </form>
  );
}

export function Invoices({
  invoices,
  creditNotes,
}: {
  invoices: InvoiceSummary[];
  creditNotes: CreditNote[];
}) {
  const { t, locale } = useI18n();
  return (
    <Section title={t('account.invoices')} icon="download">
      {invoices.length === 0 ? (
        <Text muted>{t('account.noInvoices')}</Text>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {invoices.map((i) => (
            <li key={i.id} className="py-2">
              {i.pdfUrl ? (
                <a
                  className="text-primary underline wrap-anywhere"
                  href={i.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('account.invoiceLink', { number: i.number, date: new Date(i.createdAt) })}
                </a>
              ) : (
                i.number
              )}
            </li>
          ))}
        </ul>
      )}
      {creditNotes.length > 0 && (
        <>
          <h3 className="font-semibold">{t('account.creditNotes')}</h3>
          <ul
            className="flex flex-col divide-y divide-border"
            aria-label={t('account.creditNotes')}
          >
            {creditNotes.map((c) => (
              <li key={c.id} className="py-2">
                <a
                  className="text-primary underline wrap-anywhere"
                  href={`/v1/billing/credit-notes/${c.id}/pdf`}
                >
                  {t('account.creditNoteLink', {
                    number: c.number,
                    date: new Date(c.createdAt),
                    amount: new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'de-DE', {
                      style: 'currency',
                      currency: 'EUR',
                    }).format(c.amountCents / 100),
                  })}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export function SummarySettings({ initial }: { initial: Me['summaryFrequency'] }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<string | null>(null);

  async function save(next: Me['summaryFrequency']) {
    setValue(next);
    setStatus(null);
    try {
      await api('/v1/me', { method: 'PATCH', body: { summaryFrequency: next } });
      setStatus(t('summarySettings.saved'));
    } catch (err) {
      setStatus(errorText(err, t));
    }
  }

  return (
    <Section title={t('summarySettings.title')} icon="mail" intro={t('summarySettings.intro')}>
      <Field label={t('summarySettings.label')}>
        {({ id }) => (
          <Select
            id={id}
            className="max-w-xs"
            value={value}
            onChange={(e) => void save(e.target.value as Me['summaryFrequency'])}
          >
            <option value="monthly">{t('summarySettings.monthly')}</option>
            <option value="weekly">{t('summarySettings.weekly')}</option>
            <option value="off">{t('summarySettings.off')}</option>
          </Select>
        )}
      </Field>
      <p role="status" className="text-sm text-muted">
        {status}
      </p>
    </Section>
  );
}

export function Passkeys({ initial }: { initial: Me['passkeys'] }) {
  const { t } = useI18n();
  const [list, setList] = useState(initial);
  const supported = useBrowserValue(browserSupportsWebAuthn, true);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function reload() {
    setList((await api<Me>('/v1/me')).passkeys);
  }

  async function add() {
    setMessage(null);
    try {
      const options = await api<never>('/v1/auth/passkey/register/options', { body: {} });
      const response = await startRegistration({ optionsJSON: options });
      await api('/v1/auth/passkey/register/verify', {
        body: { response, label: navigator.platform || 'Passkey' },
      });
      await reload();
      setMessage({ tone: 'success', text: t('account.passkeyAdded') });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err, t) });
    }
  }

  async function remove(id: string) {
    await api(`/v1/me/passkeys/${id}`, { method: 'DELETE' });
    await reload();
  }

  return (
    <Section title={t('account.passkeys')} icon="lock" intro={t('account.passkeysIntro')}>
      {list.length === 0 ? (
        <Text muted>{t('account.noPasskeys')}</Text>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                {p.label ?? 'Passkey'} ·{' '}
                {t('account.passkeyAddedOn', { date: new Date(p.createdAt) })}
              </span>
              <Button variant="ghost" onClick={() => remove(p.id)}>
                {t('account.removePasskey', { label: p.label ?? 'Passkey' })}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {supported ? (
        <Button variant="secondary" onClick={add} className="w-fit">
          {t('account.addPasskey')}
        </Button>
      ) : (
        <Text muted>{t('account.passkeyUnsupported')}</Text>
      )}
    </Section>
  );
}
