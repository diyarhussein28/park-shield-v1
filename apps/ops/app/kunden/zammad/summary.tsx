'use client';

import { Card, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { OpsShell } from '@/components/ops-shell';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

export type Summary =
  | { found: false }
  | {
      found: true;
      id: string;
      email: string;
      status: string;
      customerSince: string;
      subscription: {
        plan: string;
        status: string;
        periodEnd: string | null;
        cancelAtPeriodEnd: boolean;
      } | null;
      vehicles: number;
      activeDecals: number;
      pushDevices: number;
      whatsapp: boolean;
      contacts: number;
      lastAlertAt: string | null;
      openDsr: number;
      protection: number;
    };

/** AD-20: the masked summary next to a Zammad ticket, with the way to the full Customer 360. */
export function ZammadSummary({ me, data }: { me: StaffMe; data: Summary | null }) {
  const { t, locale } = useI18n();
  return (
    <OpsShell me={me}>
      <Stack gap={4}>
        <Heading level={1}>{t('opsZammad.title')}</Heading>
        {!data && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        {data && !data.found && <Notice tone="info">{t('opsZammad.notFound')}</Notice>}
        {data?.found && (
          <Card>
            <Stack gap={3}>
              <Text className="font-semibold">{data.email}</Text>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt>{t('opsZammad.plan')}</dt>
                <dd>
                  {data.subscription
                    ? `${data.subscription.plan} · ${data.subscription.status} · ${fmt(data.subscription.periodEnd, locale)}${data.subscription.cancelAtPeriodEnd ? ' · ✕' : ''}`
                    : t('opsCustomers.noSubscription')}
                </dd>
                <dt>{t('opsZammad.since')}</dt>
                <dd>{fmt(data.customerSince, locale)}</dd>
                <dt>{t('opsZammad.vehicles')}</dt>
                <dd>
                  {t('opsZammad.vehiclesValue', {
                    vehicles: data.vehicles,
                    active: data.activeDecals,
                  })}
                </dd>
                <dt>{t('opsZammad.channels')}</dt>
                <dd>
                  {t('opsZammad.channelsValue', {
                    push: data.pushDevices,
                    whatsapp: data.whatsapp ? t('ops.yes') : t('ops.no'),
                  })}
                </dd>
                <dt>{t('opsZammad.contacts')}</dt>
                <dd>{data.contacts}</dd>
                <dt>{t('opsZammad.protection')}</dt>
                <dd>{data.protection} %</dd>
                <dt>{t('opsZammad.lastAlert')}</dt>
                <dd>{fmt(data.lastAlertAt, locale)}</dd>
                <dt>{t('opsZammad.openDsr')}</dt>
                <dd>{data.openDsr}</dd>
              </dl>
              <Link href={`/kunden/${data.id}`} className="text-primary underline">
                {t('opsZammad.open360')}
              </Link>
            </Stack>
          </Card>
        )}
      </Stack>
    </OpsShell>
  );
}
