'use client';

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

interface Hit {
  id: string;
  email: string;
  status: string;
  plan: string | null;
  subscriptionStatus: string | null;
  createdAt: string;
}

export function CustomerSearch({ me }: { me: StaffMe }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      setHits(
        (await opsApi<{ customers: Hit[] }>(`/ops/v1/customers?q=${encodeURIComponent(q)}`))
          .customers,
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsCustomers.title')}</Heading>
          <Text muted>{t('opsCustomers.logged')}</Text>
        </div>
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-auto sm:min-w-72 sm:flex-1">
            <Field label={t('opsCustomers.searchLabel')}>
              {({ id }) => (
                <Input
                  id={id}
                  required
                  minLength={3}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Button type="submit" busy={busy}>
            {t('opsCustomers.search')}
          </Button>
        </form>
        {error && <Notice tone="danger">{t('ops.error')}</Notice>}
        {hits?.length === 0 && <Text>{t('opsCustomers.none')}</Text>}
        {hits && hits.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={t('opsCustomers.title')}>
            {hits.map((h) => (
              <li key={h.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link href={`/kunden/${h.id}`} className="font-semibold text-primary underline">
                      {h.email}
                    </Link>
                    <Text muted className="text-sm">
                      {t('opsCustomers.since')}: {fmt(h.createdAt, locale)}
                    </Text>
                  </div>
                  <div className="flex gap-2">
                    <Badge>{h.status}</Badge>
                    {h.plan && <Badge tone="info">{`${h.plan} · ${h.subscriptionStatus}`}</Badge>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </OpsShell>
  );
}
