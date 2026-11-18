'use client';

import type { MessageKey } from '@parkshield/i18n';
import { LanguageSwitch, SkipLink, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { opsApi } from '@/lib/api';
import { cx } from '@/lib/cx';
import { label } from '@/lib/labels';
import type { StaffMe } from '@/lib/server';
import { Icon, LogoMark, type IconName } from './icons';

const IDLE_MS = 30 * 60_000;

/** A link styled as a secondary button, for page-header actions. */
export const linkButton =
  'inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 font-semibold text-primary transition hover:border-primary';

export interface NavItem {
  href: string;
  label: MessageKey;
  /** One sentence for the dashboard: what the area is for. */
  about?: MessageKey;
  icon: IconName;
  show: (can: (p: string) => boolean) => boolean;
  /** Pages without their own menu entry that belong to this area. */
  alsoActiveOn?: string[];
}

export interface NavGroup {
  label: MessageKey;
  items: NavItem[];
}

/** The menu mirrors permissions; the API checks them again on every call. */
export const NAV: NavGroup[] = [
  {
    label: 'ops.navGroupStart',
    items: [{ href: '/', label: 'ops.navHome', icon: 'home', show: () => true }],
  },
  {
    label: 'ops.navGroupCustomers',
    items: [
      {
        href: '/kunden',
        label: 'ops.navCustomers',
        about: 'ops.areaCustomers',
        icon: 'users',
        show: (can) => can('customer.read_masked'),
        alsoActiveOn: ['/warnungen'],
      },
      {
        href: '/datenschutz',
        label: 'ops.navDsr',
        about: 'ops.areaDsr',
        icon: 'shield',
        show: (can) => can('dsr.process'),
      },
      {
        href: '/break-glass',
        label: 'ops.navBreakGlass',
        about: 'ops.areaBreakGlass',
        icon: 'key',
        show: (can) => can('pii.decrypt_request') || can('pii.decrypt_approve'),
      },
    ],
  },
  {
    label: 'ops.navGroupSafety',
    items: [
      {
        href: '/missbrauch',
        label: 'ops.navAbuse',
        about: 'ops.areaAbuse',
        icon: 'flag',
        show: (can) => can('abuse.moderate'),
      },
      {
        href: '/missbrauch/pruefung',
        label: 'ops.navReview',
        about: 'ops.areaReview',
        icon: 'eye',
        show: (can) => can('moderation.review'),
      },
      {
        href: '/missbrauch/woerter',
        label: 'ops.navWords',
        about: 'ops.areaWords',
        icon: 'text',
        show: (can) => can('abuse.moderate'),
      },
    ],
  },
  {
    label: 'ops.navGroupOperations',
    items: [
      {
        href: '/bestellungen',
        label: 'ops.navOrders',
        about: 'ops.areaOrders',
        icon: 'box',
        show: (can) => can('orders.manage'),
      },
      {
        href: '/partner',
        label: 'ops.navPartners',
        about: 'ops.areaPartners',
        icon: 'handshake',
        show: (can) => can('partners.manage') || can('tokens.manage'),
      },
      {
        href: '/gutscheine',
        label: 'ops.navPromos',
        about: 'ops.areaPromos',
        icon: 'ticket',
        show: (can) => can('promo.manage'),
      },
    ],
  },
  {
    label: 'ops.navGroupSystem',
    items: [
      {
        href: '/einstellungen',
        label: 'ops.navSettings',
        about: 'ops.areaSettings',
        icon: 'sliders',
        show: (can) => can('settings.edit'),
      },
      {
        href: '/einstellungen/anbieter',
        label: 'ops.navHealth',
        about: 'ops.areaHealth',
        icon: 'activity',
        show: (can) => can('settings.edit'),
      },
      {
        href: '/audit',
        label: 'ops.navAudit',
        about: 'ops.areaAudit',
        icon: 'list',
        show: (can) => can('audit.read'),
      },
      {
        href: '/mitarbeitende',
        label: 'ops.navStaff',
        about: 'ops.areaStaff',
        icon: 'userCog',
        show: (can) => can('staff.manage'),
      },
    ],
  },
];

/** Visible groups for this staff member (empty groups dropped). */
export function visibleNav(me: StaffMe): NavGroup[] {
  const can = (p: string) => me.permissions.includes(p);
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.show(can)) })).filter(
    (g) => g.items.length,
  );
}

