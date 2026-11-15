'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Badge, Card, Heading, Stack, Text, useI18n } from '@parkshield/ui';
import { OpsShell } from '@/components/ops-shell';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';
import { label } from '@/lib/labels';

export interface TraceData {
  alert: {
    id: string;
    customerId: string | null;
    nickname: string;
    type: string;
    severity: string;
    status: string;
    isTest: boolean;
    hasMessage: boolean;
    ownerReply: string | null;
    timeline: Record<string, string | null>;
  };
  deliveries: {
    id: string;
    recipient: string;
    channel: string;
    provider: string;
    status: string;
    suppressedReason: string | null;
    errorCode: string | null;
    attempt: number;
    costEur: number;
    queuedAt: string;
    sentAt: string | null;
    deliveredAt: string | null;
    readAt: string | null;
  }[];
}

/** AD-04: every attempt, never the free text. */
export function Trace({ me, data }: { me: StaffMe; data: TraceData }) {
  const { t, locale } = useI18n();
  const a = data.alert;
  const d = (v: string | null) => fmt(v, locale);
  return (
    <OpsShell
      me={me}
      back={
        a.customerId
          ? { href: `/kunden/${a.customerId}`, label: t('opsTrace.toCustomer') }
          : undefined
      }
      title={
        <>
          {t('opsTrace.title')}: {label(t, 'type', a.type)} · „{a.nickname}“
        </>
      }
    >
      <Stack gap={6}>
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge>{label(t, 'alert', a.status)}</Badge>
            <Badge tone={a.severity === 'urgent' ? 'warning' : 'info'}>
              {label(t, 'severity', a.severity)}
            </Badge>
            {a.isTest && <Badge tone="info">Test</Badge>}
            {a.hasMessage && <Badge>{t('opsTrace.hasMessage')}</Badge>}
            {a.ownerReply && <Badge tone="success">{a.ownerReply}</Badge>}
          </div>
          <Text muted className="mt-2">
            {t('opsTrace.noContent')}
          </Text>
        </div>
        <Card>
          <Stack gap={2}>
            <Heading level={2} className="text-xl">
              {t('opsTrace.timeline')}
            </Heading>
            <dl className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
              {Object.entries(a.timeline).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{t(`opsTrace.${k}` as MessageKey)}</dt>
                  <dd>{d(v)}</dd>
                </div>
              ))}
            </dl>
          </Stack>
        </Card>
        <Card>
          <Stack gap={2}>
            <Heading level={2} className="text-xl">
              {t('opsTrace.deliveries')}
            </Heading>
            {/* Focusable so keyboard users can scroll the wide table (WCAG 2.1.1). */}
            <div
              className="overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label={t('opsTrace.deliveries')}
            >
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t('opsTrace.deliveries')}</caption>
                <thead>
                  <tr>
                    {(
                      [
                        'recipient',
                        'channel',
                        'provider',
                        'status',
                        'reason',
                        'attempt',
                        'cost',
                        'queued',
                        'sent',
                        'delivered',
                        'read',
                      ] as const
                    ).map((h) => (
                      <th key={h} scope="col" className="border-b border-border px-2 py-1">
                        {t(`opsTrace.${h}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.deliveries.map((x) => (
                    <tr key={x.id}>
                      <td className="px-2 py-1">{label(t, 'recipient', x.recipient)}</td>
                      <td className="px-2 py-1">{label(t, 'channel', x.channel)}</td>
                      <td className="px-2 py-1">{x.provider}</td>
                      <td className="px-2 py-1">{label(t, 'delivery', x.status)}</td>
                      <td className="px-2 py-1">{x.suppressedReason ?? x.errorCode ?? '–'}</td>
                      <td className="px-2 py-1">{x.attempt}</td>
                      <td className="px-2 py-1">{x.costEur.toFixed(3)} €</td>
                      <td className="px-2 py-1">{d(x.queuedAt)}</td>
                      <td className="px-2 py-1">{d(x.sentAt)}</td>
                      <td className="px-2 py-1">{d(x.deliveredAt)}</td>
                      <td className="px-2 py-1">{d(x.readAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Stack>
        </Card>
      </Stack>
    </OpsShell>
  );
}
