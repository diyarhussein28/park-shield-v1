'use client';

import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Heading,
  Notice,
  Stack,
  Text,
  Textarea,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { errorCode, fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

export interface ReviewData {
  staff: {
    id: string;
    email: string;
    name: string | null;
    roles: string[];
    permissions: string[];
    hasPasskey: boolean;
    lastLoginAt: string | null;
    inactiveDays: number;
  }[];
  last: { at: string; by: string | null; kept: number; removed: number; note: string } | null;
  dueAt: string;
  due: boolean;
  inactiveDays: number;
}

/** US-45: quarterly review: confirm or remove every ops account; the result goes to the audit log. */
export function AccessReview({ me, initial }: { me: StaffMe; initial: ReviewData | null }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(initial);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) {
    return (
      <OpsShell me={me}>
        <Notice tone="danger">{t('ops.forbidden')}</Notice>
      </OpsShell>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const keep = data!.staff.filter((s) => !removed.has(s.id)).map((s) => s.id);
      const r = await opsApi<{ kept: number; removed: number }>('/ops/v1/staff/review', {
        body: { keep, remove: [...removed], note },
      });
      setMsg({ tone: 'success', text: t('opsAccess.done', { kept: r.kept, removed: r.removed }) });
      setRemoved(new Set());
      setNote('');
      setData(await opsApi<ReviewData>('/ops/v1/staff/review'));
    } catch (err) {
      setMsg({
        tone: 'danger',
        text: errorCode(err) === 'last_manager' ? t('ops.staffLastManager') : t('ops.error'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Link href="/mitarbeitende" className="text-primary underline">
            {t('opsAccess.back')}
          </Link>
          <Heading level={1} className="mt-2">
            {t('opsAccess.title')}
          </Heading>
          <Text muted>{t('opsAccess.intro', { days: data.inactiveDays })}</Text>
        </div>
        <Notice tone={data.due ? 'warning' : 'info'}>
          {data.last
            ? t('opsAccess.lastReview', {
                date: fmt(data.last.at, locale),
                by: data.last.by ?? '–',
                kept: data.last.kept,
                removed: data.last.removed,
              })
            : t('opsAccess.never')}{' '}
          {data.due
            ? t('opsAccess.dueNow')
            : t('opsAccess.dueOn', { date: fmt(data.dueAt, locale) })}
        </Notice>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <a href="/ops/v1/staff/review.csv" className="w-fit text-primary underline">
          {t('opsAccess.csv')}
        </a>
        <Card>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3" aria-label={t('opsAccess.list')}>
              {data.staff.map((s) => (
                <li key={s.id} className="flex flex-col gap-1 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.name ?? s.email}</span>
                    <span className="text-sm text-muted">{s.email}</span>
                    {s.roles.map((r) => (
                      <Badge key={r}>{r}</Badge>
                    ))}
                    {!s.hasPasskey && <Badge tone="warning">{t('opsAccess.noPasskey')}</Badge>}
                    {s.inactiveDays >= 30 && (
                      <Badge tone="warning">
                        {t('opsAccess.inactive', { days: s.inactiveDays })}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm">
                    {t('opsAccess.lastLogin', { date: fmt(s.lastLoginAt, locale) })} ·{' '}
                    {t('opsAccess.permissions', { count: s.permissions.length })}
                  </p>
                  <Checkbox
                    label={t('opsAccess.keep', { name: s.name ?? s.email })}
                    checked={!removed.has(s.id)}
                    onChange={(e) =>
                      setRemoved((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                  />
                </li>
              ))}
            </ul>
            <Field label={t('opsAccess.note')} hint={t('opsAccess.noteHint')}>
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  required
                  minLength={10}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            {removed.size > 0 && (
              <Notice tone="warning">{t('opsAccess.willRemove', { count: removed.size })}</Notice>
            )}
            <Button type="submit" className="w-fit" busy={busy}>
              {t('opsAccess.submit')}
            </Button>
          </form>
        </Card>
      </Stack>
    </OpsShell>
  );
}
