'use client';

import {
  Badge,
  Button,
  Card,
  Checkbox,
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
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

export interface AuditData {
  entries: {
    id: string;
    action: string;
    isRead: boolean;
    entity: string;
    entityId: string | null;
    meta: Record<string, unknown>;
    at: string;
    actor: string | null;
  }[];
  stream: {
    lastId: string;
    lastKey: string | null;
    updatedAt: string;
    pending: number;
    oldestPendingAt: string | null;
  };
}
interface Verify {
  ok: boolean;
  objects: number;
  rows: number;
  problems: string[];
}

/** US-42 / AD-17: the trail, actions and reads, and the state of its copy in the locked bucket. */
export function AuditView({
  me,
  data,
  action,
  hideReads,
}: {
  me: StaffMe;
  data: AuditData | null;
  action: string;
  hideReads: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState(action);
  const [noReads, setNoReads] = useState(hideReads);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [busy, setBusy] = useState(false);
  const last = data?.entries.at(-1);
  const query = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      ...(filter ? { action: filter } : {}),
      ...(noReads ? { reads: 'false' } : {}),
      ...extra,
    }).toString();

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsAudit.title')}</Heading>
          <Text muted>{t('opsAudit.intro')}</Text>
        </div>
        {!data && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        {data && (
          <Card>
            <Stack gap={2}>
              <Heading level={2} className="text-xl">
                {t('opsAudit.stream')}
              </Heading>
              <p>
                {data.stream.pending === 0
                  ? t('opsAudit.streamUpToDate', { id: data.stream.lastId })
                  : t('opsAudit.streamPending', {
                      count: data.stream.pending,
                      since: fmt(data.stream.oldestPendingAt, locale),
                    })}
              </p>
              {data.stream.lastKey && (
                <p className="font-mono text-sm break-all">{data.stream.lastKey}</p>
              )}
              <Button
                variant="secondary"
                className="w-fit"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setVerify(await opsApi<Verify>('/ops/v1/audit/verify', { body: {} }));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('opsAudit.verify')}
              </Button>
              {verify && (
                <Notice tone={verify.ok ? 'success' : 'danger'}>
                  {verify.ok
                    ? t('opsAudit.verifyOk', { objects: verify.objects, rows: verify.rows })
                    : t('opsAudit.verifyFailed', { count: verify.problems.length })}
                  {!verify.ok && (
                    <ul className="mt-2 list-disc pl-5 text-sm">
                      {verify.problems.slice(0, 10).map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </Notice>
              )}
            </Stack>
          </Card>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            router.push(`/audit?${query()}`);
          }}
        >
          <div className="sm:min-w-72">
            <Field label={t('opsAudit.filter')} hint={t('opsAudit.filterHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Checkbox
            label={t('opsAudit.hideReads')}
            checked={noReads}
            onChange={(e) => setNoReads(e.target.checked)}
          />
          <Button type="submit" variant="secondary">
            {t('opsAudit.apply')}
          </Button>
        </form>
        {data && (
          <ul className="flex flex-col gap-2" aria-label={t('opsAudit.entries')}>
            {data.entries.length === 0 && <li>{t('opsAudit.empty')}</li>}
            {data.entries.map((e) => (
              <li key={e.id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">#{e.id}</span>
                  <span className="font-semibold">{e.action}</span>
                  {e.isRead && <Badge tone="info">{t('opsAudit.read')}</Badge>}
                  <span>{fmt(e.at, locale)}</span>
                  <span className="text-muted">{e.actor ?? t('opsAudit.system')}</span>
                </div>
                <p className="mt-1 font-mono break-all text-muted">
                  {e.entity}
                  {e.entityId ? ` ${e.entityId}` : ''}{' '}
                  {Object.keys(e.meta).length ? JSON.stringify(e.meta) : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        {last && data && data.entries.length >= 100 && (
          <Link href={`/audit?${query({ before: last.id })}`} className="text-primary underline">
            {t('opsAudit.older')}
          </Link>
        )}
      </Stack>
    </OpsShell>
  );
}
