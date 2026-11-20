'use client';

import { Badge, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { OpsShell, Section } from '@/components/ops-shell';
import { RevealRequest } from '@/components/reveal-request';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';
import { label } from '@/lib/labels';
import {
  LetterHeaderActions,
  VehicleQrButton,
  WelcomeLetterSection,
  type LettersView,
} from '@/components/welcome-letters';
import { ManageAccount } from './manage';

export interface CustomerView {
  customer: {
    id: string;
    email: string;
    status: string;
    language: string;
    createdAt: string;
    lastLoginAt: string | null;
    emailVerifiedAt: string | null;
    deletionDueAt: string | null;
    freeReplacements: number;
    customerNo: string | null;
  };
  protection: { percent: number; steps: Record<string, boolean> };
  subscriptions: {
    id: string;
    plan: string;
    status: string;
    contractNo: string | null;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  }[];
  vehicles: {
    id: string;
    nickname: string;
    plateMasked: string | null;
    color: string | null;
    decals: {
      id: string;
      codeHint: string;
      status: string;
      activatedAt: string | null;
      lastTestAt: string | null;
      lastScannedAt: string | null;
      revokeReason: string | null;
    }[];
  }[];
  channels: {
    email: { verified: boolean };
    push: {
      id: string;
      platform: string | null;
      label: string | null;
      lastOkAt: string | null;
      errorCount: number;
    }[];
    sms: {
      id: string;
      phoneMasked: string;
      verifiedAt: string;
      enabled: boolean;
      lastOkAt: string | null;
      errorCount: number;
    } | null;
  };
  emergencyContacts: {
    id: string;
    name: string;
    emailMasked: string | null;
    phoneMasked: string | null;
    consent: string;
  }[];
  orders: {
    id: string;
    status: string;
    totalCents: number;
    replacement: boolean;
    addressMasked: string | null;
    trackingNumber: string | null;
    createdAt: string;
  }[];
  alerts: {
    id: string;
    type: string;
    severity: string;
    status: string;
    isTest: boolean;
    ownerReply: string | null;
    createdAt: string;
    nickname: string;
  }[];
  requests: { id: string; type: string; status: string; dueAt: string }[];
  reports: { id: string; kind: string; reason: string; status: string; createdAt: string }[];
}

/** AD-03 Customer 360, masked (AD-05). No "log in as customer". */
export function Customer360({
  me,
  data,
  letters,
}: {
  me: StaffMe;
  data: CustomerView;
  /** Only for staff with letters.print. */
  letters: LettersView | null;
}) {
  const { t, locale } = useI18n();
  const canRequest = me.permissions.includes('pii.decrypt_request');
  const canTrace = me.permissions.includes('alerts.read_metadata');
  const canRefund = me.permissions.includes('billing.refund');
  const canOrders = me.permissions.includes('orders.manage');
  const canManage = me.permissions.includes('customer.manage');
  const canRecreate = me.permissions.includes('letters.manage');
  const qrActive = new Map(letters?.vehicles.map((v) => [v.vehicleId, v.active]) ?? []);
  const d = (v: string | null) => fmt(v, locale);
  const c = data.customer;

  return (
    <OpsShell
      me={me}
      back={{ href: '/kunden', label: t('opsCustomers.title') }}
      title={c.email}
      intro={t('opsCustomers.masked')}
      actions={letters && <LetterHeaderActions customerId={c.id} data={letters} />}
    >
      <Stack gap={6}>
        {c.deletionDueAt && (
          <Notice tone="warning">
            {t('opsCustomers.deletionDue')}: {d(c.deletionDueAt)}
          </Notice>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t('opsCustomers.account')}>
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt>{t('opsLetters.customerNo')}</dt>
              <dd className="font-mono">{c.customerNo ?? '–'}</dd>
              <dt>{t('opsCustomers.status')}</dt>
              <dd>{label(t, 'user', c.status)}</dd>
              <dt>{t('opsCustomers.since')}</dt>
              <dd>{d(c.createdAt)}</dd>
              <dt>{t('opsCustomers.lastLogin')}</dt>
              <dd>{d(c.lastLoginAt)}</dd>
              <dt>{t('opsCustomers.protection')}</dt>
              <dd>{data.protection.percent} %</dd>
              <dt>{t('opsCustomers.freeReplacements')}</dt>
              <dd>{c.freeReplacements}</dd>
            </dl>
          </Section>
          <Section title={t('opsCustomers.subscription')}>
            {data.subscriptions.length === 0 ? (
              <Text muted>{t('opsCustomers.noSubscription')}</Text>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {data.subscriptions.map((s) => (
                  <li key={s.id}>
                    <b>{label(t, 'plan', s.plan)}</b> · {label(t, 'sub', s.status)} ·{' '}
                    {s.contractNo ?? '–'} · {d(s.periodEnd)}
                    {s.cancelAtPeriodEnd ? ' · ✕' : ''}
                    {canRefund && (
                      <>
                        {' · '}
                        <Link
                          href={`/kunden/${c.id}/erstattung?abo=${s.id}`}
                          className="text-primary underline"
                        >
                          {t('opsRefund.open')}
                          <span className="sr-only"> ({s.contractNo ?? s.plan})</span>
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        {letters && (
          <WelcomeLetterSection customerId={c.id} data={letters} canManage={canRecreate} />
        )}

        {canManage && <ManageAccount customer={c} />}

        <Section title={t('opsCustomers.vehicles')}>
          <ul className="flex flex-col gap-3">
            {data.vehicles.map((v) => (
              <li key={v.id} className="rounded-xl border border-border p-3">
                <p className="font-semibold">
                  „{v.nickname}“ {v.color ? `· ${v.color}` : ''}
                </p>
                <p className="text-sm">
                  {t('opsCustomers.plate')}:{' '}
                  <span className="font-mono">{v.plateMasked ?? '–'}</span>
                </p>
                {letters && (
                  <div className="mt-2">
                    <VehicleQrButton
                      vehicleId={v.id}
                      nickname={v.nickname}
                      active={qrActive.get(v.id) ?? false}
                    />
                  </div>
                )}
                {canRequest && v.plateMasked && (
                  <RevealRequest
                    target="vehicles.plate"
                    targetId={v.id}
                    label={`${t('opsCustomers.field_plate')} „${v.nickname}“`}
                  />
                )}
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {v.decals.map((tk) => (
                    <li key={tk.id} className="flex flex-wrap gap-2">
                      <span className="font-mono">
                        {t('opsCustomers.code', { hint: tk.codeHint })}
                      </span>
                      <Badge
                        tone={
                          tk.status === 'active'
                            ? 'success'
                            : tk.status === 'revoked'
                              ? 'warning'
                              : 'info'
                        }
                      >
                        {label(t, 'token', tk.status)}
                      </Badge>
                      <span>
                        {t('opsCustomers.lastScan')}: {d(tk.lastScannedAt)} ·{' '}
                        {t('opsCustomers.lastTest')}: {d(tk.lastTestAt)}
                      </span>
                      {tk.revokeReason && <span className="text-muted">({tk.revokeReason})</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t('opsCustomers.channels')}>
            <p className="text-sm">E-Mail: {data.channels.email.verified ? '✓' : '✕'}</p>
            <p className="text-sm font-semibold">{t('opsCustomers.push')}</p>
            <ul className="text-sm">
              {data.channels.push.length === 0 && <li>–</li>}
              {data.channels.push.map((p) => (
                <li key={p.id}>
                  {p.platform ?? '?'} {p.label ? `(${p.label})` : ''} · {t('opsCustomers.lastOk')}:{' '}
                  {d(p.lastOkAt)} · {t('opsCustomers.errors')}: {p.errorCount}
                </li>
              ))}
            </ul>
            <p className="text-sm font-semibold">{t('opsCustomers.sms')}</p>
            {data.channels.sms ? (
              <div className="text-sm">
                <span className="font-mono">{data.channels.sms.phoneMasked}</span> ·{' '}
                {t('opsCustomers.lastOk')}: {d(data.channels.sms.lastOkAt)} ·{' '}
                {t('opsCustomers.errors')}: {data.channels.sms.errorCount}
                {canRequest && (
                  <RevealRequest
                    target="contact_channels.sms"
                    targetId={data.channels.sms.id}
                    label={t('opsCustomers.field_sms')}
                  />
                )}
              </div>
            ) : (
              <p className="text-sm">–</p>
            )}
          </Section>
          <Section title={t('opsCustomers.contacts')}>
            <ul className="text-sm">
              {data.emergencyContacts.length === 0 && <li>–</li>}
              {data.emergencyContacts.map((e) => (
                <li key={e.id}>
                  {e.name} ·{' '}
                  <span className="font-mono">
                    {[e.phoneMasked, e.emailMasked].filter(Boolean).join(' · ')}
                  </span>{' '}
                  · {e.consent}
                  {canRequest && e.emailMasked && (
                    <RevealRequest
                      target="emergency_contacts.email"
                      targetId={e.id}
                      label={`${t('opsCustomers.field_contact')} (${e.name})`}
                    />
                  )}
                  {canRequest && e.phoneMasked && (
                    <RevealRequest
                      target="emergency_contacts.phone"
                      targetId={e.id}
                      label={`${t('opsCustomers.field_phone')} (${e.name})`}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section title={t('opsCustomers.orders')}>
          <ul className="flex flex-col gap-2 text-sm">
            {data.orders.length === 0 && <li>–</li>}
            {data.orders.map((o) => (
              <li key={o.id}>
                {d(o.createdAt)} · {label(t, 'order', o.status)} · {(o.totalCents / 100).toFixed(2)}{' '}
                € {o.replacement ? '· Ersatz' : ''} · {t('opsCustomers.address')}:{' '}
                <span className="font-mono">{o.addressMasked ?? '–'}</span>{' '}
                {o.trackingNumber ? `· ${o.trackingNumber}` : ''}
                {canOrders && (
                  <>
                    {' · '}
                    <Link href={`/bestellungen/${o.id}`} className="text-primary underline">
                      {t('opsOrders.open')}
                      <span className="sr-only"> ({d(o.createdAt)})</span>
                    </Link>
                  </>
                )}
                {canRefund && o.totalCents > 0 && (
                  <>
                    {' · '}
                    <Link
                      href={`/kunden/${c.id}/erstattung?bestellung=${o.id}`}
                      className="text-primary underline"
                    >
                      {t('opsRefund.open')}
                      <span className="sr-only"> ({d(o.createdAt)})</span>
                    </Link>
                  </>
                )}
                {canRequest && o.addressMasked && (
                  <RevealRequest
                    target="decal_orders.shipping_address"
                    targetId={o.id}
                    label={t('opsCustomers.field_address')}
                  />
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section title={t('opsCustomers.alerts')}>
          <ul className="flex flex-col gap-1 text-sm" aria-label={t('opsCustomers.alerts')}>
            {data.alerts.length === 0 && <li>–</li>}
            {data.alerts.map((a) => (
              <li key={a.id}>
                {d(a.createdAt)} · {label(t, 'type', a.type)} · „{a.nickname}“ ·{' '}
                {label(t, 'alert', a.status)}
                {a.ownerReply ? ` · ${a.ownerReply}` : ''} {a.isTest ? '· Test' : ''}{' '}
                {canTrace && (
                  <Link href={`/warnungen/${a.id}`} className="text-primary underline">
                    {t('opsCustomers.trace')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t('opsCustomers.requests')}>
            <ul className="text-sm">
              {data.requests.length === 0 && <li>–</li>}
              {data.requests.map((r) => (
                <li key={r.id}>
                  {label(t, 'dsr', r.type)} · {label(t, 'dsrStatus', r.status)} · {d(r.dueAt)}
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('opsCustomers.reports')}>
            <ul className="text-sm">
              {data.reports.length === 0 && <li>–</li>}
              {data.reports.map((r) => (
                <li key={r.id}>
                  {d(r.createdAt)} · {r.kind} · {r.reason} · {r.status}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </Stack>
    </OpsShell>
  );
}
