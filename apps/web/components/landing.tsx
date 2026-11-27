'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  LIFETIME_PRICE_CENTS,
  lifetimeCheaperFromYear,
  PLAN_FEATURE_COUNT,
  PLAN_PRICE_CENTS,
} from '@parkshield/shared';
import { useI18n } from '@parkshield/ui';
import Image, { type StaticImageData } from 'next/image';
import Link from 'next/link';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import cityNight from '@/assets/photos/city-night.jpg';
import cityTraffic from '@/assets/photos/city-traffic.jpg';
import dashboardLights from '@/assets/photos/dashboard-lights.jpg';
import garageBlocked from '@/assets/photos/garage-blocked.jpg';
import streetParking from '@/assets/photos/street-parking.jpg';
import windscreenWeather from '@/assets/photos/windscreen-weather.jpg';
import { cx } from '@/lib/cx';
import { LogoMark } from './brand/logo';
import { Icon, type IconName } from './icons';
import { LandingDemo } from './landing-demo';
import { useReveal } from './reveal';
import { PageShell, WIDE } from './site-chrome';

/*
 * The home page in the dark navy design (owner mockups 2026-11-27): one dark page (`ps-dark` tokens),
 * yellow calls to action, the real printed sticker in every part, the animated demo and the scroll
 * reveal kept. Pricing stays one card with the Lifetime button under it (owner decision 2026-11-26).
 */

