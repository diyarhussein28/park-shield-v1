'use client';

import { Badge, Notice, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { useNeedsPhone } from '@/components/konto-access';
import { KontoShell, Section } from '@/components/konto-shell';
import { api } from '@/lib/api-client';
import type {
  ChannelsOverview,
  Me,
  Protection,
  SubscriptionSummary,
  Vehicle,
} from '@/lib/api-server';
import { PhoneSetup } from '@/components/phone-setup';
import { cx } from '@/lib/cx';
import { LOCALE_COOKIE } from '@/lib/locale-cookie';
import { usePendingClaim } from '@/lib/pending-claim';
import { useAddVehicle, VehicleForm } from './fahrzeuge/vehicles-view';
import { CheckoutForm, PastDue, SubscriptionInfo } from './parts';
import { NoActiveCode } from './no-active-code';
import { QrCard } from './qr-card';

export function AccountView({
  me,
  subscription,
  vehicles,
  channels,
  protection,
  checkout,
  sessionId,
}: {
  me: Me;
  subscription: SubscriptionSummary | null;
  vehicles: Vehicle[];
  channels: ChannelsOverview | null;
  protection: Protection | null;
  checkout?: 'success' | 'canceled';
  sessionId?: string;
}) {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();

  // A new device has no language cookie yet: use the language stored in the profile.
  useEffect(() => {
    if (!document.cookie.includes(`${LOCALE_COOKIE}=`) && me.preferredLang !== locale) {
      setLocale(me.preferredLang);
    }
    // Only once, on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pending = usePendingClaim();
  const needsPhone = useNeedsPhone();
  const [vehicleList, setVehicles] = useState(vehicles);
  const [channelData, setChannels] = useState(channels);
  const [score, setScore] = useState(protection);
  const refresh = async () => {
    const [c, p] = await Promise.all([
      api<ChannelsOverview>('/v1/channels'),
      api<Protection>('/v1/me/protection'),
    ]);
    setChannels(c);
    setScore(p);
  };

  // Back from Stripe (or a paid checkout whose return was lost): ask the API to confirm the payment
  // with Stripe right away instead of waiting for the webhook, then reload with the subscription.
  const [confirming, setConfirming] = useState<'idle' | 'busy' | 'failed'>(
    checkout === 'success' && !subscription ? 'busy' : 'idle',
  );
  useEffect(() => {
    if (subscription) return;
    let cancelled = false;
    let tries = 0;
    const attempt = async () => {
      const r = await api<{ status: 'active' | 'pending' }>('/v1/billing/checkout/confirm', {
        body: sessionId ? { sessionId } : {},
      }).catch(() => ({ status: 'pending' as const }));
      if (cancelled) return;
      if (r.status === 'active') {
        router.refresh();
        return;
      }
      // Right after the redirect Stripe may still be finishing: try a few more times.
      if (checkout === 'success' && ++tries < 6) setTimeout(() => void attempt(), 2000);
      else if (checkout === 'success') setConfirming('failed');
    };
    void attempt();
    return () => {
      cancelled = true;
    };
  }, [checkout, sessionId, subscription, router]);

  return (
    <KontoShell title={t('account.title')} intro={t('account.signedInAs', { email: me.email })}>
      {!subscription && confirming === 'busy' && (
        <Notice tone="info" title={t('account.checkoutSuccess')}>
          {t('account.confirming')}
        </Notice>
      )}
      {!subscription && confirming === 'failed' && (
        <Notice tone="warning">{t('account.confirmFailed')}</Notice>
      )}
      {checkout === 'success' && subscription && (
        <Notice tone="success" title={t('account.welcomeTitle')}>
          {t('account.welcomeText')}
        </Notice>
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

      {subscription && needsPhone ? (
        <>
          {subscription.status === 'past_due' && <PastDue />}
          <CompleteAccount onDone={() => router.refresh()} />
        </>
      ) : subscription ? (
        <>
          {subscription.status === 'past_due' && <PastDue />}
          {vehicleList
            .filter((v) => !v.decal)
            .map((v) => (
              <NoActiveCode
                key={v.id}
                vehicle={v}
                onCreated={(nv) =>
                  setVehicles((list) => list.map((x) => (x.id === nv.id ? nv : x)))
                }
              />
            ))}
          {score && (
            <SetupGuide
              protection={score}
              vehicles={vehicleList}
              channels={channelData}
              onVehicleAdded={(v) => setVehicles((list) => [...list, v])}
              onChannelsChanged={refresh}
            />
          )}
          {vehicleList.length > 0 && <QrCodes vehicles={vehicleList} />}
          <div className="grid gap-6 xl:grid-cols-2">
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
          <QuickLinks channels={channelData} />
        </>
      ) : (
        <>
          {confirming !== 'busy' && <GetStarted />}
          {confirming !== 'busy' && (
            <Section
              id="checkout"
              title={t('account.subscription')}
              icon="card"
              className="scroll-mt-6"
            >
              <CheckoutForm />
            </Section>
          )}
        </>
      )}
    </KontoShell>
  );
}

/** The heart of the portal: every vehicle's QR code, ready to download. */
function QrCodes({ vehicles }: { vehicles: Vehicle[] }) {
  const { t } = useI18n();
  return (
    <Section title={t('portal.qrTitle')} icon="qr" intro={t('portal.qrIntro')}>
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

type StepKey = 'vehicle' | 'app' | 'phone' | 'decal';

/**
 * OW-14 / US-28 as a guided set-up: the protection score (four steps of 25 %, computed by the API:
 * e-mail, app push, verified mobile number, decal tested) on top, then the steps in the order a new
 * owner does them. The first open step is expanded with its form right here.
 */
function SetupGuide({
  protection,
  vehicles,
  channels,
  onVehicleAdded,
  onChannelsChanged,
}: {
  protection: Protection;
  vehicles: Vehicle[];
  channels: ChannelsOverview | null;
  onVehicleAdded: (v: Vehicle) => void;
  onChannelsChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [formKey, setFormKey] = useState(0);
  const { add, error } = useAddVehicle((v) => {
    onVehicleAdded(v);
    setFormKey((k) => k + 1);
  });
  const first = vehicles[0] ?? null;
  const steps: { key: StepKey; done: boolean; title: string; href?: string; go?: string }[] = [
    { key: 'vehicle', done: vehicles.length > 0, title: t('setup.vehicleTitle') },
    {
      key: 'app',
      done: protection.steps.channel,
      title: t('protection.stepChannel'),
      href: '/konto/benachrichtigungen',
      go: t('protection.goApp'),
    },
    {
      key: 'phone',
      done: protection.steps.phone,
      title: t('protection.stepPhone'),
      href: '/konto/benachrichtigungen',
      go: t('protection.goPhone'),
    },
    {
      key: 'decal',
      done: protection.steps.decal,
      title: t('protection.stepDecal'),
      href: first ? `/konto/fahrzeuge/${first.id}` : '/konto/fahrzeuge',
      go: t('protection.goDecal'),
    },
  ];
  const current = steps.find((s) => !s.done)?.key ?? null;
  const complete = protection.percent === 100 && vehicles.length > 0;
  const openCount = steps.filter((s) => !s.done).length;

  const body: Record<StepKey, ReactNode> = {
    vehicle: (
      <>
        <p className="text-muted">{t('setup.vehicleText')}</p>
        <VehicleForm key={formKey} submitLabel={t('portal.createQr')} onSubmit={add} />
        {error && <Notice tone="warning">{error}</Notice>}
      </>
    ),
    app: (
      <>
        <p className="text-muted">{t('setup.appText')}</p>
        <p className="text-sm text-muted">{t('setup.appDone')}</p>
      </>
    ),
    phone: (
      <PhoneSetup
        phone={channels?.sms?.phone ?? null}
        onVerified={onChannelsChanged}
        headingLevel={3}
        embedded
      />
    ),
    decal: (
      <>
        <p className="text-muted">{t('setup.decalText')}</p>
        <div className="flex flex-wrap gap-2">
          {first?.decal && (
            <a
              href={`/v1/vehicles/${first.id}/decal.pdf`}
              download
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-border-strong px-4 font-semibold hover:border-primary"
            >
              <Icon name="download" className="size-5" />
              {t('portal.downloadPdf')}
            </a>
          )}
          <Link
            href={first ? `/konto/fahrzeuge/${first.id}` : '/konto/fahrzeuge'}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-fg hover:bg-primary-hover"
          >
            {t('setup.decalButton')}
            <Icon name="arrowRight" className="size-5" />
          </Link>
        </div>
      </>
    ),
  };

  return (
    <Section
      title={t('protection.title')}
      icon="shieldCheck"
      intro={complete ? t('setup.allDone') : t('setup.intro', { count: openCount })}
      aside={
        <Badge tone={complete ? 'success' : 'warning'}>
          {complete ? t('protection.complete') : t('protection.incomplete')}
        </Badge>
      }
      className={complete ? undefined : 'border-2 border-primary'}
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
      <ol className="flex flex-col gap-3">
        {steps.map((s, i) => {
          const open = s.key === current;
          return (
            <li
              key={s.key}
              aria-current={open ? 'step' : undefined}
              className={cx(
                'rounded-2xl border p-4',
                open ? 'border-primary bg-bg' : 'border-border',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cx(
                      'grid size-8 shrink-0 place-items-center rounded-full border-2 font-bold',
                      s.done
                        ? 'border-success-fg bg-success-bg text-success-fg'
                        : open
                          ? 'border-primary bg-primary text-primary-fg'
                          : 'border-border-strong text-muted',
                    )}
                  >
                    {s.done ? <Icon name="check" className="size-4" /> : i + 1}
                  </span>
                  <span className={cx('min-w-0 font-semibold', s.done && 'text-muted')}>
                    {s.title}
                    <span className="sr-only">
                      : {s.done ? t('protection.done') : t('protection.todo')}
                    </span>
                  </span>
                </span>
                {!s.done && !open && s.href && (
                  <Link href={s.href} className="ml-11 font-semibold text-primary underline">
                    {s.go}
                  </Link>
                )}
              </div>
              {open && <div className="mt-4 flex flex-col gap-4 sm:ml-11">{body[s.key]}</div>}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function Steps({
  steps,
}: {
  steps: { icon: IconName; title: string; text: string; href?: string; go?: string }[];
}) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {steps.map((s, i) => {
        const content = (
          <>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary font-bold text-primary-fg">
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 font-semibold">
                <Icon name={s.icon} className="size-5 shrink-0 text-primary" />
                <span className="min-w-0">{s.title}</span>
              </h3>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
              {s.go && (
                <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  {s.go}
                  <Icon name="arrowRight" className="size-4" />
                </span>
              )}
            </div>
          </>
        );
        return (
          <li key={s.title} className="flex">
            {s.href ? (
              // The whole card is the target: tapping "Choose your plan" jumps to the order form.
              <a
                href={s.href}
                className="flex w-full gap-3 rounded-2xl border-2 border-transparent bg-secondary/40 p-4 hover:border-primary focus-visible:border-primary"
              >
                {content}
              </a>
            ) : (
              <div className="flex w-full gap-3 rounded-2xl bg-secondary/40 p-4">{content}</div>
            )}
          </li>
        );
      })}
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
          {
            icon: 'card',
            title: t('portal.start1Title'),
            text: t('portal.start1Text'),
            href: '#checkout',
            go: t('portal.start1Go'),
          },
          { icon: 'qr', title: t('portal.start2Title'), text: t('portal.start2Text') },
          { icon: 'check', title: t('portal.start3Title'), text: t('portal.start3Text') },
        ]}
      />
    </Section>
  );
}

function QuickLinks({ channels }: { channels: ChannelsOverview | null }) {
  const { t } = useI18n();
  const tiles: { href: string; icon: IconName; title: string; text: string }[] = [
    {
      href: '/konto/fahrzeuge',
      icon: 'car',
      title: t('vehicles.manage'),
      text: t('portal.vehiclesText'),
    },
    {
      href: '/konto/benachrichtigungen',
      icon: 'bell',
      title: t('channels.manage'),
      text: t('channels.summaryApp', {
        app: channels?.app.devices.length ?? 0,
        phone: channels?.sms ? 'yes' : 'no',
      }),
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

/**
 * „Konto vervollständigen“ for accounts from before 2026-11-21: the mobile number is required for the
 * escalation SMS. The overview shows only this step until it is done; alerts are never blocked.
 */
function CompleteAccount({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  return (
    <Section
      title={t('portal.completeTitle')}
      icon="phone"
      intro={t('portal.completePhoneIntro')}
      className="border-2 border-primary"
    >
      <PhoneSetup phone={null} onVerified={onDone} headingLevel={3} embedded />
    </Section>
  );
}
