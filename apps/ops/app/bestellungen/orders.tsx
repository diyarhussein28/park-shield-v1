'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Badge, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { OpsShell } from '@/components/ops-shell';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

export interface OrderRow {
  id: string;
  status: string;
  createdAt: string;
  shippedAt: string | null;
  returnedAt: string | null;
  trackingNumber: string | null;
  printRef: string | null;
  totalCents: number;
  included: boolean;
  replacement: boolean;
  reprintOf: string | null;
  note: string | null;
  product: string;
  codeHint: string;
  nickname: string | null;
  customerId: string | null;
  customer: string | null;
}
export interface OrderList {
  orders: OrderRow[];
}

const FILTERS = ['open', 'attention', 'shipped', 'returned', 'all'] as const;

export function orderKind(o: Pick<OrderRow, 'included' | 'replacement' | 'reprintOf'>) {
  if (o.reprintOf) return 'reprint';
  if (o.included) return 'included';
  if (o.replacement) return 'replacement';
  return 'paid';
}

export const statusTone = (s: string) =>
  s === 'returned' || s === 'canceled'
    ? 'danger'
    : s === 'delivered' || s === 'refunded'
      ? 'success'
      : s === 'shipped'
        ? 'info'
        : 'warning';

/** US-39: the order pipeline. Masked customer, no address, no code beyond the last 4 characters. */
export function OrdersView({
  me,
  filter,
  data,
}: {
  me: StaffMe;
  filter: (typeof FILTERS)[number];
  data: OrderList | null;
}) {
  const { t, locale } = useI18n();
  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsOrders.title')}</Heading>
          <Text muted>{t('opsOrders.intro')}</Text>
        </div>
        {!data && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        <nav aria-label={t('opsOrders.filters')} className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f}
              href={`/bestellungen?filter=${f}`}
              aria-current={f === filter ? 'page' : undefined}
              className={
                f === filter
                  ? 'rounded-xl bg-primary px-4 py-2 font-semibold text-primary-fg'
                  : 'rounded-xl border border-border px-4 py-2 text-primary underline'
              }
            >
              {t(`opsOrders.filter_${f}` as MessageKey)}
            </Link>
          ))}
        </nav>
        {data && (
          <ul className="flex flex-col gap-3" aria-label={t('opsOrders.list')}>
            {data.orders.length === 0 && <li>{t('opsOrders.empty')}</li>}
            {data.orders.map((o) => (
              <li key={o.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(o.status)}>
                    {t(`opsOrders.status_${o.status}` as MessageKey)}
                  </Badge>
                  <Badge>{t(`opsOrders.kind_${orderKind(o)}` as MessageKey)}</Badge>
                  <span className="font-semibold">„{o.nickname ?? '–'}“</span>
                  <span className="font-mono text-sm">…{o.codeHint}</span>
                  <span className="text-sm text-muted">{o.customer ?? '–'}</span>
                </div>
                <p className="mt-1 text-sm">
                  {t('opsOrders.created', { date: fmt(o.createdAt, locale) })}
                  {o.trackingNumber &&
                    ` · ${t('opsOrders.tracking', { number: o.trackingNumber })}`}
                  {o.note && ` · „${o.note}“`}
                </p>
                <Link href={`/bestellungen/${o.id}`} className="text-primary underline">
                  {t('opsOrders.open')}
                  <span className="sr-only">
                    {' '}
                    ({o.nickname ?? o.codeHint}, {fmt(o.createdAt, locale)})
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </OpsShell>
  );
}
