'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Badge, Button, Card, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useState } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

interface BgRequest {
  id: string;
  target: string;
  targetId: string;
  reason: string;
  ticketRef: string | null;
  status: string;
  notifyCustomer: boolean;
  validUntil: string | null;
  createdAt: string;
  mine: boolean;
  requester: string;
  approver: string | null;
}
export interface BgList {
  requests: BgRequest[];
}

/** AD-06: approvals for others' requests, and reveals of one's own approved ones. */
export function BreakGlassView({ me, initial }: { me: StaffMe; initial: BgList }) {
  const { t } = useI18n();
  const [list, setList] = useState(initial.requests);
  const reload = async () => setList((await opsApi<BgList>('/ops/v1/break-glass')).requests);
  const pending = list.filter((r) => !r.mine && r.status === 'requested');
  const mine = list.filter((r) => r.mine);
  const canApprove = me.permissions.includes('pii.decrypt_approve');

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsBg.title')}</Heading>
          <Text muted>{t('opsBg.intro')}</Text>
        </div>
        {canApprove && (
          <section aria-labelledby="bg-pending">
            <Heading level={2} id="bg-pending" className="mb-3 text-xl">
              {t('opsBg.pending')}
            </Heading>
            {pending.length === 0 ? (
              <Text muted>{t('opsBg.none')}</Text>
            ) : (
              <ul className="flex flex-col gap-3" aria-label={t('opsBg.pending')}>
                {pending.map((r) => (
                  <li key={r.id}>
                    <Approval request={r} onDone={reload} />
                  </li>
                ))}
              </ul>
            )}
            <Text muted className="mt-2 text-sm">
              {t('opsBg.ownRequest')}
            </Text>
          </section>
        )}
        <section aria-labelledby="bg-mine">
          <Heading level={2} id="bg-mine" className="mb-3 text-xl">
            {t('opsBg.mine')}
          </Heading>
          {mine.length === 0 ? (
            <Text muted>{t('opsBg.none')}</Text>
          ) : (
            <ul className="flex flex-col gap-3" aria-label={t('opsBg.mine')}>
              {mine.map((r) => (
                <li key={r.id}>
                  <MyRequest request={r} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Stack>
    </OpsShell>
  );
}

function Summary({ r }: { r: BgRequest }) {
  const { t, locale } = useI18n();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{r.target}</span>
        <Badge>{t(`opsBg.status_${r.status}` as MessageKey)}</Badge>
        <span className="text-sm text-muted">{fmt(r.createdAt, locale)}</span>
      </div>
      <Text className="text-sm">
        {r.ticketRef} · {r.reason} · {t('opsBg.by', { email: r.requester })}
      </Text>
    </>
  );
}

function Approval({ request: r, onDone }: { request: BgRequest; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [error, setError] = useState(false);
  async function decide(approve: boolean) {
    setError(false);
    try {
      await opsApi(`/ops/v1/break-glass/${r.id}/${approve ? 'approve' : 'reject'}`, { body: {} });
      await onDone();
    } catch {
      setError(true);
    }
  }
  return (
    <Card>
      <Stack gap={2}>
        <Summary r={r} />
        {error && <Notice tone="danger">{t('ops.error')}</Notice>}
        <div className="flex gap-3">
          <Button onClick={() => decide(true)}>{t('opsBg.approve')}</Button>
          <Button variant="secondary" onClick={() => decide(false)}>
            {t('opsBg.reject')}
          </Button>
        </div>
      </Stack>
    </Card>
  );
}

function MyRequest({ request: r }: { request: BgRequest }) {
  const { t } = useI18n();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState(false);
  async function reveal() {
    setError(false);
    try {
      setValue(
        (await opsApi<{ value: string }>(`/ops/v1/break-glass/${r.id}/reveal`, { body: {} })).value,
      );
    } catch {
      setError(true);
    }
  }
  return (
    <Card>
      <Stack gap={2}>
        <Summary r={r} />
        {r.status === 'approved' && r.validUntil && (
          <Text className="text-sm">{t('opsBg.validUntil', { time: new Date(r.validUntil) })}</Text>
        )}
        {value !== null && (
          <Notice tone="warning" title={t('opsBg.value')}>
            <span className="font-mono break-all">{value}</span>
          </Notice>
        )}
        {error && <Notice tone="danger">{t('ops.error')}</Notice>}
        {r.status === 'approved' && value === null && (
          <Button className="w-fit" onClick={reveal}>
            {t('opsBg.reveal')}
          </Button>
        )}
      </Stack>
    </Card>
  );
}