const keys = <P extends string>(prefix: P, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}` as MessageKey);

/** Euro with cents („19,99 €“) where the amount has them, „10 €“ otherwise. */
function useEuro() {
  const { locale } = useI18n();
  return (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
}

const btn =
  'group inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 font-bold transition duration-200';
const btnYellow = `${btn} bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/25 hover:-translate-y-0.5 hover:bg-amber-300`;
const btnGhost = `${btn} border-2 border-white/40 text-white hover:border-white hover:bg-white/10`;

/** Scroll-revealed block; `delay` staggers siblings (ms). */
function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'li';
}) {
  return (
    <Tag
      data-reveal=""
      className={className}
      style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

function SectionHead({
  id,
  eyebrow,
  title,
  text,
  center,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  text?: string;
  center?: boolean;
}) {
  return (
    <Reveal className={cx('mb-10 flex max-w-2xl flex-col gap-3', center && 'mx-auto text-center')}>
      {eyebrow && (
        <p className="text-sm font-bold uppercase tracking-widest text-amber-300">{eyebrow}</p>
      )}
      <h2 id={id} className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {text && <p className="text-lg text-muted">{text}</p>}
    </Reveal>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300',
        className,
      )}
    >
      <Icon name="check" className="size-3.5" strokeWidth={3} />
    </span>
  );
}

function FeatureList({ items }: { items: MessageKey[] }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((k) => (
        <li key={k} className="flex gap-2.5">
          <Check />
          <span>{t(k)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The blue wave between two dark parts of the page (decoration only). */
function Wave({ flip }: { flip?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 60"
      preserveAspectRatio="none"
      className={cx('block h-8 w-full text-blue-600 sm:h-12', flip && 'rotate-180')}
    >
      <path
        d="M0 38C240 8 480 4 720 22s480 30 720 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
      />
      <path
        d="M0 50C260 22 500 20 740 36s460 22 700 0"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="3"
      />
    </svg>
  );
}

/** „19,99 € / Jahr“ with the amount set large. */
function PriceTag({ className }: { className?: string }) {
  const { t } = useI18n();
  const price = useEuro()(PLAN_PRICE_CENTS);
  const text = t('landing.heroPrice', { price });
  const at = text.indexOf(price);
  return (
    <p className={cx('flex flex-wrap items-baseline gap-x-2', className)}>
      <span>
        {at > 0 && text.slice(0, at)}
        <span className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          {price}
        </span>
        <span className="text-xl text-slate-200">{text.slice(at + price.length)}</span>
      </span>
      <span className="text-sm text-slate-300">{t('landing.heroPriceNote')}</span>
    </p>
  );
}

function Hero() {
  const { t } = useI18n();
  const title = t('landing.heroTitle');
  const highlight = t('landing.heroTitleHighlight');
  const at = title.indexOf(highlight);
  return (
    <section className="on-dark relative isolate overflow-hidden text-white">
      <Image
        src={cityNight}
        alt=""
        fill
        sizes="100vw"
        placeholder="blur"
        loading="eager"
        fetchPriority="high"
        className="-z-20 object-cover opacity-30"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#050b1a] via-[#0a1430]/90 to-[#0a1430]" />
      <div
        className={`${WIDE} grid items-center gap-14 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-20`}
      >
        <div className="flex flex-col gap-6">
          <p className="animate-fade-up flex flex-wrap items-center gap-3 text-base font-semibold text-slate-100">
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-3.5 py-1.5 text-sm font-extrabold text-slate-950">
              <Icon name="qr" className="size-4" />
              {t('landing.heroBadge')}
            </span>
            {t('landing.heroEyebrow')}
          </p>
          <h1 className="animate-fade-up text-[2.5rem] font-extrabold leading-[1.05] tracking-tight text-balance [animation-delay:80ms] sm:text-6xl lg:text-[4.25rem]">
            {at < 0 ? (
              title
            ) : (
              <>
                {title.slice(0, at)}
                <span className="block bg-gradient-to-r from-amber-200 via-amber-300 to-yellow-400 bg-clip-text text-transparent">
                  {highlight}
                </span>
                {title.slice(at + highlight.length)}
              </>
            )}
          </h1>
          <p className="animate-fade-up max-w-xl text-lg text-slate-200 [animation-delay:160ms] sm:text-xl">
            {t('landing.heroText')}
          </p>
          <PriceTag className="animate-fade-up [animation-delay:220ms]" />
          <div className="animate-fade-up flex flex-wrap gap-3 [animation-delay:260ms]">
            <Link href="/app" className={cx(btnYellow, 'min-h-14 px-8 text-lg')}>
              {t('landing.heroCta')}
              <Icon name="arrowRight" className="size-5 transition group-hover:translate-x-1" />
            </Link>
            <Link href="#demo" className={btnGhost}>
              <Icon name="play" className="size-4" />
              {t('landing.heroSecondary')}
            </Link>
          </div>
          <ul className="animate-fade-up flex flex-wrap gap-x-6 gap-y-2 text-slate-100 [animation-delay:320ms]">
            {keys('landing.heroPoint', 3).map((k) => (
              <li key={k} className="flex items-center gap-2">
                <Icon name="check" className="size-5 text-emerald-400" strokeWidth={3} />
                {t(k)}
              </li>
            ))}
          </ul>
          <p className="animate-fade-up text-sm text-slate-300 [animation-delay:380ms]">
            {t('landing.trust')}
          </p>
        </div>
        <HeroVisual />
      </div>
      <Wave />
    </section>
  );
}

/** The sticker on the windscreen, the owner's notification and the live status: a picture. */
function HeroVisual() {
  const { t } = useI18n();
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[28rem] select-none">
      <div className="animate-fade-up relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-white/15 shadow-2xl shadow-black/40 [animation-delay:200ms]">
        <Image
          src={windscreenWeather}
          alt=""
          fill
          sizes="(min-width: 1024px) 28rem, 90vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/10 via-slate-950/20 to-slate-950/70" />
        {/* reflections on the glass */}
        <div className="absolute -left-1/4 top-0 h-full w-1/2 -skew-x-12 bg-gradient-to-r from-white/0 via-white/15 to-white/0" />
        <div className="absolute left-1/2 top-[14%] w-[62%] -translate-x-1/2">
          <span className="absolute inset-0 animate-ping-ring rounded-2xl bg-amber-300/40 [animation-delay:1.4s]" />
          <img
            src="/images/sticker-nfc.svg"
            alt=""
            width={320}
            height={320}
            className="relative block w-full rotate-[-6deg] rounded-2xl shadow-2xl shadow-black/60"
          />
        </div>
      </div>

      <div className="animate-pop-in absolute -left-3 top-6 flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-emerald-900 shadow-xl [animation-delay:1.1s] sm:-left-8">
        <span className="relative flex size-2.5">
          <span className="absolute inset-0 animate-ping-ring rounded-full bg-emerald-500 [animation-delay:1.7s]" />
          <span className="relative size-2.5 rounded-full bg-emerald-600" />
        </span>
        {t('landing.heroStatus')}
      </div>

      <div className="animate-pop-in absolute -bottom-6 -right-2 w-[88%] max-w-[20rem] [animation-delay:700ms] sm:-right-8">
        <div className="animate-float rounded-2xl bg-white/95 p-4 text-slate-900 shadow-2xl ring-1 ring-black/5 backdrop-blur [animation-delay:1.4s]">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <LogoMark className="size-5" />
            {t('landing.heroNotifApp')}
          </div>
          <p className="mt-1.5 font-bold leading-snug">{t('landing.heroNotifTitle')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-bold">
            <span className="rounded-lg bg-blue-700 py-2 text-center text-white">
              {t('landing.heroNotifAction')}
            </span>
            <span className="rounded-lg bg-slate-200 py-2 text-center text-slate-800">
              {t('landing.heroNotifLater')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const SITUATIONS: { photo: StaticImageData; icon: IconName; tint: string }[] = [
  { photo: garageBlocked, icon: 'car', tint: 'bg-red-600' },
  { photo: dashboardLights, icon: 'lightbulb', tint: 'bg-amber-500' },
  { photo: windscreenWeather, icon: 'cloudRain', tint: 'bg-sky-600' },
  { photo: streetParking, icon: 'truck', tint: 'bg-violet-600' },
];

/** Photo on the left, icon, title and text: one dark card per situation. */
function Situations() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="situations" className={`${WIDE} py-20 sm:py-24`}>
      <SectionHead
        id="situations"
        title={t('landing.situationsTitle')}
        text={t('landing.situationsText')}
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {SITUATIONS.map((s, i) => (
          <Reveal as="li" key={i} delay={i * 90} className="min-w-0">
            <article className="group flex h-full min-w-0 overflow-hidden rounded-2xl border border-border bg-surface transition duration-300 hover:-translate-y-0.5 hover:border-primary">
              <div className="relative w-20 shrink-0 overflow-hidden min-[380px]:w-28 sm:w-40">
                <Image
                  src={s.photo}
                  alt=""
                  fill
                  sizes="10rem"
                  placeholder="blur"
                  className="object-cover transition duration-700 group-hover:scale-105"
                />
              </div>
              <div className="flex min-w-0 flex-1 items-start gap-3 p-3 sm:p-5">
                <span
                  aria-hidden="true"
                  className={cx(
                    'grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-lg',
                    s.tint,
                  )}
                >
                  <Icon name={s.icon} className="size-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold hyphens-auto">
                    {t(`landing.situation${i + 1}Title` as MessageKey)}
                  </h3>
                  <p className="text-muted hyphens-auto">
                    {t(`landing.situation${i + 1}Text` as MessageKey)}
                  </p>
                </div>
              </div>
            </article>
          </Reveal>
        ))}
      </ul>
      <Reveal className="mt-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{t('landing.situationsMore')}</span>
          <ul className="contents">
            {keys('landing.situationsMore', 3).map((k) => (
              <li
                key={k}
                className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-semibold"
              >
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-center gap-2 text-muted">
          <Icon name="alert" aria-hidden="true" className="size-5 shrink-0 text-amber-300" />
          {t('landing.situationsUrgent')}
        </p>
      </Reveal>
    </section>
  );
}

const STEP_ICONS: IconName[] = ['sticker', 'nfc', 'bell'];

/** Three numbered cards, then the animated demo (kept from the previous design). */
function HowItWorks() {
  const { t } = useI18n();
  return (
    <section id="so-funktionierts" aria-labelledby="how" className="scroll-mt-20 py-20 sm:py-24">
      <div className={WIDE}>
        <SectionHead id="how" eyebrow={t('nav.how')} title={t('landing.howTitle')} />
        <ol className="grid gap-4 lg:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <Reveal as="li" key={n} delay={(n - 1) * 120} className="min-w-0">
              <div className="flex h-full flex-col items-start gap-4 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:p-6 lg:flex-col">
                <div aria-hidden="true" className="flex shrink-0 items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-full bg-blue-600 text-lg font-extrabold text-white shadow-lg shadow-blue-600/30">
                    {n}
                  </span>
                  <span className="grid size-14 place-items-center rounded-2xl bg-secondary text-amber-300">
                    <Icon name={STEP_ICONS[n - 1]!} className="size-8" />
                  </span>
                </div>
                <div className="min-w-0">
                  <h3 className="text-xl font-bold">{t(`landing.step${n}Title` as MessageKey)}</h3>
                  <p className="mt-1 text-muted">{t(`landing.step${n}Text` as MessageKey)}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>

        <div className="mt-24">
          <Reveal className="mb-10 flex max-w-2xl flex-col gap-3">
            <p className="inline-flex w-fit items-center gap-2 rounded-full bg-amber-400 px-3.5 py-1.5 text-sm font-extrabold text-slate-950">
              <Icon name="play" className="size-4" />
              {t('landing.demoBadge')}
            </p>
            <h2
              id="demo"
              className="scroll-mt-24 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl"
            >
              {t('landing.demoTitle')}
            </h2>
            <p className="text-lg text-muted">{t('landing.demoIntro')}</p>
          </Reveal>
          <Reveal>
            <LandingDemo />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const NFC_POINTS: { key: 'Qr' | 'Tap' | 'Reply' | 'Safe'; icon: IconName }[] = [
  { key: 'Qr', icon: 'qr' },
  { key: 'Tap', icon: 'nfc' },
  { key: 'Reply', icon: 'chat' },
  { key: 'Safe', icon: 'shieldCheck' },
];

/** „Ihr Kontakt – einfach & sicher“: QR code, NFC chip and the reply, next to the real sticker. */
function NfcSticker() {
  const { t } = useI18n();
  return (
    <section
      id="nfc"
      aria-labelledby="nfc-title"
      className="scroll-mt-20 border-y border-border bg-surface/60 py-20 sm:py-24"
    >
      <div className={`${WIDE} grid items-center gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16`}>
        <Reveal className="relative mx-auto w-full max-w-[22rem]">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-full bg-blue-600/30 blur-3xl"
          />
          <img
            src="/images/sticker-nfc.svg"
            alt={t('landing.nfcAlt')}
            width={352}
            height={352}
            className="block w-full rotate-[-3deg] rounded-[1.75rem] shadow-2xl shadow-black/50"
          />
        </Reveal>
        <div>
          <SectionHead
            id="nfc-title"
            eyebrow={t('landing.nfcEyebrow')}
            title={t('landing.nfcTitle')}
            text={t('landing.nfcText')}
          />
          <ul className="flex flex-col gap-3">
            {NFC_POINTS.map(({ key, icon }, i) => (
              <Reveal as="li" key={key} delay={i * 100}>
                <div className="flex gap-4 rounded-2xl border border-border bg-bg p-4 sm:p-5">
                  <span
                    aria-hidden="true"
                    className="grid size-12 shrink-0 place-items-center rounded-xl bg-blue-600 text-white"
                  >
                    <Icon name={icon} className="size-6" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold">
                      {t(`landing.nfc${key}Title` as MessageKey)}
                    </h3>
                    <p className="text-muted">{t(`landing.nfc${key}Text` as MessageKey)}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ul>
          <Reveal>
            <p className="mt-5 text-sm text-muted">{t('landing.nfcNote')}</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const FEATURE_ICONS: IconName[] = ['zap', 'clock', 'eyeOff', 'shieldCheck'];

/** „Privatsphäre & Sicherheit“: the number note vs. ParkShield, four features and the facts. */
function Privacy() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="privacy" className={`${WIDE} py-20 sm:py-24`}>
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div>
          <SectionHead
            id="privacy"
            eyebrow={t('landing.featuresTitle')}
            title={t('landing.privacyTitle')}
            text={t('landing.privacyText')}
          />
        </div>
        <div className="relative flex flex-col gap-4">
          <Reveal>
            <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-2xl bg-danger-bg text-danger-text"
              >
                <Icon name="phone" className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{t('landing.privacyOld')}</p>
                <p className="text-xl font-bold tracking-wider text-red-300 line-through decoration-2">
                  {t('landing.privacyOldValue')}
                </p>
                <p className="text-sm text-muted">{t('landing.privacyOldNote')}</p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="flex items-center gap-4 rounded-2xl border-2 border-amber-400 bg-surface p-5 shadow-xl shadow-amber-500/10 sm:ml-10">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white"
              >
                <Icon name="shieldCheck" className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{t('landing.privacyNew')}</p>
                <p className="text-xl font-bold text-amber-300">{t('landing.privacyNewValue')}</p>
                <p className="text-sm text-muted">{t('landing.privacyNewNote')}</p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <Reveal as="li" key={n} delay={(n - 1) * 90}>
            <div className="h-full rounded-2xl border border-border bg-surface p-6 text-center transition duration-300 hover:-translate-y-1 hover:border-primary">
              <span
                aria-hidden="true"
                className="mx-auto grid size-14 place-items-center rounded-2xl text-amber-300 ring-2 ring-border"
              >
                <Icon name={FEATURE_ICONS[n - 1]!} className="size-7" />
              </span>
              <h3 className="mt-4 text-lg font-bold">
                {t(`landing.feature${n}Title` as MessageKey)}
              </h3>
              <p className="mt-2 text-muted">{t(`landing.feature${n}Text` as MessageKey)}</p>
            </div>
          </Reveal>
        ))}
      </ul>

      <Reveal className="mt-10">
        <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
          <h3 className="text-xl font-bold">{t('landing.factsTitle')}</h3>
          <ul className="mt-5 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {keys('landing.facts', 5).map((k) => (
              <li key={k} className="flex gap-2.5">
                <Check />
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/datenschutz"
            className="mt-5 inline-flex min-h-12 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t('landing.factsLink')}
            <Icon name="arrowRight" className="size-5" />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

// Alerts reach the owner in the app only; the follow-ups are a reminder push and one SMS (2026-11-21).
const CHANNELS: { key: 'App' | 'Reminder' | 'Sms'; icon: IconName; tint: string }[] = [
  { key: 'App', icon: 'phone', tint: 'from-emerald-500 to-green-700' },
  { key: 'Reminder', icon: 'bell', tint: 'from-blue-500 to-indigo-600' },
  { key: 'Sms', icon: 'chat', tint: 'from-amber-400 to-orange-500' },
];

const OWNER_FEATURES: { key: string; icon: IconName }[] = [
  { key: 'Reply', icon: 'zap' },
  { key: 'Chat', icon: 'chat' },
  { key: 'Quiet', icon: 'moon' },
  { key: 'Block', icon: 'lock' },
];

/**
 * What the owner sees and controls in the app (2026-11-26), then the follow-ups when they do not react.
 * „Bin gleich zurück“ is listed only while the feature flag is on (VEHICLE_STATUS_ENABLED).
 */
function OwnerApp({ beRightBack }: { beRightBack: boolean }) {
  const { t } = useI18n();
  const features = beRightBack
    ? [...OWNER_FEATURES, { key: 'Brb', icon: 'clock' as IconName }]
    : OWNER_FEATURES;
  return (
    <section
      aria-labelledby="owner"
      className="border-y border-border bg-surface/60 py-20 sm:py-24"
    >
      <div className={WIDE}>
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-20">
          <OwnerPhone />
          <div>
            <SectionHead id="owner" title={t('landing.ownerTitle')} text={t('landing.ownerText')} />
            <ul className="flex flex-col gap-5">
              {features.map((f, i) => (
                <Reveal as="li" key={f.key} delay={i * 80} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="grid size-12 shrink-0 place-items-center rounded-2xl bg-blue-600 text-white"
                  >
                    <Icon name={f.icon} className="size-6" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold">
                      {t(`landing.owner${f.key}Title` as MessageKey)}
                    </h3>
                    <p className="mt-1 text-muted">
                      {t(`landing.owner${f.key}Text` as MessageKey)}
                    </p>
                  </div>
                </Reveal>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-20">
          <SectionHead
            id="channels"
            eyebrow={t('landing.ownerFollowUp')}
            title={t('landing.channelsTitle')}
            text={t('landing.channelsText')}
            center
          />
          <ul className="grid gap-4 md:grid-cols-3">
            {CHANNELS.map((c, i) => (
              <Reveal as="li" key={c.key} delay={i * 100}>
                <div className="flex h-full items-start gap-4 rounded-2xl border border-border bg-bg p-6">
                  <span
                    aria-hidden="true"
                    className={cx(
                      'grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-md',
                      c.tint,
                    )}
                  >
                    <Icon name={c.icon} className="size-6" />
                  </span>
                  <div>
                    <h3 className="text-lg font-bold">
                      {t(`landing.channel${c.key}` as MessageKey)}
                    </h3>
                    <p className="mt-1 text-muted">
                      {t(`landing.channel${c.key}Text` as MessageKey)}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The alert as the app shows it, with the three replies and a chat line: a picture, so aria-hidden. */
function OwnerPhone() {
  const { t } = useI18n();
  return (
    <Reveal className="mx-auto w-full max-w-[19rem]">
      <div
        aria-hidden="true"
        className="select-none rounded-[2.5rem] bg-slate-950 p-3 shadow-2xl ring-1 ring-white/10"
      >
        <div className="flex flex-col gap-3 rounded-[2rem] bg-slate-50 p-4 text-slate-900">
          <div className="mx-auto h-1.5 w-16 rounded-full bg-slate-300" />
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <LogoMark className="size-5" />
            ParkShield
            <span className="ml-auto font-normal">{t('landing.ownerPhoneTime')}</span>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-600 text-white">
                <Icon name="car" className="size-5" />
              </span>
              <p className="font-bold leading-snug">{t('landing.ownerPhoneAlert')}</p>
            </div>
            <div className="mt-4 flex flex-col gap-2 text-sm font-bold">
              <span className="rounded-xl bg-blue-700 py-2.5 text-center text-white">
                {t('reply.coming')}
              </span>
              <span className="rounded-xl bg-slate-200 py-2.5 text-center text-slate-800">
                {t('reply.in_30_min')}
              </span>
              <span className="rounded-xl bg-slate-200 py-2.5 text-center text-slate-800">
                {t('reply.not_nearby')}
              </span>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-300 text-slate-700">
              <Icon name="chat" className="size-4" />
            </span>
            <p className="rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-sm shadow-sm ring-1 ring-slate-200">
              {t('landing.ownerPhoneChat')}
            </p>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/** "19,99 € / Jahr inkl. 19 % MwSt." as one sentence, with the amount set large. */
function Price({ cents }: { cents: number }) {
  const { t } = useI18n();
  const price = useEuro()(cents);
  const text = t('landing.priceInclVat', { price });
  const at = text.indexOf(price);
  if (at < 0) return <p className="text-3xl font-extrabold tracking-tight">{text}</p>;
  return (
    <p className="text-muted">
      {text.slice(0, at)}
      <span className="mr-1 text-5xl font-extrabold tracking-tight text-fg">{price}</span>
      {text.slice(at + price.length)}
    </p>
  );
}

/** One all-inclusive plan (owner decision 2026-11-21): one card, Lifetime as the button under it. */
function Pricing() {
  const { t } = useI18n();
  return (
    <section
      id="preise"
      aria-labelledby="pricing"
      className={`${WIDE} scroll-mt-20 py-20 sm:py-24`}
    >
      <SectionHead
        id="pricing"
        eyebrow={t('nav.pricing')}
        title={t('landing.pricingTitle')}
        text={t('landing.pricingNote')}
        center
      />
      <div className="mx-auto grid max-w-5xl grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <Reveal>
          <div className="relative flex h-full flex-col gap-5 rounded-3xl border-2 border-amber-400 bg-surface p-7 shadow-2xl shadow-amber-500/10 sm:p-9">
            <div>
              <h3 className="text-2xl font-bold">{t('landing.planName')}</h3>
              <p className="text-muted">{t('landing.planFor')}</p>
            </div>
            <Price cents={PLAN_PRICE_CENTS} />
            <FeatureList items={keys('landing.planF', PLAN_FEATURE_COUNT)} />
            <Link href="/app" className={cx(btnYellow, 'mt-2')}>
              {t('landing.planCta')}
              <Icon name="arrowRight" className="size-5 transition group-hover:translate-x-1" />
            </Link>
            <LifetimeButton />
          </div>
        </Reveal>
        <StickerCard />
      </div>
    </section>
  );
}

/**
 * Lifetime (owner decision 2026-11-26): one button under „Jetzt bestellen“, not a second card. A short
 * shine (three sweeps, then still; none with reduced motion), a badge with the real difference to one
 * year and the year from which it is cheaper. The purchase itself is in the app.
 */
function LifetimeButton() {
  const { t } = useI18n();
  const euro = useEuro();
  return (
    <div className="flex flex-col gap-3" data-testid="lifetime-offer">
      <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        {t('landing.lifetimeOr')}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Link
        href="/app"
        className="lifetime-shine group relative flex min-h-12 flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-amber-400 bg-transparent px-6 py-2 text-center font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-amber-400/10 sm:rounded-full"
      >
        <span className="text-xs font-bold tracking-wide text-amber-300 uppercase">
          {t('landing.lifetimeBadge', { diff: euro(LIFETIME_PRICE_CENTS - PLAN_PRICE_CENTS) })}
        </span>
        <span className="flex items-center justify-center gap-2 text-lg">
          {t('landing.lifetimeCta', { price: euro(LIFETIME_PRICE_CENTS) })}
          <Icon name="arrowRight" className="size-5 transition group-hover:translate-x-1" />
        </span>
      </Link>
      <p className="text-center text-sm text-muted">
        {t('landing.lifetimeLine', {
          year: lifetimeCheaperFromYear(PLAN_PRICE_CENTS, LIFETIME_PRICE_CENTS),
        })}
      </p>
    </div>
  );
}

/** What the printed decal is (2026-11-26): size, material, designs, self-print and reprint price. */
function StickerCard() {
  const { t } = useI18n();
  return (
    <Reveal delay={120}>
      <div className="flex h-full flex-col gap-5 rounded-3xl border border-border bg-surface p-7 sm:p-9">
        <div className="flex items-center gap-5">
          <img
            src="/images/sticker-nfc.svg"
            alt={t('landing.stickerAlt')}
            width={112}
            height={112}
            className="size-24 shrink-0 rotate-[-4deg] rounded-xl shadow-lg shadow-black/40 sm:size-28"
          />
          <div className="min-w-0">
            <h3 className="text-2xl font-bold">{t('landing.stickerTitle')}</h3>
            <p className="text-muted">{t('landing.stickerText')}</p>
          </div>
        </div>
        <FeatureList items={keys('landing.stickerF', 6)} />
      </div>
    </Reveal>
  );
}

function Faq() {
  const { t } = useI18n();
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="scroll-mt-20 border-t border-border bg-surface/60 py-20 sm:py-24"
    >
      <div className={`${WIDE} grid gap-10 lg:grid-cols-[1fr_1.6fr]`}>
        <div>
          <SectionHead id="faq-title" eyebrow={t('nav.faq')} title={t('landing.faqTitle')} />
          <Link
            href="/hilfe"
            className="inline-flex min-h-12 items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
          >
            {t('common.footer.help')}
            <Icon name="arrowRight" className="size-5" />
          </Link>
        </div>
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <Reveal key={n} delay={(n - 1) * 60}>
              <details
                open={n === 1}
                className="group rounded-2xl border border-border bg-bg px-5 transition open:border-primary"
              >
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-semibold">
                  {t(`landing.faq${n}Q` as MessageKey)}
                  <span
                    aria-hidden="true"
                    className="faq-icon grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-secondary-fg transition duration-300"
                  >
                    <Icon name="plus" className="size-4" strokeWidth={2.5} />
                  </span>
                </summary>
                <p className="pb-5 text-muted">{t(`landing.faq${n}A` as MessageKey)}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/** „Erreichbar bleiben. Privat bleiben.“ with the price, the yellow button and the sticker. */
function ClosingCta() {
  const { t } = useI18n();
  const title = t('landing.ctaTitle');
  const highlight = t('landing.heroTitleHighlight');
  const at = title.indexOf(highlight);
  return (
    <section aria-labelledby="cta" className="on-dark relative isolate overflow-hidden text-white">
      <Wave />
      <Image
        src={cityTraffic}
        alt=""
        fill
        sizes="100vw"
        placeholder="blur"
        className="-z-20 object-cover opacity-20"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#0a1430] via-blue-950/90 to-[#050b1a]" />
      <div className={`${WIDE} grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-[1.3fr_1fr]`}>
        <Reveal className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
          <LogoMark className="size-14" />
          <h2 id="cta" className="text-4xl font-extrabold tracking-tight text-balance sm:text-5xl">
            {at < 0 ? (
              title
            ) : (
              <>
                {title.slice(0, at)}
                <span className="block text-amber-300">{highlight}</span>
                {title.slice(at + highlight.length)}
              </>
            )}
          </h2>
          <p className="max-w-xl text-lg text-blue-100">{t('landing.ctaText')}</p>
          <div className="rounded-full border-2 border-blue-400/60 bg-blue-950/60 px-6 py-2">
            <PriceTag />
          </div>
          <Link href="/app" className={cx(btnYellow, 'min-h-14 px-8 text-lg')}>
            {t('landing.heroCta')}
            <Icon name="arrowRight" className="size-5 transition group-hover:translate-x-1" />
          </Link>
        </Reveal>
        <Reveal delay={150} className="mx-auto w-full max-w-[18rem]">
          <img
            src="/images/sticker-nfc.svg"
            alt=""
            width={288}
            height={288}
            className="block w-full rotate-[6deg] rounded-[1.5rem] shadow-2xl shadow-black/60"
          />
        </Reveal>
      </div>
    </section>
  );
}

export function Landing({ beRightBack = false }: { beRightBack?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <PageShell sticky dark>
      <div ref={root} className="ps-dark">
        <Hero />
        <Situations />
        <HowItWorks />
        <NfcSticker />
        <Privacy />
        <OwnerApp beRightBack={beRightBack} />
        <Pricing />
        <Faq />
        <ClosingCta />
      </div>
    </PageShell>
  );
}
