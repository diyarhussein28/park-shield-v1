'use client';

import { Badge, Button, Checkbox, Notice, Stack, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { letterTone } from '@/components/welcome-letters';
import { opsApi, opsDownload } from '@/lib/api';
import { fmt } from '@/lib/format';
import { label } from '@/lib/labels';
import type { StaffMe } from '@/lib/server';

const LETTER_FILTERS = ['new', 'downloaded', 'sent', 'all'] as const;
type Filter = (typeof LETTER_FILTERS)[number];

export interface LetterListRow {
  id: string;
  userId: string;
  version: number;
  status: 'new' | 'downloaded' | 'sent';
  plan: string;
  addressMissing: boolean;
  createdAt: string;
  customerNo: string | null;
  name: string;
}
export interface LetterList {
  letters: LetterListRow[];
}

/** Welcome letters to print and post: the latest version per customer, with batch actions. */
export function LettersOverview({
  me,
  filter,
  data,
}: {
  me: StaffMe;
  filter: Filter;
  data: LetterList | null;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'pdf' | 'sent' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const rows = data?.letters ?? [];
  const canOpen = me.permissions.includes('customer.read_masked');
  const ids = [...selected].filter((id) => rows.some((r) => r.id === id));
  const all = rows.length > 0 && ids.length === rows.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  async function batchPdf() {
    setBusy('pdf');
    setMsg(null);
    try {
      await opsDownload('/ops/v1/welcome-letters/batch.pdf', { ids }, 'Willkommensbriefe.pdf');
      router.refresh();
    } catch {
      setMsg({ tone: 'danger', text: t('opsLetters.failed') });
    } finally {
      setBusy(null);
    }
  }

  async function batchSent() {
    setBusy('sent');
    setMsg(null);
    try {
      const r = await opsApi<{ updated: number }>('/ops/v1/welcome-letters/sent', {
        body: { ids },
      });
      setMsg({ tone: 'success', text: t('opsLetters.batchDone', { count: r.updated }) });
      setSelected(new Set());
      router.refresh();
    } catch {
      setMsg({ tone: 'danger', text: t('opsLetters.failed') });
    } finally {
      setBusy(null);
    }
  }

  // No permission: only the notice, no filters, forms or „Noch keine …“ beside it.
  if (!data)
    return (
      <OpsShell me={me} title={t('opsLetters.title')} intro={t('opsLetters.intro')}>
        <Stack gap={6}>
          <Notice tone="danger">{t('ops.forbidden')}</Notice>
        </Stack>
      </OpsShell>
    );

  return (
    <OpsShell me={me} title={t('opsLetters.title')} intro={t('opsLetters.intro')}>
      <Stack gap={6}>
        <nav aria-label={t('opsLetters.filter')} className="flex flex-wrap gap-2">
          {LETTER_FILTERS.map((f) => (
            <Link
              key={f}
              href={`/willkommensbriefe?status=${f}`}
              aria-current={f === filter ? 'page' : undefined}
              className={
                f === filter
                  ? 'rounded-xl bg-primary px-4 py-2 font-semibold text-primary-fg'
                  : 'rounded-xl border border-border px-4 py-2 text-primary underline'
              }
            >
              {f === 'all' ? t('opsLetters.filterAll') : label(t, 'letter', f)}
            </Link>
          ))}
        </nav>

        {data && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              label={t('opsLetters.selectAll')}
              checked={all}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
              }
            />
            <span className="text-sm text-muted" aria-live="polite">
              {t('opsLetters.selected', { count: ids.length })}
            </span>
            <Button busy={busy === 'pdf'} disabled={!ids.length} onClick={() => void batchPdf()}>
              {t('opsLetters.batchPdf')}
            </Button>
            <Button
              variant="secondary"
              busy={busy === 'sent'}
              disabled={!ids.length}
              onClick={() => void batchSent()}
            >
              {t('opsLetters.batchSent')}
            </Button>
          </div>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        {data && (
          <ul className="flex flex-col gap-3" aria-label={t('opsLetters.title')}>
            {rows.length === 0 && <li>{t('opsLetters.empty')}</li>}
            {rows.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Checkbox
                    label={
                      <span className="sr-only">
                        {t('opsLetters.selectOne', { name: r.name || (r.customerNo ?? '') })}
                      </span>
                    }
                    checked={selected.has(r.id)}
                    onChange={(e) => toggle(r.id, e.target.checked)}
                  />
                  <Badge tone={letterTone(r.status)}>{label(t, 'letter', r.status)}</Badge>
                  <span className="font-mono text-sm">{r.customerNo ?? '–'}</span>
                  <span className="min-w-0 font-semibold wrap-anywhere">{r.name || '–'}</span>
                  <span className="text-sm">{label(t, 'plan', r.plan)}</span>
                  <span className="text-sm text-muted">
                    {t('opsLetters.created')}: {fmt(r.createdAt, locale)} · v{r.version}
                  </span>
                </div>
                {r.addressMissing && (
                  <p className="mt-2 text-sm text-danger-text">{t('opsLetters.addressMissing')}</p>
                )}
                <p className="mt-2 flex flex-wrap gap-4 text-sm">
                  <a
                    href={`/ops/v1/welcome-letters/${r.id}/pdf?inline=1`}
                    target="_blank"
                    rel="noopener"
                    className="text-primary underline"
                  >
                    {t('opsLetters.preview')}
                    <span className="sr-only"> ({r.customerNo})</span>
                  </a>
                  <a
                    href={`/ops/v1/welcome-letters/${r.id}/pdf`}
                    className="text-primary underline"
                    onClick={() => setTimeout(() => router.refresh(), 1200)}
                  >
                    {t('opsLetters.pdf')}
                    <span className="sr-only"> ({r.customerNo})</span>
                  </a>
                  {canOpen && (
                    <Link href={`/kunden/${r.userId}`} className="text-primary underline">
                      {t('opsLetters.open')}
                      <span className="sr-only"> ({r.customerNo})</span>
                    </Link>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </OpsShell>
  );
}
