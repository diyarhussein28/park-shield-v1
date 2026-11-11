'use client';

import type { MessageKey } from '@parkshield/i18n';
import { useI18n } from '@parkshield/ui';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/cx';
import { Icon, LogoMark } from './icons';

const STEPS = 4;
const STEP_MS = 3800;

/**
 * Animated walk-through of an alert, from the stranger's scan to "I'm coming". It plays only while
 * on screen, never by itself with reduced motion, and can be paused (WCAG 2.2.2). The phone is a
 * picture of the step list next to it, so it is hidden from assistive technology.
 */
export function LandingDemo() {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  const userPaused = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), {
      threshold: 0.35,
    });
    if (box.current) io.observe(box.current);
    // Deferred so the effect does not set state synchronously (react-hooks/set-state-in-effect).
    const start = setTimeout(() => {
      if (!reduce && !userPaused.current) setPlaying(true);
    }, 0);
    return () => {
      io.disconnect();
      clearTimeout(start);
    };
  }, []);

  const running = playing && visible;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS), STEP_MS);
    return () => clearInterval(id);
  }, [running, step]);

  const choose = (n: number) => {
    userPaused.current = true;
    setPlaying(false);
    setStep(n);
  };
  const toggle = () => {
    userPaused.current = playing;
    setPlaying(!playing);
  };

  return (
    <div ref={box} className="grid items-center gap-10 lg:grid-cols-[1fr_auto] lg:gap-16">
      <div>
        <ol aria-label={t('landing.demoSteps')} className="flex flex-col gap-3">
          {Array.from({ length: STEPS }, (_, i) => {
            const active = i === step;
            return (
              <li key={i}>
                <button
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  onClick={() => choose(i)}
                  className={cx(
                    'relative flex w-full cursor-pointer items-start gap-4 overflow-hidden rounded-2xl border p-4 text-left transition',
                    active
                      ? 'border-primary bg-bg shadow-lg shadow-primary/10'
                      : 'border-transparent hover:border-border hover:bg-bg/60',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'grid size-10 shrink-0 place-items-center rounded-full text-lg font-bold transition',
                      active ? 'bg-primary text-primary-fg' : 'bg-secondary text-secondary-fg',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-lg font-semibold">
                      {t(`landing.demoStep${i + 1}` as MessageKey)}
                    </span>
                    <span className="text-muted">
                      {t(`landing.demoStep${i + 1}Text` as MessageKey)}
                    </span>
                  </span>
                  {active && running && (
                    <span
                      aria-hidden="true"
                      key={step}
                      className="absolute inset-x-0 bottom-0 h-1 origin-left bg-primary"
                      style={{ animation: `demo-progress ${STEP_MS}ms linear both` }}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={toggle}
          className="mt-5 inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border-2 border-border-strong px-5 font-semibold hover:bg-bg"
        >
          <Icon name={playing ? 'pause' : 'play'} className="size-4" />
          {playing ? t('landing.demoPause') : t('landing.demoPlay')}
        </button>
      </div>
      <Phone step={step} running={running} />
    </div>
  );
}

function Phone({ step, running }: { step: number; running: boolean }) {
  const { t } = useI18n();
  const screen = (n: number) =>
    cx(
      'absolute inset-0 flex flex-col transition duration-500',
      n === step
        ? 'opacity-100 translate-x-0'
        : n < step
          ? 'opacity-0 -translate-x-8'
          : 'opacity-0 translate-x-8',
    );
  return (
    <div aria-hidden="true" className="relative mx-auto w-[17rem] shrink-0 sm:w-[19rem]">
      <div className="absolute -inset-x-2 -inset-y-8 -z-10 sm:-inset-8 rounded-full bg-primary/20 blur-3xl" />
      <div className="rounded-[2.75rem] bg-slate-900 p-3 shadow-2xl ring-1 ring-white/10">
        <div className="relative aspect-[9/18.5] overflow-hidden rounded-[2.1rem] bg-white text-slate-900">
          <div className="absolute left-1/2 top-2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-slate-900" />

          {/* 1: camera on the decal */}
          <div className={cx(screen(0), 'bg-slate-900 text-white')}>
            <div className="relative flex flex-1 items-center justify-center overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900" />
              <div className="relative w-36 rotate-[-4deg] rounded-md bg-white p-0 shadow-xl">
                <img src="/images/decal-bold.svg" alt="" className="block w-full rounded-md" />
              </div>
              <div className="absolute inset-10 rounded-3xl border-[3px] border-white/0">
                {[
                  'left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl',
                  'right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl',
                  'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-2xl',
                  'right-0 bottom-0 border-r-4 border-b-4 rounded-br-2xl',
                ].map((c) => (
                  <span key={c} className={cx('absolute size-8 border-amber-300', c)} />
                ))}
                {running && step === 0 && (
                  <span
                    className="absolute inset-x-2 top-0 h-0.5 bg-amber-300 shadow-[0_0_12px_2px] shadow-amber-300/70"
                    style={{ animation: 'demo-scan 1.8s ease-in-out infinite alternate' }}
                  />
                )}
              </div>
            </div>
            <p className="bg-slate-950 px-4 py-4 text-center text-sm font-semibold">
              {t('landing.demoScanHint')}
            </p>
          </div>

          {/* 2: the scanner page */}
          <div className={cx(screen(1), 'bg-slate-50 px-4 pb-5 pt-10')}>
            <div className="flex items-center gap-2 text-sm font-bold">
              <LogoMark className="size-6" /> ParkShield
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
              <span className="grid size-10 place-items-center rounded-xl bg-blue-100 text-blue-800">
                <Icon name="car" className="size-6" />
              </span>
              <span className="text-sm font-semibold">{t('landing.demoCar')}</span>
            </div>
            <p className="mt-4 text-base font-bold">{t('landing.demoQuestion')}</p>
            <div className="mt-2 flex flex-col gap-2 text-sm">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={cx(
                    'rounded-xl px-3 py-2.5 font-medium ring-1 transition duration-500',
                    n === 1 && step >= 1
                      ? 'bg-blue-700 text-white ring-blue-700'
                      : 'bg-white text-slate-800 ring-slate-200',
                  )}
                >
                  {t(`landing.demoAlert${n}` as MessageKey)}
                </span>
              ))}
            </div>
            <span className="mt-auto rounded-xl bg-slate-900 py-3 text-center text-sm font-bold text-white">
              {t('landing.demoSend')}
            </span>
          </div>

          {/* 3: the owner's lock screen */}
          <div
            className={cx(
              screen(2),
              'bg-gradient-to-br from-indigo-950 via-blue-900 to-sky-800 px-3 pt-12 text-white',
            )}
          >
            <p className="text-center text-5xl font-light tabular-nums">08:14</p>
            <div
              className={cx(
                'mt-8 rounded-2xl bg-white/95 p-3 text-slate-900 shadow-xl',
                step === 2 && 'animate-pop-in [animation-delay:300ms]',
              )}
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                <LogoMark className="size-5" />
                {t('landing.heroNotifApp')}
              </div>
              <p className="mt-1.5 text-sm font-bold">{t('landing.heroNotifTitle')}</p>
              <p className="text-sm text-slate-700">{t('landing.demoAlert1')}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
                <span className="relative rounded-lg bg-blue-700 py-2 text-center text-white">
                  {t('landing.heroNotifAction')}
                  {running && step === 2 && (
                    <span className="absolute inset-0 animate-ping-ring rounded-lg ring-2 ring-blue-500 [animation-delay:1.2s]" />
                  )}
                </span>
                <span className="rounded-lg bg-slate-200 py-2 text-center text-slate-800">
                  {t('landing.heroNotifLater')}
                </span>
              </div>
            </div>
          </div>

          {/* 4: back on the scanner page */}
          <div className={cx(screen(3), 'items-center bg-emerald-50 px-5 pt-14 text-center')}>
            <span
              className={cx(
                'grid size-20 place-items-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30',
                step === 3 && 'animate-pop-in',
              )}
            >
              <Icon name="check" className="size-10" strokeWidth={3} />
            </span>
            <p className="mt-5 text-lg font-bold text-emerald-950">{t('landing.demoComing')}</p>
            <p className="mt-1 text-sm text-emerald-900">{t('landing.demoComingText')}</p>
            <ul className="mt-6 flex w-full flex-col gap-2 text-left text-sm">
              {[t('landing.demoDelivered'), t('landing.heroNotifAction')].map((label) => (
                <li
                  key={label}
                  className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 font-medium text-slate-800 ring-1 ring-emerald-200"
                >
                  <Icon name="check" className="size-4 text-emerald-700" strokeWidth={3} />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
