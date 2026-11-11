'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Badge, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { OpsShell } from '@/components/ops-shell';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

export interface Health {
  checks: {
    key: string;
    provider: string;
    level: 'ok' | 'warning' | 'critical' | 'unknown';
    value: string;
    since?: string | null;
  }[];
}

const tone = { ok: 'success', warning: 'warning', critical: 'danger', unknown: 'neutral' } as const;

/** US-41 / AD-16: every provider on one screen; the team is mailed when a check gets worse. */
export function HealthView({ me, data }: { me: StaffMe; data: Health | null }) {
  const { t, locale } = useI18n();
  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsHealth.title')}</Heading>
          <Text muted>{t('opsHealth.intro')}</Text>
          <Link href="/einstellungen" className="text-primary underline">
            {t('opsHealth.toSettings')}
          </Link>
        </div>
        {!data && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        {data && (
          <ul className="grid gap-3 md:grid-cols-2" aria-label={t('opsHealth.title')}>
            {data.checks.map((c) => (
              <li key={c.key} className="flex flex-col gap-1 rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {t(`opsHealth.c_${c.key.replace(/\./g, '_')}` as MessageKey)}
                  </span>
                  <Badge tone={tone[c.level]}>
                    {t(`opsHealth.level_${c.level}` as MessageKey)}
                  </Badge>
                </div>
                <p className="font-mono text-sm break-words">{c.value}</p>
                <p className="text-sm text-muted">
                  {t(`opsHealth.h_${c.key.replace(/\./g, '_')}` as MessageKey)}
                </p>
                {c.since && (
                  <p className="text-sm text-muted">
                    {t('opsHealth.since', { date: fmt(c.since, locale) })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </OpsShell>
  );
}
