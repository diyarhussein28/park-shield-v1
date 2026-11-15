'use client';

import { Badge, Notice, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { KontoShell, Section } from '@/components/konto-shell';
import { api } from '@/lib/api-client';
import type { Me, Protection, SubscriptionSummary, Vehicle } from '@/lib/api-server';
import { cx } from '@/lib/cx';
import { usePendingClaim } from '@/lib/pending-claim';
import { useAddVehicle, VehicleForm } from './fahrzeuge/vehicles-view';
import { CheckoutForm, PastDue, SubscriptionInfo } from './parts';
import { QrCard } from './qr-card';

export function AccountView({
  me,
  subscription,
  vehicles,
  channels,
  contactCount,
  protection,
  checkout,
}: {
  me: Me;
  subscription: SubscriptionSummary | null;
  vehicles: Vehicle[];
  channels: { push: number; whatsapp: boolean };
  contactCount: number;
  protection: Protection | null;
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

  return (
    <KontoShell title={t('account.title')} intro={t('account.signedInAs', { email: me.email })}>
      {checkout === 'success' && !subscription && (
        <Notice tone="info">{t('account.checkoutSuccess')}</Notice>
      )}
      {checkout === 'canceled' && <Notice tone="warning">{t('account.checkoutCanceled')}</Notice>}
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

      {subscription ? (
        <>
          {subscription.status === 'past_due' && <PastDue />}
          <QrCodes initial={vehicles} />
          <div className="grid gap-6 xl:grid-cols-2">
            {protection && (
              <ProtectionCard protection={protection} firstVehicleId={vehicles[0]?.id ?? null} />
            )}
            <Section title={t('account.subscription')} icon="card">
              <SubscriptionInfo sub={subscription} />
              <Link
                href="/konto/abo"
                className="inline-flex min-h-12 w-fit items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
              >
                {t('portal.planManage')}
                <Icon name="arrowRight" className="size-4" />
              </Link>
            </Section>
          </div>
          <HowScanningWorks />
          <QuickLinks channels={channels} contactCount={contactCount} />
        </>
      ) : (
        <>
          <GetStarted />
          <Section title={t('account.subscription')} icon="card">
            <CheckoutForm />
          </Section>
        </>
      )}
    </KontoShell>
  );
}

/** The heart of the portal: every vehicle's QR code, ready to download, or the form that creates it. */
function QrCodes({ initial }: { initial: Vehicle[] }) {
  const { t } = useI18n();
  const [vehicles, setVehicles] = useState(initial);
  const [formKey, setFormKey] = useState(0);
  const { add, error } = useAddVehicle((v) => {
    setVehicles((list) => [...list, v]);
    setFormKey((k) => k + 1);
  });

  const manage = (
    <Link
      href="/konto/fahrzeuge"
      className="inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-border-strong px-4 font-semibold hover:border-primary"
    >
      {t('vehicles.manage')}
    </Link>
  );

  if (vehicles.length === 0) {
    return (
      <Section
        title={t('portal.firstVehicleTitle')}
        icon="qr"
        intro={t('portal.firstVehicleText')}
        aside={manage}
        className="border-2 border-primary"
      >
        <VehicleForm key={formKey} submitLabel={t('portal.createQr')} onSubmit={add} />
        {error && <Notice tone="warning">{error}</Notice>}
      </Section>
    );
  }

  return (
    <Section title={t('portal.qrTitle')} icon="qr" intro={t('portal.qrIntro')} aside={manage}>
      <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {vehicles.map((v) => (
          <li key={v.id}>
            <QrCard vehicle={v} />
          </li>
        ))}
      </ul>
    </Section>
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
    <Section
      title={t('protection.title')}
      icon="shieldCheck"
      aside={
        <Badge tone={complete ? 'success' : 'warning'}>
          {complete ? t('protection.complete') : t('protection.incomplete')}
        </Badge>
      }
    >
      <div>
        <p className="mb-2 font-semibold">
          {t('protection.percent', { percent: protection.percent })}
        </p>
        <div
          role="progressbar"
          aria-label={t('protection.title')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={protection.percent}
          className="h-3 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${protection.percent}%` }}
          />
        </div>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className={cx(
                  'grid size-7 shrink-0 place-items-center rounded-full border-2',
                  s.done
                    ? 'border-success-fg bg-success-bg text-success-fg'
                    : 'border-border-strong text-muted',
                )}
              >
                {s.done && <Icon name="check" className="size-4" />}
              </span>
              <span className={cx('min-w-0', s.done && 'text-muted')}>
                {s.label}
                <span className="sr-only">
                  : {s.done ? t('protection.done') : t('protection.todo')}
                </span>
              </span>
            </span>
            {!s.done && s.href && (
              <Link href={s.href} className="ml-10 font-semibold text-primary underline">
                {s.go}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Steps({ steps }: { steps: { icon: IconName; title: string; text: string }[] }) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3 rounded-2xl bg-secondary/40 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary font-bold text-primary-fg">
            {i + 1}
          </span>
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-semibold">
              <Icon name={s.icon} className="size-5 shrink-0 text-primary" />
              <span className="min-w-0">{s.title}</span>
            </h3>
            <p className="mt-1 text-sm text-muted">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Answers "what happens when someone scans my code?" in three plain steps. */
function HowScanningWorks() {
  const { t } = useI18n();
  return (
    <Section title={t('portal.howTitle')} icon="scan" intro={t('portal.howIntro')}>
      <Steps
        steps={[
          { icon: 'qr', title: t('portal.how1Title'), text: t('portal.how1Text') },
          { icon: 'phone', title: t('portal.how2Title'), text: t('portal.how2Text') },
          { icon: 'bell', title: t('portal.how3Title'), text: t('portal.how3Text') },
        ]}
      />
    </Section>
  );
}

function GetStarted() {
  const { t } = useI18n();
  return (
    <Section title={t('portal.startTitle')} icon="shield" intro={t('portal.startIntro')}>
      <Steps
        steps={[
          { icon: 'card', title: t('portal.start1Title'), text: t('portal.start1Text') },
          { icon: 'qr', title: t('portal.start2Title'), text: t('portal.start2Text') },
          { icon: 'check', title: t('portal.start3Title'), text: t('portal.start3Text') },
        ]}
      />
    </Section>
  );
}

function QuickLinks({
  channels,
  contactCount,
}: {
  channels: { push: number; whatsapp: boolean };
  contactCount: number;
}) {
  const { t } = useI18n();
  const tiles: { href: string; icon: IconName; title: string; text: string }[] = [
    {
      href: '/konto/benachrichtigungen',
      icon: 'bell',
      title: t('channels.manage'),
      text: t('channels.summary', {
        push: channels.push,
        whatsapp: channels.whatsapp ? 'yes' : 'no',
      }),
    },
    {
      href: '/konto/notfallkontakte',
      icon: 'users',
      title: t('contacts.manage'),
      text: t('contacts.summary', { count: contactCount }),
    },
    {
      href: '/konto/verlauf',
      icon: 'clock',
      title: t('history.manage'),
      text: t('portal.historyText'),
    },
    {
      href: '/konto/zustellung',
      icon: 'alert',
      title: t('deliveryHelp.link'),
      text: t('portal.deliveryText'),
    },
    {
      href: '/konto/daten',
      icon: 'database',
      title: t('privacy.manage'),
      text: t('portal.dataText'),
    },
  ];
  return (
    <section aria-labelledby="quick-links">
      <h2 id="quick-links" className="mb-3 text-xl font-bold tracking-tight">
        {t('portal.quickTitle')}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <li
            key={tile.href}
            className="relative flex gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:border-primary"
          >
            <Icon name={tile.icon} className="mt-0.5 size-6 shrink-0 text-primary" />
            <div className="min-w-0">
              {/* The ::after layer makes the whole tile clickable; the name stays the short title. */}
              <Link
                href={tile.href}
                className="font-semibold after:absolute after:inset-0 after:rounded-2xl"
              >
                {tile.title}
              </Link>
              <p className="mt-1 text-sm text-muted">{tile.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
