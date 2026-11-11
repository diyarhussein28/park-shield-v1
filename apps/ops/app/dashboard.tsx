'use client';

import { Badge, Card, Heading, Stack, Text, useI18n } from '@parkshield/ui';
import { OpsShell } from '@/components/ops-shell';
import type { StaffMe } from '@/lib/server';

export function Dashboard({ me }: { me: StaffMe }) {
  const { t } = useI18n();
  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{me.name ?? me.email}</Heading>
          <Text muted>{t('ops.vpnOnly')}</Text>
          <Text muted className="text-sm">
            {t('ops.sessionNote')}
          </Text>
        </div>
        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('ops.roles')}
            </Heading>
            {me.roles.length ? (
              <ul className="flex flex-wrap gap-2" aria-label={t('ops.roles')}>
                {me.roles.map((r) => (
                  <li key={r}>
                    <Badge tone="info">{r}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <Text muted>{t('ops.noRoles')}</Text>
            )}
            <Heading level={2} className="text-xl">
              {t('ops.permissions')}
            </Heading>
            <ul
              className="grid gap-1 font-mono text-sm sm:grid-cols-2"
              aria-label={t('ops.permissions')}
            >
              {me.permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Stack>
        </Card>
      </Stack>
    </OpsShell>
  );
}
