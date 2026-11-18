'use client';

import { Badge, Button, Field, Input, Notice, Select, Stack, Text, useI18n } from '@parkshield/ui';
import type { MessageKey } from '@parkshield/i18n';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { OpsShell, Section } from '@/components/ops-shell';
import { Icon } from '@/components/icons';
import { OpsApiError, opsApi } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';
import { label } from '@/lib/labels';

interface Row {
  id: string;
  email: string;
  status: string;
  plan: string | null;
  subscriptionStatus: string | null;
  vehicles?: number;
  createdAt: string;
}

interface Page {
  customers: Row[];
  total: number;
  page: number;
  pageSize: number;
}

const FILTERS = ['all', 'active', 'suspended', 'pending_deletion'] as const;
type Filter = (typeof FILTERS)[number];

/** AD-03: every customer (paged, masked) plus search; creating accounts with customer.manage. */
export function CustomerSearch({ me }: { me: StaffMe }) {
  const { t } = useI18n();
  const canManage = me.permissions.includes('customer.manage');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Row[] | null>(null);
  const [list, setList] = useState<Page | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The list follows page and filter; errors and results arrive asynchronously (no sync setState).
  useEffect(() => {
    let live = true;
    opsApi<Page>(`/ops/v1/customers?page=${page}&filter=${filter}`).then(
      (r) => {
        if (live) {
          setList(r);
          setError(false);
        }
      },
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, [page, filter]);

  async function search(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      setHits(
        (await opsApi<{ customers: Row[] }>(`/ops/v1/customers?q=${encodeURIComponent(q)}`))
          .customers,
      );
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <OpsShell
      me={me}
      title={t('opsCustomers.title')}
      intro={t('ops.areaCustomers')}
      actions={
        canManage && !creating ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="users" className="size-5" />
            {t('opsCustomers.createOpen')}
          </Button>
        ) : undefined
      }
    >
      <Stack gap={6}>
        {notice && <Notice tone="success">{notice}</Notice>}
        {creating && (
          <CreateCustomer
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              setNotice(t('opsCustomers.created'));
              window.location.assign(`/kunden/${id}`);
            }}
          />
        )}

        <Section title={t('opsCustomers.search')} icon="search" intro={t('opsCustomers.logged')}>
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
            {hits && (
              <Button
                variant="ghost"
                onClick={() => {
                  setHits(null);
                  setQ('');
                }}
              >
                {t('opsCustomers.clearSearch')}
              </Button>
            )}
          </form>
          {hits?.length === 0 && <Text>{t('opsCustomers.none')}</Text>}
          {hits && hits.length > 0 && (
            <CustomerTable rows={hits} caption={t('opsCustomers.searchResults')} />
          )}
        </Section>

        {error && <Notice tone="danger">{t('ops.error')}</Notice>}

        <Section
          title={t('opsCustomers.listTitle')}
          icon="users"
          intro={t('opsCustomers.listIntro')}
          aside={list ? <Badge>{t('opsCustomers.count', { total: list.total })}</Badge> : undefined}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('opsCustomers.filterLabel')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value as Filter);
                    setPage(1);
                  }}
                  className="min-w-56"
                >
                  {FILTERS.map((f) => (
                    <option key={f} value={f}>
                      {t(`opsCustomers.filter_${f}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {list && list.customers.length === 0 && <Text>{t('opsCustomers.none')}</Text>}
          {list && list.customers.length > 0 && (
            <CustomerTable rows={list.customers} caption={t('opsCustomers.listTitle')} />
          )}
          {list && pages > 1 && (
            <nav
              aria-label={t('opsCustomers.page', { page, pages })}
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('opsCustomers.prev')}
              </Button>
              <Text className="text-sm">{t('opsCustomers.page', { page, pages })}</Text>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('opsCustomers.next')}
              </Button>
            </nav>
          )}
        </Section>
      </Stack>
    </OpsShell>
  );
}

function CustomerTable({ rows, caption }: { rows: Row[]; caption: string }) {
  const { t, locale } = useI18n();
  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-secondary/50 text-xs text-muted uppercase">
          <tr>
            <th scope="col" className="px-3 py-2">
              {t('opsCustomers.colEmail')}
            </th>
            <th scope="col" className="px-3 py-2">
              {t('opsCustomers.status')}
            </th>
            <th scope="col" className="px-3 py-2">
              {t('opsCustomers.colPlan')}
            </th>
            {rows.some((r) => r.vehicles !== undefined) && (
              <th scope="col" className="px-3 py-2">
                {t('opsCustomers.colVehicles')}
              </th>
            )}
            <th scope="col" className="px-3 py-2">
              {t('opsCustomers.since')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-3 py-2">
                <Link
                  href={`/kunden/${r.id}`}
                  className="font-semibold text-primary underline wrap-anywhere"
                >
                  {r.email}
                </Link>
              </td>
              <td className="px-3 py-2">
                <Badge
                  tone={
                    r.status === 'active'
                      ? 'success'
                      : r.status === 'suspended'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {label(t, 'user', r.status)}
                </Badge>
              </td>
              <td className="px-3 py-2">
                {r.plan
                  ? `${label(t, 'plan', r.plan)} · ${label(t, 'sub', r.subscriptionStatus)}`
                  : t('opsCustomers.noSubscription')}
              </td>
              {r.vehicles !== undefined && <td className="px-3 py-2">{r.vehicles}</td>}
              <td className="px-3 py-2 whitespace-nowrap">{fmt(r.createdAt, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateCustomer({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState<'de' | 'en'>('de');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await opsApi<{ id: string }>('/ops/v1/customers', { body: { email, language } });
      onCreated(r.id);
    } catch (err) {
      setError(
        err instanceof OpsApiError && err.body?.error === 'email_exists'
          ? t('opsCustomers.exists')
          : t('ops.error'),
      );
      setBusy(false);
    }
  }

  return (
    <Section
      title={t('opsCustomers.createTitle')}
      icon="users"
      intro={t('opsCustomers.createIntro')}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('opsCustomers.email')}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              required
              autoComplete="off"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-md"
            />
          )}
        </Field>
        <Field label={t('opsCustomers.language')}>
          {({ id }) => (
            <Select
              id={id}
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'de' | 'en')}
              className="max-w-56"
            >
              <option value="de">{t('opsCustomers.lang_de')}</option>
              <option value="en">{t('opsCustomers.lang_en')}</option>
            </Select>
          )}
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" busy={busy}>
            {t('opsCustomers.createSubmit')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('opsCustomers.cancel')}
          </Button>
        </div>
      </form>
    </Section>
  );
}
