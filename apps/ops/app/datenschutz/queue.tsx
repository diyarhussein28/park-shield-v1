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
  Select,
  Stack,
  Text,
  Textarea,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import type { StaffMe } from '@/lib/server';

interface DsrRow {
  id: string;
  type: string;
  status: string;
  email: string | null;
  dueAt: string;
  daysLeft: number;
  dueSoon: boolean;
  overdue: boolean;
  verified: boolean;
  steps: number;
  stepsDone: number;
}
export interface DsrList {
  requests: DsrRow[];
}
const TYPES = ['access_export', 'erasure', 'rectification', 'restriction', 'objection'] as const;

/** AD-11 / US-37: the queue, ordered by deadline. */
export function DsrQueue({ me, initial }: { me: StaffMe; initial: DsrList | null }) {
  const { t } = useI18n();
  const [list, setList] = useState(initial?.requests ?? []);
  const reload = async () => setList((await opsApi<DsrList>('/ops/v1/dsr')).requests);

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsDsr.title')}</Heading>
          <Text muted>{t('opsDsr.intro')}</Text>
        </div>
        {!initial && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        {list.length === 0 ? (
          <Text>{t('opsDsr.none')}</Text>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t('opsDsr.title')}>
            {list.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  {/* min-w-0: a flex item never shrinks below its longest word otherwise (320 px reflow) */}
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {t(`opsDsr.type_${r.type}` as MessageKey)} ·{' '}
                      {r.email ?? t('opsDsr.accountGone')}
                    </p>
                    <p className="text-sm">
                      {t('opsDsr.due', { date: new Date(r.dueAt) })} ·{' '}
                      {t('opsDsr.daysLeft', { days: Math.max(0, r.daysLeft) })} ·{' '}
                      {t('opsDsr.steps', { done: r.stepsDone, total: r.steps })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{t(`opsDsr.status_${r.status}` as MessageKey)}</Badge>
                    {r.overdue ? (
                      <Badge tone="danger">{t('opsDsr.overdue')}</Badge>
                    ) : (
                      r.dueSoon && <Badge tone="warning">{t('opsDsr.dueSoon')}</Badge>
                    )}
                    <Link href={`/datenschutz/${r.id}`} className="text-primary underline">
                      {t('opsDsr.open')}
                      <span className="sr-only">: {r.email ?? r.id}</span>
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
        <CreateForm onCreated={reload} />
      </Stack>
    </OpsShell>
  );
}

function CreateForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const { t } = useI18n();
  const [type, setType] = useState<(typeof TYPES)[number]>('access_export');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{
    tone: 'success' | 'danger' | 'info';
    text: string;
  } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    try {
      const r = await opsApi<{ accountFound: boolean }>('/ops/v1/dsr', {
        body: { type, email, note: note || undefined },
      });
      setResult({
        tone: 'success',
        text: `${t('opsDsr.created')}${r.accountFound ? '' : ` ${t('opsDsr.noAccount')}`}`,
      });
      setEmail('');
      setNote('');
      await onCreated();
    } catch {
      setResult({ tone: 'danger', text: t('ops.error') });
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Heading level={2} className="text-xl">
          {t('opsDsr.newTitle')}
        </Heading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('opsDsr.type')}>
            {({ id }) => (
              <Select
                id={id}
                value={type}
                onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
              >
                {TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`opsDsr.type_${x}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('opsDsr.email')}>
            {({ id }) => (
              <Input
                id={id}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label={t('opsDsr.note')}>
          {({ id }) => (
            <Textarea
              id={id}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        <Button type="submit" className="w-fit">
          {t('opsDsr.create')}
        </Button>
      </form>
    </Card>
  );
}
