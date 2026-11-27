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
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';
import type { Batches } from '../partner/partners';

interface Found {
  stickers: {
    id: string;
    serial: string;
    status: 'in_stock' | 'assigned' | 'revoked';
    ready: boolean;
  }[];
}

/** Same limits as the API (`MAX_INHOUSE_BATCH`, `MAX_ZIP_STICKERS`). */
const MAX_QUANTITY = 5000;
const MAX_ZIP = 2000;

/**
 * „Aufkleber-Lager“ (2026-11-27): batches of generic QR + NFC stickers that we print and program
 * ourselves. Each sticker has a printed serial number; the production export (CSV, QR images) holds
 * every code of the batch, so it needs its own permission and is audited.
 */
export function StockView({ me, batches: b0 }: { me: StaffMe; batches: Batches | null }) {
  const { t, locale } = useI18n();
  const inhouse = (list: Batches['batches']) => list.filter((b) => b.kind === 'inhouse_nfc');
  const [batches, setBatches] = useState(inhouse(b0?.batches ?? []));
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [nb, setNb] = useState({ quantity: '100', note: '' });
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found['stickers'] | null>(null);
  const canExport = me.permissions.includes('tokens.export');

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      setBatches(inhouse((await opsApi<Batches>('/ops/v1/batches')).batches));
      setMsg({ tone: 'success', text: ok });
      return true;
    } catch {
      setMsg({ tone: 'danger', text: t('ops.error') });
      return false;
    }
  }

  if (!b0)
    return (
      <OpsShell me={me} title={t('opsStock.title')} intro={t('opsStock.intro')}>
        <Stack gap={6}>
          <Notice tone="danger">{t('ops.forbidden')}</Notice>
        </Stack>
      </OpsShell>
    );

  return (
    <OpsShell me={me} title={t('opsStock.title')} intro={t('opsStock.intro')}>
      <Stack gap={6}>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsStock.findTitle')}
            </Heading>
            <form
              className="flex flex-wrap items-end gap-3"
              aria-label={t('opsStock.findTitle')}
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                setMsg(null);
                try {
                  const r = await opsApi<Found>(`/ops/v1/stickers?q=${encodeURIComponent(q)}`);
                  setFound(r.stickers);
                } catch {
                  setMsg({ tone: 'danger', text: t('ops.error') });
                }
              }}
            >
              <div className="min-w-0 grow">
                <Field label={t('opsStock.findLabel')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      maxLength={200}
                      autoComplete="off"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Button type="submit">{t('opsStock.find')}</Button>
            </form>
            {found && found.length === 0 && <Text>{t('opsStock.noResult')}</Text>}
            {found && found.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label={t('opsStock.results')}>
                {found.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/lager/aufkleber/${x.id}`}
                      className="font-semibold text-primary underline"
                    >
                      {x.serial}
                    </Link>
                    <Badge tone={x.ready ? 'success' : x.status === 'revoked' ? 'danger' : 'info'}>
                      {t(`opsSticker.status_${x.ready ? 'ready' : x.status}` as MessageKey)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Stack>
        </Card>
        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsStock.batches')}
            </Heading>
            <Text muted>{t('opsStock.exportNote')}</Text>
            <ul className="flex flex-col gap-2" aria-label={t('opsStock.batches')}>
              {batches.length === 0 && <li>{t('opsStock.noBatches')}</li>}
              {batches.map((b) => {
                const range = b.serialFrom && b.serialTo ? `${b.serialFrom} – ${b.serialTo}` : '–';
                return (
                  <li
                    key={b.id}
                    className="flex flex-col gap-2 rounded-xl border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold wrap-anywhere">{range}</span>
                      <Badge tone={b.status === 'generated' ? 'info' : 'success'}>
                        {t(`opsStock.batch_${b.status}` as MessageKey)}
                      </Badge>
                      {b.chip && <Badge>{b.chip}</Badge>}
                      <span className="text-sm text-muted">
                        {t('opsStock.batchLine', { quantity: b.quantity, assigned: b.claimed })} ·{' '}
                        {t('opsStock.ready', { ready: b.ready ?? 0 })} · {fmt(b.createdAt, locale)}
                        {b.note ? ` · „${b.note}“` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <a
                        href={`/ops/v1/batches/${b.id}/print.pdf`}
                        className="text-primary underline"
                      >
                        {t('opsStock.printFile')}
                        <span className="sr-only"> ({range})</span>
                      </a>
                      {canExport && (
                        <a
                          href={`/ops/v1/batches/${b.id}/export.csv`}
                          className="text-primary underline"
                        >
                          {t('opsStock.exportCsv')}
                          <span className="sr-only"> ({range})</span>
                        </a>
                      )}
                      {canExport &&
                        (b.quantity <= MAX_ZIP ? (
                          <a
                            href={`/ops/v1/batches/${b.id}/qr.zip`}
                            className="text-primary underline"
                          >
                            {t('opsStock.exportZip')}
                            <span className="sr-only"> ({range})</span>
                          </a>
                        ) : (
                          <span className="text-sm text-muted">
                            {t('opsStock.zipTooLarge', { max: MAX_ZIP })}
                          </span>
                        ))}
                      {b.status === 'generated' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(
                              () => opsApi(`/ops/v1/batches/${b.id}/printed`, { body: {} }),
                              t('opsStock.saved'),
                            )
                          }
                        >
                          {t('opsStock.markPrinted')}
                          <span className="sr-only"> ({range})</span>
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <form
              className="grid gap-3 md:grid-cols-2"
              aria-label={t('opsStock.newBatch')}
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                const quantity = Number(nb.quantity);
                const ok = await run(
                  () =>
                    opsApi('/ops/v1/batches/inhouse', {
                      body: { quantity, ...(nb.note ? { note: nb.note } : {}) },
                    }),
                  t('opsStock.batchCreated', { quantity }),
                );
                if (ok) setNb({ quantity: '100', note: '' });
              }}
            >
              <Heading level={3} className="text-base md:col-span-2">
                {t('opsStock.newBatch')}
              </Heading>
              <Field label={t('opsStock.quantity', { max: MAX_QUANTITY })}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    required
                    min={1}
                    max={MAX_QUANTITY}
                    value={nb.quantity}
                    onChange={(e) => setNb({ ...nb, quantity: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('opsStock.batchNote')} optionalLabel={t('common.optional')}>
                {({ id }) => (
                  <Input
                    id={id}
                    maxLength={200}
                    value={nb.note}
                    onChange={(e) => setNb({ ...nb, note: e.target.value })}
                  />
                )}
              </Field>
              <Button type="submit" className="w-fit">
                {t('opsStock.createBatch')}
              </Button>
            </form>
          </Stack>
        </Card>
      </Stack>
    </OpsShell>
  );
}
