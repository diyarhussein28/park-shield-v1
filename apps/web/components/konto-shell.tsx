'use client';

import { useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { cx } from '@/lib/cx';
import { Icon, type IconName } from './icons';
import { PageShell, WIDE } from './site-chrome';

type Item = { href: string; label: string; icon: IconName };

/**
 * The owner portal frame: one navigation for every /konto page (sidebar from lg, a collapsible menu
 * on phones) and a consistent page header, so people always know where they are and how to get back.
 */
export function KontoShell({
  title,
  intro,
  actions,
  back,
  children,
}: {
  title: ReactNode;
  intro?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <PageShell>
      <div className={`${WIDE} py-6 lg:py-10`}>
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
          <KontoNav />
          <div className="min-w-0">
            {back && (
              <Link
                href={back.href}
                className="mb-3 inline-flex min-h-12 items-center gap-2 rounded-lg font-semibold text-primary underline-offset-4 hover:underline"
              >
                <Icon name="arrowLeft" className="size-4" />
                {back.label}
              </Link>
            )}
            <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-2xl">
                <h1 className="text-3xl font-bold tracking-tight wrap-anywhere">{title}</h1>
                {intro && <p className="mt-2 text-muted">{intro}</p>}
              </div>
              {actions}
            </header>
            <div className="flex flex-col gap-6">{children}</div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function KontoNav() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const items: Item[] = [
    { href: '/konto', label: t('portal.overview'), icon: 'home' },
    { href: '/konto/fahrzeuge', label: t('portal.vehicles'), icon: 'qr' },
    { href: '/konto/benachrichtigungen', label: t('portal.notifications'), icon: 'bell' },
    { href: '/konto/notfallkontakte', label: t('portal.contacts'), icon: 'users' },
    { href: '/konto/verlauf', label: t('portal.history'), icon: 'clock' },
    { href: '/konto/abo', label: t('portal.plan'), icon: 'card' },
    { href: '/konto/daten', label: t('portal.data'), icon: 'database' },
  ];
  const isCurrent = (href: string) =>
    href === '/konto'
      ? pathname === '/konto'
      : pathname === href || pathname.startsWith(`${href}/`);
  const current = items.find((i) => isCurrent(i.href)) ?? items[0]!;

  async function logout() {
    await api('/v1/auth/logout', { body: {} });
    router.push('/');
    router.refresh();
  }

  const row =
    'flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium transition hover:bg-secondary hover:text-secondary-fg';

  return (
    <nav aria-label={t('portal.nav')} className="lg:sticky lg:top-6 lg:self-start">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="konto-nav"
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 font-semibold shadow-sm lg:hidden"
      >
        <Icon name={current.icon} className="size-5 text-primary" />
        <span className="min-w-0 flex-1 text-left">
          <span className="sr-only">{t('portal.menu')}: </span>
          {current.label}
        </span>
        <Icon name="chevronDown" className={cx('size-5 transition', open && 'rotate-180')} />
      </button>
      <div
        id="konto-nav"
        className={cx(
          open ? 'flex' : 'hidden',
          'mt-2 flex-col gap-1 rounded-2xl border border-border bg-surface p-2 shadow-sm lg:mt-0 lg:flex lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none',
        )}
      >
        <ul className="flex flex-col gap-1">
          {items.map((i) => {
            const active = isCurrent(i.href);
            return (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={cx(
                    row,
                    active &&
                      'bg-info-bg font-semibold text-info-fg hover:bg-info-bg hover:text-info-fg',
                  )}
                >
                  <Icon name={i.icon} className="size-5 shrink-0" />
                  <span className="min-w-0">{i.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          <Link href="/hilfe" className={row}>
            <Icon name="help" className="size-5 shrink-0" />
            <span className="min-w-0">{t('help.accountLink')}</span>
          </Link>
          <button
            type="button"
            onClick={logout}
            className={cx(row, 'w-full cursor-pointer text-left')}
          >
            <Icon name="logout" className="size-5 shrink-0" />
            <span className="min-w-0">{t('account.logout')}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

/** A titled card section with an optional icon, used across the portal for a calm, uniform look. */
export function Section({
  title,
  icon,
  intro,
  aside,
  children,
  className,
  id,
}: {
  title: ReactNode;
  icon?: IconName;
  intro?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cx('rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-bg text-info-fg">
              <Icon name={icon} className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight wrap-anywhere">{title}</h2>
            {intro && <p className="mt-1 text-muted">{intro}</p>}
          </div>
        </div>
        {aside}
      </div>
      {children && <div className="mt-5 flex flex-col gap-4">{children}</div>}
    </section>
  );
}
