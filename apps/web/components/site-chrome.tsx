'use client';

import { LanguageSwitch, SkipLink, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Logo } from './brand/logo';
import { Icon } from './icons';

/** Width of header, footer and the landing page sections (content pages keep their narrow column). */
export const WIDE = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

/**
 * The logo link to the home page, in the header (`onLight`) and the footer (`onDark`). It opens the
 * home page at the top; already on it, a click scrolls smoothly back up instead of reloading.
 */
function Brand({ variant }: { variant: 'onLight' | 'onDark' }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== '/' || location.hash || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollTo({ top: 0, left: 0, behavior: reduce ? 'auto' : 'smooth' });
  };
  return (
    <Link
      href="/"
      onClick={onClick}
      aria-label={t('nav.homeLogo')}
      className="inline-flex min-h-12 w-fit items-center rounded-lg"
    >
      <Logo variant={variant} size={variant === 'onDark' ? 'lg' : 'md'} />
    </Link>
  );
}

export function SiteHeader({ sticky = false }: { sticky?: boolean }) {
  const { t } = useI18n();
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
          <Brand variant="onLight" />
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
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-5 font-semibold text-primary-fg shadow-md shadow-primary/20 transition hover:bg-primary-hover md:ml-2"
            href="/app"
            onClick={close}
          >
            {t('appPage.nav')}
          </Link>
          <LanguageSwitch className="pt-2 md:hidden" />
        </nav>
        <LanguageSwitch className="hidden md:ml-2 md:flex" />
      </div>
    </header>
  );
}

/**
 * The site footer (design 2026-11-22, „exactly like the image“): very dark navy, the ParkShield logo
 * (the same mark as the header, `components/brand/logo.tsx`), the tagline, then the link groups in a 2 × 2 grid on phones (Produkt · Support /
 * Rechtliches · Vertrag) and one row of four columns from 768 px, then „© 2026 ParkShield“ and
 * „Hosted in Germany“. „Verträge hier kündigen“ (§ 312k BGB) and „Vertrag widerrufen“ (§ 356a BGB)
 * are always visible, also without login. No tracking scripts.
 */
export function SiteFooter() {
  const { t } = useI18n();
  const columns: [string, [string, string][]][] = [
    [
      t('common.siteFooter.product'),
      [
        ['/#so-funktionierts', t('common.siteFooter.how')],
        ['/#preise', t('common.siteFooter.pricing')],
        ['/#faq', t('common.siteFooter.faq')],
      ],
    ],
    [
      t('common.siteFooter.support'),
      [
        ['/hilfe', t('common.siteFooter.help')],
        ['/sicherheit', t('common.siteFooter.security')],
        ['/barrierefreiheit', t('common.siteFooter.accessibility')],
      ],
    ],
    [
      t('common.siteFooter.legal'),
      [
        ['/impressum', t('common.siteFooter.impressum')],
        ['/datenschutz', t('common.siteFooter.privacy')],
        ['/agb', t('common.siteFooter.terms')],
      ],
    ],
    [
      t('common.siteFooter.contract'),
      [
        ['/kuendigen', t('common.siteFooter.cancel')],
        ['/widerrufen', t('common.siteFooter.withdraw')],
      ],
    ],
  ];
  return (
    <footer className="on-dark mt-16 bg-[#050b1a] text-slate-300">
      <div className={`${WIDE} py-12 sm:py-14 md:py-16`}>
        <Brand variant="onDark" />
        <p className="mt-3 max-w-2xl text-lg leading-relaxed">{t('common.siteFooter.tagline')}</p>
        <hr className="my-10 border-slate-700" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
          {columns.map(([title, links]) => (
            <div key={title} className="min-w-0">
              <h2 className="text-base font-bold tracking-wider text-white uppercase">{title}</h2>
              <ul className="mt-4 flex flex-col gap-1">
                {links.map(([href, label]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="inline-block rounded py-1.5 text-base leading-snug min-[380px]:text-lg wrap-break-word hyphens-auto no-underline underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:text-white focus-visible:underline"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <hr className="my-10 border-slate-700" />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-sm min-[380px]:text-base">
          <p className="whitespace-nowrap">© {new Date().getFullYear()} ParkShield</p>
          <p className="inline-flex items-center gap-1.5 whitespace-nowrap min-[380px]:gap-2">
            <Icon name="lock" className="size-4 shrink-0 min-[380px]:size-5" />
            {t('common.siteFooter.hosted')}
          </p>
        </div>
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
