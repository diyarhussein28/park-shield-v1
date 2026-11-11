'use client';

import {
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  Field,
  Heading,
  Input,
  Notice,
  Select,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api, errorText } from '@/lib/api-client';
import type {
  CreditNote,
  InvoiceSummary,
  Me,
  Protection,
  SubscriptionSummary,
} from '@/lib/api-server';
import { usePendingClaim } from '@/lib/pending-claim';
import { useBrowserValue } from '@/lib/use-browser-value';

const PLAN_LABEL = { plus: 'Plus', premium: 'Premium' } as const;

export function AccountView({
  me,
  subscription,
  invoices,
  vehicleCount,
  channels,
  contactCount,
  protection,
  firstVehicleId,
  checkout,
  creditNotes = [],
}: {
  creditNotes?: CreditNote[];
  contactCount: number;
  protection: Protection | null;
  firstVehicleId: string | null;
  me: Me;
  subscription: SubscriptionSummary | null;
  invoices: InvoiceSummary[];
  vehicleCount: number;
  channels: { push: number; whatsapp: boolean };
  checkout?: 'success' | 'canceled';
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const shownLocale = useRef(locale);
  const pending = usePendingClaim();

  // When the person switches language here, e-mails follow (only on an actual switch, not on first render).
  useEffect(() => {
    if (locale === shownLocale.current) return;
    shownLocale.current = locale;
    void api('/v1/me', { method: 'PATCH', body: { preferredLang: locale } });
  }, [locale]);

  // After Stripe redirects back, the subscription appears once the payment event has been processed.
  useEffect(() => {
    if (checkout !== 'success' || subscription) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 20) clearInterval(timer);
      router.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [checkout, subscription, router]);

  async function logout() {
    await api('/v1/auth/logout', { body: {} });
    router.push('/');
    router.refresh();
  }

  async function paymentMethod() {
    const { url } = await api<{ url: string }>('/v1/billing/portal', { body: {} });
    window.location.assign(url);
  }

  return (
    <PageShell>
      <Container className="py-10">
        <Stack gap={6}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Heading level={1}>{t('account.title')}</Heading>
              <Text muted>{t('account.signedInAs', { email: me.email })}</Text>
            </div>
            <Button variant="secondary" onClick={logout}>
              {t('account.logout')}
            </Button>
          </div>

          {subscription && protection && (
            <ProtectionCard protection={protection} firstVehicleId={firstVehicleId} />
          )}

          {checkout === 'success' && !subscription && (
            <Notice tone="info">{t('account.checkoutSuccess')}</Notice>
          )}
          {pending && (
            <Notice tone="info" title={t('claim.pendingTitle')}>
              {subscription ? t('claim.pendingReady') : t('claim.pendingPay')}{' '}
              {subscription && (
                <Link href="/aktivieren" className="font-semibold underline">
                  {t('claim.pendingLink')}
                </Link>
              )}
            </Notice>
          )}
          {checkout === 'canceled' && (
            <Notice tone="warning">{t('account.checkoutCanceled')}</Notice>
          )}

          <Card>
            <Stack gap={3}>
              <Heading level={2} className="text-xl">
                {t('account.subscription')}
              </Heading>
              {subscription?.status === 'past_due' && (
                <Notice tone="warning">{t('account.pastDueNotice')}</Notice>
              )}
              {subscription ? <SubscriptionInfo sub={subscription} /> : <CheckoutForm />}
              {subscription && (
                <Button variant="secondary" onClick={paymentMethod} className="w-fit">
                  {t('account.paymentMethod')}
                </Button>
              )}
            </Stack>
          </Card>

          {subscription && (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Heading level={2} className="text-xl">
                  {t('vehicles.title')}
                </Heading>
                <Text muted>{t('vehicles.summary', { count: vehicleCount })}</Text>
              </div>
              <Link
                href="/konto/fahrzeuge"
                className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
              >
                {t('vehicles.manage')}
              </Link>
            </Card>
          )}

          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Heading level={2} className="text-xl">
                {t('channels.title')}
              </Heading>
              <Text muted>
                {t('channels.summary', {
                  push: channels.push,
                  whatsapp: channels.whatsapp ? 'yes' : 'no',
                })}
              </Text>
            </div>
            <Link
              href="/konto/benachrichtigungen"
              className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
            >
              {t('channels.manage')}
            </Link>
          </Card>

          <Card>
            <Stack gap={2}>
              <Heading level={2} className="text-xl">
                {t('history.title')}
              </Heading>
              <ul className="flex flex-col gap-1">
                <li>
                  <Link href="/konto/verlauf" className="text-primary underline">
                    {t('history.manage')}
                  </Link>
                </li>
                <li>
                  <Link href="/konto/zustellung" className="text-primary underline">
                    {t('deliveryHelp.link')}
                  </Link>
                </li>
                <li>
                  <Link href="/konto/daten" className="text-primary underline">
                    {t('privacy.manage')}
                  </Link>
                </li>
                <li>
                  <Link href="/hilfe" className="text-primary underline">
                    {t('help.accountLink')}
                  </Link>
                </li>
              </ul>
            </Stack>
          </Card>

          {subscription && (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Heading level={2} className="text-xl">
                  {t('contacts.title')}
                </Heading>
                <Text muted>{t('contacts.summary', { count: contactCount })}</Text>
              </div>
              <Link
                href="/konto/notfallkontakte"
                className="inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
              >
                {t('contacts.manage')}
              </Link>
            </Card>
          )}

          <Card>
            <Stack gap={3}>
              <Heading level={2} className="text-xl">
                {t('account.invoices')}
              </Heading>
              {invoices.length === 0 ? (
                <Text muted>{t('account.noInvoices')}</Text>
              ) : (
                <ul className="flex flex-col gap-2">
                  {invoices.map((i) => (
                    <li key={i.id}>
                      {i.pdfUrl ? (
                        <a
                          className="text-primary underline"
                          href={i.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('account.invoiceLink', {
                            number: i.number,
                            date: new Date(i.createdAt),
                          })}
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
                  <Heading level={3} className="text-base">
                    {t('account.creditNotes')}
                  </Heading>
                  <ul className="flex flex-col gap-2" aria-label={t('account.creditNotes')}>
                    {creditNotes.map((c) => (
                      <li key={c.id}>
                        <a
                          className="text-primary underline"
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
            </Stack>
          </Card>

          {subscription && <SummarySettings initial={me.summaryFrequency} />}

          <Passkeys initial={me.passkeys} />

          {subscription && !subscription.cancelAtPeriodEnd && (
            <Card>
              <Stack gap={3}>
                <Heading level={2} className="text-xl">
                  {t('account.cancelTitle')}
                </Heading>
                <Text>{t('account.cancelText')}</Text>
                <Link
                  href="/kuendigen"
                  className="inline-flex min-h-12 w-fit items-center rounded-xl border-2 border-fg px-4 font-semibold"
                >
                  {t('common.footer.cancelContract')}
                </Link>
              </Stack>
            </Card>
          )}
        </Stack>
      </Container>
    </PageShell>
  );
}

/** OW-14 / US-28: four steps of 25 %, computed by the API from what is actually set up. */
function ProtectionCard({
  protection,
  firstVehicleId,
}: {
  protection: Protection;
  firstVehicleId: string | null;
}) {
  const { t } = useI18n();
  const steps = [
    { key: 'email', done: protection.steps.email, label: t('protection.stepEmail') },
    {
      key: 'channel',
      done: protection.steps.channel,
      label: t('protection.stepChannel'),
      href: '/konto/benachrichtigungen',
      go: t('protection.goChannel'),
    },
    {
      key: 'contact',
      done: protection.steps.contact,
      label: t('protection.stepContact'),
      href: '/konto/notfallkontakte',
      go: t('protection.goContact'),
    },
    {
      key: 'decal',
      done: protection.steps.decal,
      label: t('protection.stepDecal'),
      href: firstVehicleId ? `/konto/fahrzeuge/${firstVehicleId}` : '/konto/fahrzeuge',
      go: t('protection.goDecal'),
    },
  ];
  const complete = protection.percent === 100;
  return (
    <Card>
      <Stack gap={3}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Heading level={2} className="text-xl">
            {t('protection.title')}
          </Heading>
          <Badge tone={complete ? 'success' : 'warning'}>
            {complete ? t('protection.complete') : t('protection.incomplete')}
          </Badge>
        </div>
        <div>
          <p className="mb-1 font-semibold">
            {t('protection.percent', { percent: protection.percent })}
          </p>
          <div
            role="progressbar"
            aria-label={t('protection.title')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={protection.percent}
            className="h-3 w-full overflow-hidden rounded-full bg-surface"
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${protection.percent}%` }}
            />
          </div>
        </div>
        <ol className="flex flex-col gap-2">
          {steps.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span aria-hidden="true">{s.done ? '✓' : '○'} </span>
                {s.label}
                <span className="sr-only">
                  : {s.done ? t('protection.done') : t('protection.todo')}
                </span>
              </span>
              {!s.done && s.href && (
                <Link href={s.href} className="text-primary underline">
                  {s.go}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </Stack>
    </Card>
  );
}

function SummarySettings({ initial }: { initial: Me['summaryFrequency'] }) {
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
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('summarySettings.title')}
        </Heading>
        <Text>{t('summarySettings.intro')}</Text>
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
      </Stack>
    </Card>
  );
}

function SubscriptionInfo({ sub }: { sub: SubscriptionSummary }) {
  const { t } = useI18n();
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  return (
    <Stack gap={2}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-semibold">
          {t('account.planName', { plan: PLAN_LABEL[sub.plan] })}
        </span>
        <Badge tone={sub.status === 'active' ? 'success' : 'warning'}>
          {sub.status === 'active' ? t('account.statusActive') : t('account.statusPastDue')}
        </Badge>
      </div>
      {sub.contractNo && <Text>{t('account.contractNo', { contractNo: sub.contractNo })}</Text>}
      {end && (
        <Text muted>
          {sub.cancelAtPeriodEnd
            ? t('account.endsOn', { date: end })
            : t('account.renewsOn', { date: end })}
        </Text>
      )}
    </Stack>
  );
}

function CheckoutForm() {
  const { t } = useI18n();
  const pending = usePendingClaim();
  const [typed, setPromo] = useState<string | null>(null);
  // A partner decal brings its promo code along (AD-07); the person may still change it.
  const promo = typed ?? pending?.promoCode ?? '';
  const [immediate, setImmediate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRequired, setShowRequired] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!immediate) {
      setShowRequired(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/v1/billing/checkout', {
        body: {
          plan: 'plus',
          immediateStart: true,
          ...(promo.trim() ? { promoCode: promo.trim() } : {}),
        },
      });
      window.location.assign(url);
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Text muted>{t('account.noSubscription')}</Text>
      <p className="text-lg font-semibold">{t('checkout.priceLine')}</p>
      <Field label={t('checkout.promoLabel')} optionalLabel={t('common.optional')}>
        {({ id }) => (
          <Input
            id={id}
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
            autoComplete="off"
            maxLength={40}
          />
        )}
      </Field>
      <Checkbox
        label={t('checkout.immediateStart')}
        checked={immediate}
        onChange={(e) => {
          setImmediate(e.target.checked);
          setShowRequired(false);
        }}
        aria-describedby={showRequired ? 'immediate-required' : undefined}
      />
      {showRequired && (
        <p id="immediate-required" className="font-semibold text-danger-text" role="alert">
          {t('checkout.immediateRequired')}
        </p>
      )}
      <Text className="text-sm">
        {t('checkout.withdrawalNotice')}{' '}
        <Link className="underline" href="/widerruf">
          {t('checkout.withdrawalLink')}
        </Link>
        . {t('checkout.termsNotice')}{' '}
        <Link className="underline" href="/agb">
          {t('common.footer.terms')}
        </Link>{' '}
        ·{' '}
        <Link className="underline" href="/datenschutz">
          {t('common.footer.privacy')}
        </Link>
      </Text>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" size="lg" busy={busy}>
        {t('checkout.pay')}
      </Button>
    </form>
  );
}

function Passkeys({ initial }: { initial: Me['passkeys'] }) {
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
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('account.passkeys')}
        </Heading>
        <Text>{t('account.passkeysIntro')}</Text>
        {list.length === 0 ? (
          <Text muted>{t('account.noPasskeys')}</Text>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
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
      </Stack>
    </Card>
  );
}
