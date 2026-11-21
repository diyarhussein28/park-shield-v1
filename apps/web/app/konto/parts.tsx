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
import { PLAN_FEATURE_COUNT, PLAN_PRICE_CENTS } from '@parkshield/shared';
import type { MessageKey } from '@parkshield/i18n';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { Section } from '@/components/konto-shell';
import { PhoneSetup } from '@/components/phone-setup';
import { api, errorText } from '@/lib/api-client';
import type {
  CreditNote,
  InvoiceSummary,
  Me,
  ProfileSummary,
  SubscriptionSummary,
} from '@/lib/api-server';
import { usePendingClaim } from '@/lib/pending-claim';
import { useBrowserValue } from '@/lib/use-browser-value';

/** Euro amount in the visitor's language, without cents for whole euros (20 €, €3). */
export function useEuro() {
  const { locale } = useI18n();
  return (cents: number) =>
    new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
}

/** The single plan's yearly price (setting `prices.plan_year_cents`; the default until it loaded). */
export function usePlanPrice(): number {
  const [cents, setCents] = useState(PLAN_PRICE_CENTS);
  useEffect(() => {
    let live = true;
    void api<{ code: string; priceYearGrossCents: number }[]>('/v1/plans', { method: 'GET' })
      .then((plans) => {
        const p = plans.find((x) => x.code === 'standard');
        if (live && p) setCents(p.priceYearGrossCents);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return cents;
}

/** The plan's feature lines, the same keys as the pricing page and the welcome letter. */
export function PlanFeatures() {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-2">
      {Array.from(
        { length: PLAN_FEATURE_COUNT },
        (_, i) => `landing.planF${i + 1}` as MessageKey,
      ).map((k) => (
        <li key={k} className="flex items-start gap-2">
          <Icon name="check" className="mt-0.5 size-5 shrink-0 text-success-fg" />
          <span>{t(k)}</span>
        </li>
      ))}
    </ul>
  );
}

export async function openPaymentPortal() {
  const { url } = await api<{ url: string }>('/v1/billing/portal', { body: {} });
  window.location.assign(url);
}

/** Plan name, status, contract number and the renewal or end date. */
export function SubscriptionInfo({ sub }: { sub: SubscriptionSummary }) {
  const { t } = useI18n();
  const euro = useEuro();
  const price = usePlanPrice();
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-semibold">
          {t('account.planLine', { price: euro(price) })}
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

interface ProfileValues {
  firstName: string;
  lastName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}
type ProfileErrors = Partial<Record<keyof ProfileValues, string>>;
const EMPTY_PROFILE: ProfileValues = {
  firstName: '',
  lastName: '',
  street: '',
  postalCode: '',
  city: '',
  country: 'DE',
};

/**
 * „Konto vervollständigen“ (docs/app-redesign.md §6/§7): name and postal address, required before the
 * first checkout (the API answers profile_incomplete otherwise). The same rules and texts as the app;
 * the verified mobile number is the next step (PhoneSetup, API `phone_required`).
 */
export function ProfileForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState<ProfileValues>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(p: ProfileValues): ProfileErrors {
    const e: ProfileErrors = {};
    for (const [k, max] of [
      ['firstName', 60],
      ['lastName', 60],
      ['street', 100],
      ['city', 60],
    ] as const) {
      const val = p[k].trim();
      if (!val) e[k] = t('profile.required');
      else if (val.length > max) e[k] = t('profile.tooLong');
      else if (/[<>{}\\[\]`$|^~@#%*=+;]/.test(val)) e[k] = t('profile.invalidCharacters');
    }
    const code = p.postalCode.trim();
    if (!code) e.postalCode = t('profile.required');
    else if (p.country === 'DE' ? !/^\d{5}$/.test(code) : !/^[A-Za-z0-9 -]{3,10}$/.test(code))
      e.postalCode = t('profile.postalCodeInvalid');
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate(v);
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api('/v1/me/profile', {
        method: 'PUT',
        body: { ...v, postalCode: v.postalCode.trim() },
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  const field = (
    key: 'firstName' | 'lastName' | 'street' | 'postalCode' | 'city',
    autoComplete: string,
    maxLength: number,
  ) => (
    <Field label={t(`profile.${key}`)} error={errors[key]}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          name={key}
          value={v[key]}
          onChange={(e) => setV({ ...v, [key]: e.target.value })}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          dir={key === 'postalCode' ? 'ltr' : undefined}
          inputMode={key === 'postalCode' && v.country === 'DE' ? 'numeric' : undefined}
          maxLength={maxLength}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h3 className="font-semibold">{t('profile.completeTitle')}</h3>
      <Text muted>{t('profile.completeIntro')}</Text>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('firstName', 'given-name', 60)}
        {field('lastName', 'family-name', 60)}
      </div>
      {field('street', 'street-address', 100)}
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        {field('postalCode', 'postal-code', 10)}
        {field('city', 'address-level2', 60)}
      </div>
      <Field label={t('profile.country')}>
        {({ id }) => (
          <Select
            id={id}
            value={v.country}
            onChange={(e) => setV({ ...v, country: e.target.value })}
            autoComplete="country"
            className="max-w-xs"
          >
            <option value="DE">{t('profile.countryDE')}</option>
            <option value="AT">{t('profile.countryAT')}</option>
            <option value="CH">{t('profile.countryCH')}</option>
          </Select>
        )}
      </Field>
      <Text muted className="text-sm">
        {t('profile.privacyNote')}
      </Text>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" size="lg" busy={busy} className="sm:w-fit">
        {t('profile.save')}
      </Button>
    </form>
  );
}

/**
 * Checkout, after the profile and the mobile number: without name and address the profile form comes
 * first, then the verified mobile number (required for the escalation SMS; the API answers
 * `profile_incomplete` / `phone_required` otherwise), then the order itself.
 */
export function CheckoutForm() {
  const [profile, setProfile] = useState<ProfileSummary | null | 'unknown'>(null);
  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);
  useEffect(() => {
    let live = true;
    void api<ProfileSummary>('/v1/me/profile', { method: 'GET' })
      .then((p) => live && setProfile(p))
      // The API still refuses the checkout without profile or number, and the form then says why.
      .catch(() => live && setProfile('unknown'));
    return () => {
      live = false;
    };
  }, [version]);
  if (profile === null) return null;
  if (profile !== 'unknown' && !profile.complete) return <ProfileForm onSaved={load} />;
  if (profile !== 'unknown' && !profile.phoneVerified)
    return <PhoneSetup phone={null} onVerified={load} headingLevel={3} embedded />;
  return <Checkout phone={profile === 'unknown' ? null : profile.phone} />;
}

/**
 * § 312j BGB checkout: summary with price, term and the renewal rule from the server's configuration,
 * the immediate-start declaration exactly as stored (versioned, its hash is recorded with the order),
 * and the button „Zahlungspflichtig bestellen“, disabled until the declaration is ticked.
 * After an ended subscription it first asks whether the old sticker is still on the car.
 */
function Checkout({ phone }: { phone: string | null }) {
  const { t, locale } = useI18n();
  const euro = useEuro();
  const price = euro(usePlanPrice());
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
      plan: 'standard',
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
        <p className="text-2xl font-bold">{t('checkout.pricePlan', { price })}</p>
        <Text>{t('checkout.summaryTerm')}</Text>
        <div className="mt-2">
          <PlanFeatures />
        </div>
        {phone && (
          <Text muted className="mt-2 wrap-anywhere">
            {t('checkout.phoneStepDone', { phone })}
          </Text>
        )}
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
      {/* TODO [LEGAL REVIEW] § 312j (3) BGB button label with the price. */}
      <Button type="submit" size="lg" busy={busy} disabled={!immediate} className="sm:w-fit">
        {t('checkout.payPrice', { price })}
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
