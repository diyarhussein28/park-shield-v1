'use client';

import type { MessageKey } from '@parkshield/i18n';
import { PLAN_PRICES_CENTS } from '@parkshield/shared';
import { useI18n } from '@parkshield/ui';
import Image, { type StaticImageData } from 'next/image';
import Link from 'next/link';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import cityNight from '@/assets/photos/city-night.jpg';
import cityTraffic from '@/assets/photos/city-traffic.jpg';
import dashboardLights from '@/assets/photos/dashboard-lights.jpg';
import driver from '@/assets/photos/driver.jpg';
import garageBlocked from '@/assets/photos/garage-blocked.jpg';
import streetParking from '@/assets/photos/street-parking.jpg';
import windscreenWeather from '@/assets/photos/windscreen-weather.jpg';
import { cx } from '@/lib/cx';
import { Icon, LogoMark, type IconName } from './icons';
import { LandingDemo } from './landing-demo';
import { useReveal } from './reveal';
import { PageShell, WIDE } from './site-chrome';

const keys = <P extends string>(prefix: P, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}` as MessageKey);

function useEuro() {
  const { locale } = useI18n();
  return (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
    }).format(cents / 100);
}

const btn =
  'group inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 font-semibold transition duration-200';
const btnAmber = `${btn} bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 hover:-translate-y-0.5 hover:bg-amber-300`;
const btnPrimary = `${btn} bg-primary text-primary-fg shadow-lg shadow-primary/20 hover:-translate-y-0.5 hover:bg-primary-hover`;
const btnGhostDark = `${btn} border-2 border-white/40 text-white hover:border-white hover:bg-white/10`;

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
        <p className="text-sm font-bold uppercase tracking-widest text-primary">{eyebrow}</p>
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
        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary',
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

function Hero() {
  const { t } = useI18n();
  const title = t('landing.heroTitle');
  const highlight = t('landing.heroTitleHighlight');
  const at = title.indexOf(highlight);
  return (
    <section className="on-dark relative isolate overflow-hidden bg-slate-950 text-white">
      <Image
        src={cityNight}
        alt=""
        fill
        sizes="100vw"
        placeholder="blur"
        loading="eager"
        fetchPriority="high"
        className="-z-20 object-cover opacity-45"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950 via-slate-950/85 to-slate-950/40" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-t from-slate-950" />
      <div
        className={`${WIDE} grid items-center gap-14 pb-20 pt-14 sm:pt-20 lg:grid-cols-[1.15fr_1fr] lg:pb-28 lg:pt-24`}
      >
        <div className="flex flex-col gap-7">
          <p className="animate-fade-up inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-semibold text-amber-200 backdrop-blur">
            <Icon name="qr" className="size-4" />
            {t('landing.heroEyebrow')}
          </p>
          <h1 className="animate-fade-up text-[2.15rem] font-extrabold leading-[1.08] tracking-tight text-balance hyphens-auto [animation-delay:80ms] sm:hyphens-none sm:text-5xl lg:text-6xl">
            {at < 0 ? (
              title
            ) : (
              <>
                {title.slice(0, at)}
                <span className="bg-gradient-to-r from-amber-200 via-amber-300 to-yellow-400 bg-clip-text text-transparent">
                  {highlight}
                </span>
                {title.slice(at + highlight.length)}
              </>
            )}
          </h1>
          <p className="animate-fade-up max-w-xl text-lg text-slate-200 [animation-delay:160ms] sm:text-xl">
            {t('landing.heroText')}
          </p>
          <div className="animate-fade-up flex flex-wrap gap-3 [animation-delay:240ms]">
            <Link href="/konto" className={btnAmber}>
              {t('landing.heroCta')}
              <Icon name="arrowRight" className="size-5 transition group-hover:translate-x-1" />
            </Link>
            <Link href="#so-funktionierts" className={btnGhostDark}>
              {t('landing.heroSecondary')}
            </Link>
          </div>
          <ul className="animate-fade-up flex flex-wrap gap-x-6 gap-y-2 text-slate-200 [animation-delay:320ms]">
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
    </section>
  );
}

/** Decal on the glass, the owner's notification and the live status: a picture, so aria-hidden. */
function HeroVisual() {
  const { t } = useI18n();
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[26rem] select-none">
      <div className="animate-fade-up relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-white/15 bg-gradient-to-br from-sky-200/25 via-slate-500/10 to-slate-900/40 shadow-2xl backdrop-blur-sm [animation-delay:200ms]">
        <Image
          src={driver}
          alt=""
          fill
          sizes="(min-width: 1024px) 26rem, 90vw"
          className="object-cover opacity-30 mix-blend-luminosity"
        />
        {/* reflections on the glass */}
        <div className="absolute -left-1/4 top-0 h-full w-1/2 -skew-x-12 bg-gradient-to-r from-white/0 via-white/15 to-white/0" />
        <div className="absolute left-1/2 top-0 h-full w-10 -skew-x-12 bg-white/10" />
        <div className="absolute left-1/2 top-[22%] w-[58%] -translate-x-1/2">
          <span className="absolute inset-0 animate-ping-ring rounded-xl bg-amber-300/40 [animation-delay:1.4s]" />
          <img
            src="/images/decal-bold.svg"
            alt=""
            width={320}
            height={320}
            className="relative block w-full rotate-[-5deg] rounded-xl shadow-2xl shadow-black/50"
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

      <div className="animate-pop-in absolute -bottom-6 -right-2 w-[85%] max-w-[19rem] [animation-delay:700ms] sm:-right-8">
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

function Situations() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="situations" className={`${WIDE} py-20 sm:py-28`}>
      <SectionHead
        id="situations"
        title={t('landing.situationsTitle')}
        text={t('landing.situationsText')}
      />
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {SITUATIONS.map((s, i) => (
          <Reveal as="li" key={i} delay={i * 90}>
            <article className="group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl">
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={s.photo}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 18rem, (min-width: 640px) 45vw, 90vw"
                  placeholder="blur"
                  className="object-cover transition duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute bottom-3 left-3 grid size-11 place-items-center rounded-2xl text-white shadow-lg',
                    s.tint,
                  )}
                >
                  <Icon name={s.icon} className="size-6" />
                </span>
              </div>
              <div className="flex flex-col gap-2 p-5">
                <h3 className="text-lg font-bold">
                  {t(`landing.situation${i + 1}Title` as MessageKey)}
                </h3>
                <p className="text-muted">{t(`landing.situation${i + 1}Text` as MessageKey)}</p>
              </div>
            </article>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

const STEP_ICONS: IconName[] = ['qr', 'phone', 'bell'];

function HowItWorks() {
  const { t } = useI18n();
  return (
    <section
      id="so-funktionierts"
      aria-labelledby="how"
      className="scroll-mt-20 bg-surface py-20 sm:py-28"
    >
      <div className={WIDE}>
        <SectionHead id="how" eyebrow={t('nav.how')} title={t('landing.howTitle')} center />
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute left-[16%] right-[16%] top-16 hidden border-t-2 border-dashed border-border-strong/50 md:block"
          />
          <ol className="relative grid gap-6 md:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <Reveal as="li" key={n} delay={(n - 1) * 120} className="relative">
                <div className="flex h-full flex-col items-center gap-3 rounded-3xl bg-bg p-7 text-center shadow-sm ring-1 ring-border">
                  <span className="relative grid size-[4.5rem] place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-700/25">
                    <Icon name={STEP_ICONS[n - 1]!} className="size-8" />
                    <span
                      aria-hidden="true"
                      className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-amber-400 text-sm font-extrabold text-slate-950 ring-4 ring-bg"
                    >
                      {n}
                    </span>
                  </span>
                  <h3 className="mt-2 text-xl font-bold">
                    {t(`landing.step${n}Title` as MessageKey)}
                  </h3>
                  <p className="text-muted">{t(`landing.step${n}Text` as MessageKey)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>

        <div className="mt-24">
          <SectionHead id="demo" title={t('landing.demoTitle')} text={t('landing.demoIntro')} />
          <Reveal>
            <LandingDemo />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const FEATURE_ICONS: IconName[] = ['zap', 'users', 'eyeOff', 'shieldCheck'];

function Privacy() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="privacy" className={`${WIDE} py-20 sm:py-28`}>
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
            <div className="flex items-center gap-4 rounded-3xl border border-border bg-surface p-5">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-2xl bg-danger-bg text-danger-text"
              >
                <Icon name="phone" className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{t('landing.privacyOld')}</p>
                <p className="text-xl font-bold tracking-wider text-danger-text line-through decoration-2">
                  {t('landing.privacyOldValue')}
                </p>
                <p className="text-sm text-muted">{t('landing.privacyOldNote')}</p>
              </div>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="flex items-center gap-4 rounded-3xl border-2 border-primary bg-bg p-5 shadow-xl shadow-primary/10 sm:ml-10">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-fg"
              >
                <Icon name="shieldCheck" className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{t('landing.privacyNew')}</p>
                <p className="text-xl font-bold text-primary">{t('landing.privacyNewValue')}</p>
                <p className="text-sm text-muted">{t('landing.privacyNewNote')}</p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      <ul className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <Reveal as="li" key={n} delay={(n - 1) * 90}>
            <div className="h-full rounded-3xl border border-border bg-surface p-6 transition duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-lg">
              <span
                aria-hidden="true"
                className="grid size-12 place-items-center rounded-2xl bg-info-bg text-info-fg"
              >
                <Icon name={FEATURE_ICONS[n - 1]!} className="size-6" />
              </span>
              <h3 className="mt-4 text-lg font-bold">
                {t(`landing.feature${n}Title` as MessageKey)}
              </h3>
              <p className="mt-2 text-muted">{t(`landing.feature${n}Text` as MessageKey)}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}

const CHANNELS: { key: 'Push' | 'Whatsapp' | 'Email'; icon: IconName; tint: string }[] = [
  { key: 'Push', icon: 'bell', tint: 'from-blue-500 to-indigo-600' },
  { key: 'Whatsapp', icon: 'chat', tint: 'from-emerald-500 to-green-700' },
  { key: 'Email', icon: 'mail', tint: 'from-amber-400 to-orange-500' },
];

function Channels() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="channels" className="bg-surface py-20 sm:py-24">
      <div className={WIDE}>
        <SectionHead
          id="channels"
          title={t('landing.channelsTitle')}
          text={t('landing.channelsText')}
          center
        />
        <ul className="grid gap-5 md:grid-cols-3">
          {CHANNELS.map((c, i) => (
            <Reveal as="li" key={c.key} delay={i * 100}>
              <div className="flex h-full items-start gap-4 rounded-3xl bg-bg p-6 shadow-sm ring-1 ring-border">
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
    </section>
  );
}

/** "10 € / Jahr inkl. 19 % MwSt." as one sentence, with the amount set large. */
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

function Pricing() {
  const { t } = useI18n();
  const card = 'flex h-full flex-col gap-5 rounded-3xl border border-border bg-surface p-7';
  return (
    <section
      id="preise"
      aria-labelledby="pricing"
      className={`${WIDE} scroll-mt-20 py-20 sm:py-28`}
    >
      <SectionHead
        id="pricing"
        eyebrow={t('nav.pricing')}
        title={t('landing.pricingTitle')}
        text={t('landing.pricingNote')}
        center
      />
      <div className="grid items-stretch gap-6 lg:grid-cols-3">
        <Reveal className="h-full">
          <div className="relative h-full rounded-3xl bg-gradient-to-br from-blue-500 via-blue-700 to-amber-400 p-[2px] shadow-2xl shadow-primary/20 lg:-my-4">
            <div className={cx(card, 'border-0 bg-bg lg:py-11')}>
              <span className="absolute -top-3.5 left-7 rounded-full bg-amber-400 px-3 py-1 text-sm font-bold text-slate-950 shadow">
                {t('landing.pricingRecommended')}
              </span>
              <div>
                <h3 className="text-2xl font-bold">{t('landing.plusName')}</h3>
                <p className="text-muted">{t('landing.plusFor')}</p>
              </div>
              <Price cents={PLAN_PRICES_CENTS.plus} />
              <FeatureList items={keys('landing.plusF', 6)} />
              <Link href="/konto" className={cx(btnPrimary, 'mt-auto')}>
                {t('landing.plusCta')}
                <Icon name="arrowRight" className="size-5 transition group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </Reveal>
        <Reveal delay={120} className="h-full">
          <div className={card}>
            <div>
              <h3 className="text-2xl font-bold">{t('landing.premiumName')}</h3>
              <p className="text-muted">{t('landing.premiumFor')}</p>
            </div>
            <Price cents={PLAN_PRICES_CENTS.premium} />
            <FeatureList items={keys('landing.premiumF', 5)} />
            <span className="mt-auto w-fit rounded-full bg-info-bg px-3 py-1 text-sm font-semibold text-info-fg">
              {t('landing.premiumSoon')}
            </span>
          </div>
        </Reveal>
        <Reveal delay={240} className="h-full">
          <div className={card}>
            <div>
              <h3 className="text-2xl font-bold">{t('landing.businessName')}</h3>
              <p className="text-muted">{t('landing.businessFor')}</p>
            </div>
            <span className="w-fit rounded-full bg-warning-bg px-3 py-1 text-sm font-semibold text-warning-fg">
              {t('landing.businessSoon')}
            </span>
            <p>{t('landing.businessText')}</p>
            <Link
              href="/business"
              className={cx(btn, 'mt-auto border-2 border-border-strong hover:bg-secondary')}
            >
              {t('landing.businessCta')}
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Faq() {
  const { t } = useI18n();
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="scroll-mt-20 bg-surface py-20 sm:py-28"
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
          {[1, 2, 3, 4, 5].map((n) => (
            <Reveal key={n} delay={(n - 1) * 60}>
              <details className="group rounded-2xl border border-border bg-bg px-5 transition open:shadow-md">
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

function ClosingCta() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="cta" className={`${WIDE} py-20`}>
      <Reveal>
        <div className="on-dark relative isolate overflow-hidden rounded-[2rem] bg-blue-950 px-6 py-16 text-center text-white shadow-2xl sm:px-12">
          <Image
            src={cityTraffic}
            alt=""
            fill
            sizes="(min-width: 1152px) 72rem, 100vw"
            placeholder="blur"
            className="-z-20 object-cover opacity-30"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-blue-950/90 via-blue-900/80 to-slate-950/90" />
          <h2 id="cta" className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
            {t('landing.ctaTitle')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-blue-100">{t('landing.ctaText')}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/konto" className={btnAmber}>
              {t('landing.heroCta')}
              <Icon name="arrowRight" className="size-5 transition group-hover:translate-x-1" />
            </Link>
            <Link href="/business" className={btnGhostDark}>
              {t('landing.businessName')}
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <PageShell sticky>
      <div ref={root}>
        <Hero />
        <Situations />
        <HowItWorks />
        <Privacy />
        <Channels />
        <Pricing />
        <Faq />
        <ClosingCta />
      </div>
    </PageShell>
  );
}
