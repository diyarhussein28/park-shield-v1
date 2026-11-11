'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Badge,
  Button,
  Card,
  Field,
  Heading,
  Input,
  Notice,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

interface Ref {
  ref: string;
  refShort: string;
  blocked: boolean;
}
export interface Patterns {
  thresholds: { perHour: number; vehiclesPerDay: number; reportsPerDay: number };
  busyCodes: {
    tokenId: string;
    codeHint: string;
    nickname: string;
    customerId: string;
    alerts: number;
  }[];
  roamingScanners: (Ref & { vehicles: number; alerts: number })[];
  reportedScanners: (Ref & { owners: number })[];
  fakeDecals: {
    tokenId: string;
    codeHint: string;
    nickname: string | null;
    customerId: string | null;
    reports: number;
  }[];
}
export interface Reports {
  reports: {
    id: string;
    kind: string;
    reason: string;
    note: string | null;
    createdAt: string;
    alertType: string | null;
    tokenId: string | null;
    codeHint: string | null;
    nickname: string | null;
    customerId: string | null;
    scannerRef: string | null;
    scannerRefShort: string | null;
  }[];
}
export interface Blocks {
  blocks: {
    ref: string;
    refShort: string;
    scope: 'vehicle' | 'global';
    tokenId: string | null;
    nickname: string | null;
    reason: string;
    expiresAt: string;
  }[];
}