/** The most specific menu entry for a path, so /missbrauch/pruefung marks "Prüfung" only. */
function activeHref(groups: NavGroup[], pathname: string): string | undefined {
  let best: string | undefined;
  for (const item of groups.flatMap((g) => g.items)) {
    const prefixes = [item.href, ...(item.alsoActiveOn ?? [])];
    for (const p of prefixes) {
      const hit = p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`);
      if (hit && (!best || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}

/**
 * Frame for every signed-in page: a sidebar (collapsible on phones) with the areas grouped by task,
 * and one consistent page header. The server ends a staff session after 30 min without a request; the
 * timer here also leaves the page after 30 min without input, so nothing stays open on an unattended
 * screen.
 */
export function OpsShell({
  me,
  title,
  intro,
  back,
  actions,
  children,
}: {
  me: StaffMe;
  title?: ReactNode;
  intro?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer = setTimeout(leave, IDLE_MS);
    function leave() {
      window.location.assign('/anmelden?abgelaufen=1');
    }
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(leave, IDLE_MS);
    };
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, []);

  async function logout() {
    await opsApi('/ops/v1/auth/logout', { body: {} }).catch(() => {});
    window.location.assign('/anmelden');
  }

  const groups = visibleNav(me);
  const active = activeHref(groups, pathname);
  const current = groups.flatMap((g) => g.items).find((i) => i.href === active);

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <SkipLink>{t('common.skipToContent')}</SkipLink>
      <aside className="border-b border-border bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 px-4 py-4 lg:px-5 lg:pt-6 lg:pb-4">
          <Link href="/" className="flex min-h-12 shrink-0 items-center gap-3 rounded-lg">
            <LogoMark className="size-9 shrink-0" />
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight">ParkShield</span>
              <span className="block text-sm text-muted">{t('ops.brandSub')}</span>
            </span>
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="ops-nav"
            onClick={() => setOpen(!open)}
            className="flex min-h-12 min-w-0 cursor-pointer items-center gap-2 rounded-xl border border-border bg-bg px-3 font-semibold lg:hidden"
          >
            <span className="min-w-0 truncate">
              <span className="sr-only">{t('ops.navMenu')}: </span>
              {current ? t(current.label) : t('ops.navMenu')}
            </span>
            <Icon
              name="chevronDown"
              className={cx('size-5 shrink-0 transition', open && 'rotate-180')}
            />
          </button>
        </div>

        <div id="ops-nav" className={cx(open ? 'flex' : 'hidden', 'flex-1 flex-col lg:flex')}>
          <nav aria-label={t('ops.navLabel')} className="px-3 pb-2 lg:px-4">
            {groups.map((g) => (
              <div key={g.label} className="mb-3">
                <p className="px-3 pb-1 text-xs font-semibold tracking-wider text-muted uppercase">
                  {t(g.label)}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {g.items.map((i) => {
                    const isActive = i.href === active;
                    return (
                      <li key={i.href}>
                        <Link
                          href={i.href}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => setOpen(false)}
                          className={cx(
                            'flex min-h-10 items-center gap-3 rounded-xl px-3 font-medium transition',
                            isActive
                              ? 'bg-info-bg font-semibold text-info-fg'
                              : 'hover:bg-secondary hover:text-secondary-fg',
                          )}
                        >
                          <Icon name={i.icon} className="size-5 shrink-0" />
                          <span className="min-w-0">{t(i.label)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="mt-auto border-t border-border px-4 py-3 lg:px-5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-info-bg font-bold text-info-fg">
                {(me.name ?? me.email).charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="sr-only">{t('ops.signedInAs')}</p>
                <p className="truncate font-semibold" title={me.email}>
                  {me.name ?? me.email}
                </p>
                <p className="truncate text-xs text-muted">
                  {me.roles.map((r) => label(t, 'role', r)).join(' · ') || me.email}
                </p>
              </div>
            </div>
            <LanguageSwitch className="mt-2 px-1" />
            <button
              type="button"
              onClick={logout}
              className="mt-2 flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-xl px-3 font-medium hover:bg-secondary hover:text-secondary-fg"
            >
              <Icon name="logout" className="size-5 shrink-0" />
              {t('ops.logout')}
            </button>
            <p className="mt-1 flex items-center gap-2 px-3 text-xs text-muted">
              <Icon name="clock" className="size-3.5 shrink-0" />
              {t('ops.sessionShort')}
            </p>
          </div>
        </div>
      </aside>

      <main id="main" className="min-w-0">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {back && (
            <Link
              href={back.href}
              className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-lg font-semibold text-primary underline-offset-4 hover:underline"
            >
              <Icon name="arrowLeft" className="size-4" />
              {back.label}
            </Link>
          )}
          {title && (
            <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-3xl">
                <h1 className="text-3xl font-bold tracking-tight wrap-anywhere">{title}</h1>
                {intro && <div className="mt-2 text-muted">{intro}</div>}
              </div>
              {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
            </header>
          )}
          <div className="flex flex-col gap-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** A titled card section, used across the back office for a calm, uniform look. */
export function Section({
  title,
  icon,
  intro,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  icon?: IconName;
  intro?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
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
