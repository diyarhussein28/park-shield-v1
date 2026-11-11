'use client';

import { LanguageSwitch, SkipLink, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { hasSession } from '@/lib/api-client';
import { cx } from '@/lib/cx';
import { useBrowserValue } from '@/lib/use-browser-value';
import { Icon, LogoMark } from './icons';

/** Width of header, footer and the landing page sections (content pages keep their narrow column). */
export const WIDE = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

function Brand() {
  const { t } = useI18n();
  return (
    <Link
      href="/"
      className="inline-flex min-h-12 items-center gap-2.5 rounded-lg text-xl font-extrabold tracking-tight"
    >
      <LogoMark className="size-9" />
      <span>
        Park<span className="text-primary">Shield</span>
      </span>
      <span className="sr-only"> – {t('nav.home')}</span>
    </Link>
  );
}

export function SiteHeader({ sticky = false }: { sticky?: boolean }) {
  const { t } = useI18n();
  const signedIn = useBrowserValue(hasSession, false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);

  const link =
    'inline-flex min-h-12 items-center rounded-full px-4 font-medium transition hover:bg-secondary hover:text-secondary-fg';
  const close = () => setOpen(false);

  return (
    // Sticky only on the long landing page: on forms it would cover controls scrolled under it.
    <header
      className={cx(
        'z-40 border-b border-border bg-bg/85 backdrop-blur-md',
        sticky && 'sticky top-0',
      )}
    >
      <SkipLink>{t('common.skipToContent')}</SkipLink>
      <div className={`${WIDE} flex flex-wrap items-center gap-x-3 py-2`}>
        <div className="mr-auto">
          <Brand />
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full px-4 font-semibold hover:bg-secondary md:hidden"
        >
          <Icon name={open ? 'close' : 'menu'} className="size-5" />
          {t('nav.menu')}
        </button>
        <nav
          id="site-nav"
          aria-label={t('nav.main')}
          className={cx(
            open ? 'flex' : 'hidden',
            'w-full flex-col gap-1 pb-4 pt-2 md:flex md:w-auto md:flex-row md:items-center md:pb-0 md:pt-0',
          )}
        >
          <Link className={link} href="/#so-funktionierts" onClick={close}>
            {t('nav.how')}
          </Link>
          <Link className={link} href="/#preise" onClick={close}>
            {t('nav.pricing')}
          </Link>
          <Link className={link} href="/business" onClick={close}>
            {t('nav.business')}
          </Link>
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-5 font-semibold text-primary-fg shadow-md shadow-primary/20 transition hover:bg-primary-hover md:ml-2"
            href={signedIn ? '/konto' : '/anmelden'}
            onClick={close}
          >
            {signedIn ? t('nav.account') : t('nav.login')}
          </Link>
          <LanguageSwitch className="pt-2 md:hidden" />
        </nav>
        <LanguageSwitch className="hidden md:ml-2 md:flex" />
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { t } = useI18n();
  const columns: [string, [string, string][]][] = [
    [
      t('common.footer.product'),
      [
        ['/#so-funktionierts', t('nav.how')],
        ['/#preise', t('nav.pricing')],
        ['/business', t('nav.business')],
        ['/#faq', t('common.footer.faq')],
      ],
    ],
    [
      t('common.footer.support'),
      [
        ['/hilfe', t('common.footer.help')],
        ['/sicherheit', t('common.footer.security')],
        ['/barrierefreiheit', t('common.footer.accessibility')],
      ],
    ],
    [
      t('common.footer.legal'),
      [
        ['/impressum', t('common.footer.impressum')],
        ['/datenschutz', t('common.footer.privacy')],
        ['/agb', t('common.footer.terms')],
        ['/widerruf', t('common.footer.withdrawal')],
      ],
    ],
  ];
  return (
    <footer className="on-dark mt-16 bg-slate-950 text-slate-300">
      <div className={`${WIDE} grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]`}>
        <div className="flex flex-col gap-4">
          <Link
            href="/"
            className="inline-flex min-h-12 w-fit items-center gap-2.5 rounded-lg text-xl font-extrabold tracking-tight text-white"
          >
            <LogoMark className="size-9" />
            ParkShield
            <span className="sr-only"> – {t('nav.home')}</span>
          </Link>
          <p className="max-w-xs">{t('common.footer.tagline')}</p>
          {/* §312k BGB: always visible, also without login. */}
          <Link
            href="/kuendigen"
            className="inline-flex min-h-12 w-fit items-center rounded-full border-2 border-white px-5 font-semibold text-white transition hover:bg-white hover:text-slate-950"
          >
            {t('common.footer.cancelContract')}
          </Link>
        </div>
        {columns.map(([title, links]) => (
          <div key={title}>
            <h2 className="text-sm font-bold uppercase tracking-widest text-white">{title}</h2>
            <ul className="mt-3 flex flex-col">
              {links.map(([href, label]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-block py-2 underline-offset-4 transition hover:text-white hover:underline"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <p className={`${WIDE} py-6 text-sm text-slate-400`}>
          © {new Date().getFullYear()} ParkShield · {t('landing.trust')}
        </p>
      </div>
    </footer>
  );
}

export function PageShell({ children, sticky }: { children: ReactNode; sticky?: boolean }) {
  return (
    <>
      <SiteHeader sticky={sticky} />
      <main id="main" className="min-h-[60vh]">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
