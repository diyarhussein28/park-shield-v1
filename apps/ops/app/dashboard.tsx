'use client';

import { Badge, Notice, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { OpsShell, Section, visibleNav } from '@/components/ops-shell';
import { cx } from '@/lib/cx';
import { label } from '@/lib/labels';
import type { Overview, StaffMe } from '@/lib/server';

interface Todo {
  href: string;
  icon: IconName;
  text: string;
  detail?: string;
  tone: 'danger' | 'warning' | 'info';
}

/** Start page: what is waiting, key figures, the areas this person can open, and their access. */
export function Dashboard({ me, overview: o }: { me: StaffMe; overview: Overview | null }) {
  const { t, locale } = useI18n();
  const num = (v: number) => new Intl.NumberFormat(locale).format(v);
  const firstName = me.name?.split(' ')[0] ?? me.email;

  const todos: Todo[] = [];
  if (o?.providers?.critical)
    todos.push({
      href: '/einstellungen/anbieter',
      icon: 'activity',
      text: t('ops.todoProvidersCritical', { count: o.providers.critical }),
      tone: 'danger',
    });
  if (o?.dsr?.open)
    todos.push({
      href: '/datenschutz',
      icon: 'shield',
      text: t('ops.todoDsr', { count: o.dsr.open }),
      detail: o.dsr.dueSoon ? t('ops.todoDsrDue', { count: o.dsr.dueSoon }) : undefined,
      tone: o.dsr.dueSoon ? 'danger' : 'warning',
    });
  if (o?.breakGlass?.waitingForApproval)
    todos.push({
      href: '/break-glass',
      icon: 'key',
      text: t('ops.todoBreakGlass', { count: o.breakGlass.waitingForApproval }),
      tone: 'warning',
    });
  if (o?.abuse?.openReports)
    todos.push({
      href: '/missbrauch',
      icon: 'flag',
      text: t('ops.todoAbuse', { count: o.abuse.openReports }),
      tone: 'warning',
    });
  if (o?.review?.pending)
    todos.push({
      href: '/missbrauch/pruefung',
      icon: 'eye',
      text: t('ops.todoReview', { count: o.review.pending }),
      tone: 'info',
    });
  if (o?.stock?.low)
    todos.push({
      href: '/lager',
      icon: 'layers',
      text: t('ops.todoStockLow', { count: o.stock.ready }),
      tone: 'warning',
    });
  if (o?.orders?.toProduce)
    todos.push({
      href: '/bestellungen',
      icon: 'box',
      text: t('ops.todoOrders', { count: o.orders.toProduce }),
      tone: 'info',
    });
  if (o?.providers?.warnings)
    todos.push({
      href: '/einstellungen/anbieter',
      icon: 'activity',
      text: t('ops.todoProvidersWarning', { count: o.providers.warnings }),
      tone: 'info',
    });

  const kpis: { label: string; value: number; href?: string; emphasis?: boolean }[] = [];
  if (o?.customers) {
    kpis.push(
      { label: t('ops.kpiCustomers'), value: o.customers.total, href: '/kunden' },
      { label: t('ops.kpiActive'), value: o.customers.activeSubscriptions, href: '/kunden' },
      { label: t('ops.kpiNew'), value: o.customers.newLast7Days },
    );
  }
  if (o?.alerts) {
    kpis.push(
      { label: t('ops.kpiAlertsToday'), value: o.alerts.today },
      { label: t('ops.kpiAlertsWeek'), value: o.alerts.last7Days },
      { label: t('ops.kpiUrgent'), value: o.alerts.urgentLast7Days },
      {
        label: t('ops.kpiUnanswered'),
        value: o.alerts.unanswered7Days,
        emphasis: o.alerts.unanswered7Days > 0,
      },
    );
  }
  if (o?.orders) {
    kpis.push({
      label: t('ops.kpiInProduction'),
      value: o.orders.inProduction,
      href: '/bestellungen',
    });
  }
  if (o?.stock) {
    kpis.push({
      label: t('ops.kpiStockReady'),
      value: o.stock.ready,
      href: '/lager',
      emphasis: o.stock.low,
    });
  }

  const areas = visibleNav(me)
    .flatMap((g) => g.items)
    .filter((i) => i.about);

  const toneRow = {
    danger: 'border-danger/40 bg-danger-bg text-danger-text',
    warning: 'border-border bg-warning-bg text-warning-fg',
    info: 'border-border bg-info-bg text-info-fg',
  } as const;

  return (
    <OpsShell me={me} title={t('ops.dashGreeting', { name: firstName })} intro={t('ops.dashIntro')}>
      {!o && <Notice tone="warning">{t('ops.dashLoadError')}</Notice>}

      {o && (
        <Section title={t('ops.dashTodoTitle')} icon="bell" intro={t('ops.dashTodoIntro')}>
          {todos.length === 0 ? (
            <p className="flex items-center gap-3 rounded-xl bg-success-bg px-4 py-3 font-medium text-success-fg">
              <Icon name="checkCircle" className="size-5 shrink-0" />
              {t('ops.dashAllDone')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {todos.map((x) => (
                <li key={x.text}>
                  <Link
                    href={x.href}
                    className={cx(
                      'flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 font-semibold transition hover:brightness-95',
                      toneRow[x.tone],
                    )}
                  >
                    <Icon name={x.icon} className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      {x.text}
                      {x.detail && <span className="block text-sm font-normal">{x.detail}</span>}
                    </span>
                    <Icon name="arrowRight" className="size-5 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {kpis.length > 0 && (
        <Section title={t('ops.dashKpiTitle')} icon="activity" intro={t('ops.dashKpiIntro')}>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => {
              const body = (
                <>
                  <span className="block text-sm text-muted">{k.label}</span>
                  <span
                    className={cx(
                      'mt-1 block text-3xl font-bold tabular-nums tracking-tight',
                      k.emphasis && 'text-danger',
                    )}
                  >
                    {num(k.value)}
                  </span>
                </>
              );
              return (
                <li key={k.label}>
                  {k.href ? (
                    <Link
                      href={k.href}
                      className="block h-full rounded-xl border border-border bg-bg px-4 py-3 transition hover:border-primary"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="h-full rounded-xl border border-border bg-bg px-4 py-3">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {areas.length > 0 && (
        <Section title={t('ops.dashAreasTitle')} icon="list" intro={t('ops.dashAreasIntro')}>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {areas.map((a) => (
              <li key={a.href}>
                <Link
                  href={a.href}
                  className="group flex h-full gap-3 rounded-xl border border-border bg-bg p-4 transition hover:border-primary"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-bg text-info-fg">
                    <Icon name={a.icon} className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 font-semibold text-primary group-hover:underline">
                      {t(a.label)}
                      <Icon name="arrowRight" className="size-4" />
                    </span>
                    <span className="mt-1 block text-sm text-muted">{t(a.about!)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('ops.dashAccessTitle')} icon="lock" intro={t('ops.dashAccessIntro')}>
        {me.roles.length ? (
          <ul className="flex flex-wrap gap-2" aria-label={t('ops.roles')}>
            {me.roles.map((r) => (
              <li key={r}>
                <Badge tone="info">{label(t, 'role', r)}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('ops.noRoles')}</p>
        )}
        <details className="rounded-xl border border-border bg-bg px-4 py-3">
          <summary className="min-h-8 cursor-pointer font-semibold">
            {t('ops.dashPermissionsShow')} ({me.permissions.length})
          </summary>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label={t('ops.permissions')}>
            {me.permissions.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm">
                <Icon name="check" className="mt-0.5 size-4 shrink-0 text-success-fg" />
                <span>{label(t, 'perm', p)}</span>
              </li>
            ))}
          </ul>
        </details>
      </Section>
    </OpsShell>
  );
}