function Group({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section>
      <Heading level={3} className="mb-2 text-lg">
        {title}
      </Heading>
      {empty ? (
        <Text muted>{t('opsAbuse.nothing')}</Text>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </section>
  );
}

/** AD-08: patterns, reports and blocks in one place, with the actions next to them. */
export function AbuseCentre({
  me,
  patterns,
  reports,
  blocks,
}: {
  me: StaffMe;
  patterns: Patterns | null;
  reports: Reports | null;
  blocks: Blocks | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const canRevoke = me.permissions.includes('tokens.manage');

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ tone: 'success', text: ok });
      router.refresh();
    } catch {
      setMessage({ tone: 'danger', text: t('ops.error') });
    }
  };
  const blockGlobally = (ref: string) =>
    run(() => opsApi('/ops/v1/abuse/blocks', { body: { ref, reason: 'pattern' } }));
  const ScannerBlock = ({ r }: { r: Ref }) =>
    r.blocked ? (
      <Badge tone="warning">{t('opsAbuse.blocked')}</Badge>
    ) : (
      <Button variant="secondary" onClick={() => blockGlobally(r.ref)}>
        {t('opsAbuse.blockGlobal')}
        <span className="sr-only"> ({r.refShort})</span>
      </Button>
    );

  if (!patterns || !reports || !blocks) {
    return (
      <OpsShell me={me}>
        <Notice tone="danger">{t('ops.forbidden')}</Notice>
      </OpsShell>
    );
  }
  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <Heading level={1}>{t('opsAbuse.title')}</Heading>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <Card>
          <Stack gap={4}>
            <Heading level={2} className="text-xl">
              {t('opsAbuse.patterns')}
            </Heading>
            <Group
              title={t('opsAbuse.busyCodes', { n: patterns.thresholds.perHour })}
              empty={!patterns.busyCodes.length}
            >
              {patterns.busyCodes.map((c) => (
                <li key={c.tokenId} className="flex flex-wrap items-center gap-3">
                  <span className="font-mono">…{c.codeHint}</span> „{c.nickname}“ ·{' '}
                  {t('opsAbuse.alerts', { n: c.alerts })}
                  <Link href={`/kunden/${c.customerId}`} className="text-primary underline">
                    {t('opsAbuse.customer')}
                  </Link>
                  {canRevoke && (
                    <Revoke
                      tokenId={c.tokenId}
                      onDone={(ok) => run(async () => ok, t('opsAbuse.revoked'))}
                    />
                  )}
                </li>
              ))}
            </Group>
            <Group
              title={t('opsAbuse.roaming', { n: patterns.thresholds.vehiclesPerDay })}
              empty={!patterns.roamingScanners.length}
            >
              {patterns.roamingScanners.map((s) => (
                <li key={s.ref} className="flex flex-wrap items-center gap-3">
                  {t('opsAbuse.scanner', { ref: s.refShort })} ·{' '}
                  {t('opsAbuse.vehicles', { n: s.vehicles })} ·{' '}
                  {t('opsAbuse.alerts', { n: s.alerts })}
                  <ScannerBlock r={s} />
                </li>
              ))}
            </Group>
            <Group
              title={t('opsAbuse.reported', { n: patterns.thresholds.reportsPerDay })}
              empty={!patterns.reportedScanners.length}
            >
              {patterns.reportedScanners.map((s) => (
                <li key={s.ref} className="flex flex-wrap items-center gap-3">
                  {t('opsAbuse.scanner', { ref: s.refShort })} ·{' '}
                  {t('opsAbuse.owners', { n: s.owners })}
                  <ScannerBlock r={s} />
                </li>
              ))}
            </Group>
            <Group title={t('opsAbuse.fake')} empty={!patterns.fakeDecals.length}>
              {patterns.fakeDecals.map((f) => (
                <li key={f.tokenId} className="flex flex-wrap items-center gap-3">
                  <span className="font-mono">…{f.codeHint}</span>{' '}
                  {f.nickname ? `„${f.nickname}“` : ''} · {t('opsAbuse.reportsN', { n: f.reports })}
                  {canRevoke && f.nickname && (
                    <Revoke
                      tokenId={f.tokenId}
                      onDone={(ok) => run(async () => ok, t('opsAbuse.revoked'))}
                    />
                  )}
                </li>
              ))}
            </Group>
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsAbuse.reports')}
            </Heading>
            {reports.reports.length === 0 ? (
              <Text muted>{t('opsAbuse.nothing')}</Text>
            ) : (
              <ul className="flex flex-col gap-3" aria-label={t('opsAbuse.reports')}>
                {reports.reports.map((r) => (
                  <li key={r.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{t(`opsAbuse.kind_${r.kind}` as MessageKey)}</Badge>
                      <span className="font-semibold">{r.reason}</span>
                      <span className="text-sm text-muted">{fmt(r.createdAt, locale)}</span>
                      {r.codeHint && <span className="font-mono text-sm">…{r.codeHint}</span>}
                      {r.nickname && <span className="text-sm">„{r.nickname}“</span>}
                    </div>
                    {r.note && <Text className="text-sm">{r.note}</Text>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          run(() =>
                            opsApi(`/ops/v1/abuse/reports/${r.id}`, {
                              body: { status: 'actioned' },
                            }),
                          )
                        }
                      >
                        {t('opsAbuse.actioned')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          run(() =>
                            opsApi(`/ops/v1/abuse/reports/${r.id}`, {
                              body: { status: 'dismissed' },
                            }),
                          )
                        }
                      >
                        {t('opsAbuse.dismiss')}
                      </Button>
                      {r.scannerRef && (
                        <Button variant="ghost" onClick={() => blockGlobally(r.scannerRef!)}>
                          {t('opsAbuse.blockGlobal')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsAbuse.blocks')}
            </Heading>
            {blocks.blocks.length === 0 ? (
              <Text muted>{t('opsAbuse.nothing')}</Text>
            ) : (
              <ul className="flex flex-col gap-2" aria-label={t('opsAbuse.blocks')}>
                {blocks.blocks.map((b) => (
                  <li key={`${b.ref}-${b.tokenId}`} className="flex flex-wrap items-center gap-3">
                    {t('opsAbuse.scanner', { ref: b.refShort })} ·{' '}
                    {b.scope === 'global'
                      ? t('opsAbuse.scope_global')
                      : t('opsAbuse.scope_vehicle', { nickname: b.nickname ?? '?' })}{' '}
                    · {b.reason} · {t('opsAbuse.until', { date: new Date(b.expiresAt) })}
                    <Button
                      variant="ghost"
                      onClick={() =>
                        run(() =>
                          opsApi('/ops/v1/abuse/blocks', {
                            method: 'DELETE',
                            body: { ref: b.ref, tokenId: b.tokenId },
                          }),
                        )
                      }
                    >
                      {t('opsAbuse.unblock')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Stack>
        </Card>
      </Stack>
    </OpsShell>
  );
}

function Revoke({ tokenId, onDone }: { tokenId: string; onDone: (ok: boolean) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t('opsAbuse.revoke')}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-end gap-2">
      <Field label={t('opsAbuse.revokeReason')}>
        {({ id }) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Button
        variant="danger"
        disabled={reason.trim().length < 3}
        onClick={async () => {
          await opsApi(`/ops/v1/abuse/tokens/${tokenId}/revoke`, { body: { reason } });
          setOpen(false);
          onDone(true);
        }}
      >
        {t('opsAbuse.revoke')}
      </Button>
    </span>
  );
}
