'use client';

import type { MessageKey } from '@parkshield/i18n';
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
import { useState, type FormEvent, type ReactNode } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { RevealRequest } from '@/components/reveal-request';
import { opsApi } from '@/lib/api';
import { errorCode, fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';
import { orderKind, statusTone, type OrderRow } from '../orders';

export interface OrderData {
  order: OrderRow & { address: string | null };
  reprints: { id: string; status: string; createdAt: string }[];
}

type Msg = { tone: 'success' | 'danger'; text: string } | null;

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {title}
        </Heading>
        {children}
      </Stack>
    </Card>
  );
}

const EMPTY = { name: '', line1: '', line2: '', postalCode: '', city: '' };

/** One order: ship, deliver, returned parcel, free reprint (new address only via break-glass). */
export function OrderDetail({
  me,
  id,
  initial,
}: {
  me: StaffMe;
  id: string;
  initial: OrderData | null;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [correct, setCorrect] = useState(false);
  const [address, setAddress] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const canReveal = me.permissions.includes('pii.decrypt_request');

  if (!data) {
    return (
      <OpsShell me={me}>
        <Notice tone="danger">{t('ops.forbidden')}</Notice>
      </OpsShell>
    );
  }
  const o = data.order;
  const reload = async () => setData(await opsApi<OrderData>(`/ops/v1/orders/${id}`));

  async function act(path: string, body: unknown, ok: MessageKey) {
    setMsg(null);
    setBusy(true);
    try {
      await opsApi(`/ops/v1/orders/${id}${path}`, { body });
      await reload();
      setMsg({ tone: 'success', text: t(ok) });
      return true;
    } catch (err) {
      const code = errorCode(err);
      setMsg({
        tone: 'danger',
        text:
          code === 'break_glass_required'
            ? t('opsOrders.needsBreakGlass')
            : code === 'wrong_status'
              ? t('opsOrders.wrongStatus')
              : t('ops.error'),
      });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const open = ['paid', 'in_production'].includes(o.status);
  const field = (k: keyof typeof EMPTY, label: MessageKey, extra: Record<string, unknown> = {}) => (
    <Field label={t(label)} optionalLabel={k === 'line2' ? t('common.optional') : undefined}>
      {({ id: fid }) => (
        <Input
          id={fid}
          required={k !== 'line2'}
          value={address[k]}
          onChange={(e) => setAddress((a) => ({ ...a, [k]: e.target.value }))}
          {...extra}
        />
      )}
    </Field>
  );

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Link href="/bestellungen" className="text-primary underline">
            {t('opsOrders.back')}
          </Link>
          <Heading level={1} className="mt-2">
            {t('opsOrders.detailTitle', { nickname: o.nickname ?? '–' })}
          </Heading>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={statusTone(o.status)}>
              {t(`opsOrders.status_${o.status}` as MessageKey)}
            </Badge>
            <Badge>{t(`opsOrders.kind_${orderKind(o)}` as MessageKey)}</Badge>
          </div>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <Box title={t('opsOrders.facts')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt>{t('opsOrders.customer')}</dt>
            <dd>
              {o.customer ?? '–'}{' '}
              {o.customerId && me.permissions.includes('customer.read_masked') && (
                <Link href={`/kunden/${o.customerId}`} className="text-primary underline">
                  {t('opsOrders.openCustomer')}
                </Link>
              )}
            </dd>
            <dt>{t('opsOrders.code')}</dt>
            <dd className="font-mono">…{o.codeHint}</dd>
            <dt>{t('opsOrders.product')}</dt>
            <dd>{o.product}</dd>
            <dt>{t('opsOrders.address')}</dt>
            <dd>
              <span className="font-mono">{o.address ?? t('opsOrders.addressGone')}</span>
              {canReveal && o.address && (
                <RevealRequest
                  target="decal_orders.shipping_address"
                  targetId={o.id}
                  label={t('opsCustomers.field_address')}
                />
              )}
            </dd>
            <dt>{t('opsOrders.createdLabel')}</dt>
            <dd>{fmt(o.createdAt, locale)}</dd>
            <dt>{t('opsOrders.printRef')}</dt>
            <dd>{o.printRef ?? '–'}</dd>
            <dt>{t('opsOrders.trackingLabel')}</dt>
            <dd>{o.trackingNumber ?? '–'}</dd>
            {o.note && (
              <>
                <dt>{t('opsOrders.note')}</dt>
                <dd>{o.note}</dd>
              </>
            )}
          </dl>
          {data.reprints.length > 0 && (
            <div>
              <Heading level={3} className="text-base">
                {t('opsOrders.reprints')}
              </Heading>
              <ul className="text-sm">
                {data.reprints.map((r) => (
                  <li key={r.id}>
                    <Link href={`/bestellungen/${r.id}`} className="text-primary underline">
                      {fmt(r.createdAt, locale)}
                    </Link>{' '}
                    · {t(`opsOrders.status_${r.status}` as MessageKey)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Box>

        {open && (
          <Box title={t('opsOrders.shipTitle')}>
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                if (await act('/shipped', { trackingNumber: tracking }, 'opsOrders.saved'))
                  setTracking('');
              }}
            >
              <div className="sm:min-w-72">
                <Field label={t('opsOrders.trackingLabel')}>
                  {({ id: fid }) => (
                    <Input
                      id={fid}
                      required
                      minLength={6}
                      maxLength={64}
                      value={tracking}
                      onChange={(e) => setTracking(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Button type="submit" busy={busy}>
                {t('opsOrders.markShipped')}
              </Button>
            </form>
          </Box>
        )}

        {(o.status === 'shipped' || o.status === 'delivered') && (
          <Box title={t('opsOrders.deliveryTitle')}>
            {o.status === 'shipped' && (
              <Button
                variant="secondary"
                className="w-fit"
                busy={busy}
                onClick={() => act('/delivered', {}, 'opsOrders.saved')}
              >
                {t('opsOrders.markDelivered')}
              </Button>
            )}
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                if (await act('/returned', { note }, 'opsOrders.saved')) setNote('');
              }}
            >
              <div className="sm:min-w-72">
                <Field label={t('opsOrders.returnNote')}>
                  {({ id: fid }) => (
                    <Input
                      id={fid}
                      required
                      minLength={3}
                      maxLength={200}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Button type="submit" variant="secondary" busy={busy}>
                {t('opsOrders.markReturned')}
              </Button>
            </form>
          </Box>
        )}

        {o.status !== 'pending_payment' && o.status !== 'canceled' && (
          <Box title={t('opsOrders.reprintTitle')}>
            <Text>{t('opsOrders.reprintIntro')}</Text>
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                const body = {
                  reason,
                  ...(correct
                    ? {
                        address: {
                          ...address,
                          line2: address.line2 || undefined,
                          country: 'DE',
                        },
                      }
                    : {}),
                };
                if (await act('/reprint', body, 'opsOrders.reprinted')) {
                  setReason('');
                  setCorrect(false);
                  setAddress(EMPTY);
                }
              }}
            >
              <Field label={t('opsOrders.reprintReason')}>
                {({ id: fid }) => (
                  <Input
                    id={fid}
                    required
                    minLength={3}
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </Field>
              <Checkbox
                label={t('opsOrders.correctAddress')}
                checked={correct}
                onChange={(e) => setCorrect(e.target.checked)}
              />
              {correct && (
                <div className="grid gap-3 md:grid-cols-2">
                  {field('name', 'opsOrders.a_name')}
                  {field('line1', 'opsOrders.a_line1')}
                  {field('line2', 'opsOrders.a_line2')}
                  {field('postalCode', 'opsOrders.a_postalCode', {
                    inputMode: 'numeric',
                    pattern: '\\d{5}',
                  })}
                  {field('city', 'opsOrders.a_city')}
                </div>
              )}
              <Button type="submit" className="w-fit" busy={busy}>
                {t('opsOrders.reprint')}
              </Button>
            </form>
          </Box>
        )}
      </Stack>
    </OpsShell>
  );
}
