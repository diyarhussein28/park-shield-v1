'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Button,
  Card,
  Field,
  Heading,
  Input,
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
import { errorCode, euro, fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';
import type { CustomerView } from '../customer-360';

export interface RefundList {
  refunds: {
    id: string;
    kind: string;
    refundCents: number;
    creditNoteNo: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}
interface Quote {
  kind: string;
  paidCents: number;
  alreadyRefundedCents: number;
  daysUsed: number | null;
  periodDays: number | null;
  wertersatzCents: number;
  decalCostCents: number;
  refundCents: number;
  endsSubscriptionNow: boolean;
}

type Kind = 'withdrawal' | 'proration' | 'goodwill' | 'decal_defect';

/**
 * AD-12 withdrawal and refund tool: compute first (nothing happens), then refund with a reason.
 * The Stripe refund and the credit note are one step; the result is shown with its PDF.
 */
export function RefundTool({
  me,
  customer,
  subscription,
  order,
  initial,
}: {
  me: StaffMe;
  customer: { id: string; email: string };
  subscription: CustomerView['subscriptions'][number] | null;
  order: CustomerView['orders'][number] | null;
  initial: RefundList | null;
}) {
  const { t, locale } = useI18n();
  const kinds: Kind[] = subscription
    ? ['withdrawal', 'proration', 'goodwill']
    : ['decal_defect', 'goodwill'];
  const [kind, setKind] = useState<Kind>(kinds[0]!);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [refunds, setRefunds] = useState(initial?.refunds ?? []);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const target = () => ({
    kind,
    ...(subscription ? { subscriptionId: subscription.id } : { orderId: order!.id }),
    ...(kind === 'goodwill'
      ? { amountCents: Math.round(Number(amount.replace(',', '.')) * 100) }
      : {}),
  });
  const explain = (err: unknown) => {
    const code = errorCode(err);
    const known = [
      'withdrawal_period_over',
      'not_cancelled',
      'nothing_to_refund',
      'amount_too_high',
      'not_paid_online',
      'no_charge',
      'not_live',
    ];
    return code && known.includes(code)
      ? t(`opsRefund.error_${code}` as MessageKey)
      : t('ops.error');
  };

  async function compute(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setQuote(null);
    try {
      setQuote(await opsApi<Quote>('/ops/v1/refunds/quote', { body: target() }));
    } catch (err) {
      setMsg({ tone: 'danger', text: explain(err) });
    }
  }

  async function execute(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await opsApi<{ creditNoteNo: string; refundCents: number }>('/ops/v1/refunds', {
        body: { refund: target(), reason },
      });
      setMsg({
        tone: 'success',
        text: t('opsRefund.done', { amount: euro(r.refundCents, locale), number: r.creditNoteNo }),
      });
      setQuote(null);
      setReason('');
      const q = subscription ? `subscriptionId=${subscription.id}` : `orderId=${order!.id}`;
      setRefunds((await opsApi<RefundList>(`/ops/v1/refunds?${q}`)).refunds);
    } catch (err) {
      setMsg({ tone: 'danger', text: explain(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Link href={`/kunden/${customer.id}`} className="text-primary underline">
            {t('opsRefund.back')}
          </Link>
          <Heading level={1} className="mt-2">
            {t('opsRefund.title')}
          </Heading>
          <Text muted>
            {customer.email} ·{' '}
            {subscription
              ? t('opsRefund.forSubscription', {
                  plan: subscription.plan,
                  contract: subscription.contractNo ?? '–',
                })
              : t('opsRefund.forOrder', {
                  date: fmt(order!.createdAt, locale),
                  amount: euro(order!.totalCents, locale),
                })}
          </Text>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <Card>
          <form onSubmit={compute} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-semibold">{t('opsRefund.kind')}</legend>
              {kinds.map((k) => (
                <label key={k} className="flex min-h-12 cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="kind"
                    className="mt-1 size-5 accent-[var(--ps-primary)]"
                    checked={kind === k}
                    onChange={() => {
                      setKind(k);
                      setQuote(null);
                    }}
                  />
                  <span>
                    <span className="font-semibold">{t(`opsRefund.kind_${k}` as MessageKey)}</span>
                    <span className="block text-sm text-muted">
                      {t(`opsRefund.kindHint_${k}` as MessageKey)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            {kind === 'goodwill' && (
              <div className="sm:max-w-64">
                <Field label={t('opsRefund.amount')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      inputMode="decimal"
                      pattern="\d+([.,]\d{1,2})?"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            )}
            <Button type="submit" variant="secondary" className="w-fit">
              {t('opsRefund.compute')}
            </Button>
          </form>
        </Card>

        {quote && (
          <Card>
            <Stack gap={3}>
              <Heading level={2} className="text-xl">
                {t('opsRefund.quoteTitle')}
              </Heading>
              <dl
                className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 sm:max-w-md"
                aria-label={t('opsRefund.quoteTitle')}
              >
                <dt>{t('opsRefund.paid')}</dt>
                <dd className="text-right">{euro(quote.paidCents, locale)}</dd>
                {quote.alreadyRefundedCents > 0 && (
                  <>
                    <dt>{t('opsRefund.already')}</dt>
                    <dd className="text-right">−{euro(quote.alreadyRefundedCents, locale)}</dd>
                  </>
                )}
                {quote.wertersatzCents > 0 && (
                  <>
                    <dt>
                      {t('opsRefund.wertersatz', {
                        used: quote.daysUsed ?? 0,
                        days: quote.periodDays ?? 0,
                      })}
                    </dt>
                    <dd className="text-right">−{euro(quote.wertersatzCents, locale)}</dd>
                  </>
                )}
                {quote.decalCostCents > 0 && (
                  <>
                    <dt>{t('opsRefund.decalCost')}</dt>
                    <dd className="text-right">−{euro(quote.decalCostCents, locale)}</dd>
                  </>
                )}
                <dt className="font-bold">{t('opsRefund.refund')}</dt>
                <dd className="text-right font-bold">{euro(quote.refundCents, locale)}</dd>
              </dl>
              {quote.endsSubscriptionNow && (
                <Notice tone="warning">{t('opsRefund.endsNow')}</Notice>
              )}
              <form onSubmit={execute} className="flex flex-col gap-3">
                <Field label={t('opsRefund.reason')} hint={t('opsRefund.reasonHint')}>
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      required
                      minLength={10}
                      maxLength={300}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  )}
                </Field>
                <Button
                  type="submit"
                  variant="danger"
                  className="w-fit"
                  busy={busy}
                  disabled={quote.refundCents <= 0}
                >
                  {t('opsRefund.execute', { amount: euro(quote.refundCents, locale) })}
                </Button>
              </form>
            </Stack>
          </Card>
        )}

        <Card>
          <Stack gap={2}>
            <Heading level={2} className="text-xl">
              {t('opsRefund.history')}
            </Heading>
            <ul className="flex flex-col gap-1" aria-label={t('opsRefund.history')}>
              {refunds.length === 0 && <li>–</li>}
              {refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap gap-2">
                  <span>{fmt(r.createdAt, locale)}</span>·
                  <span>{t(`opsRefund.kind_${r.kind}` as MessageKey)}</span>·
                  <span className="font-semibold">{euro(r.refundCents, locale)}</span>·
                  <a
                    href={`/ops/v1/refunds/${r.id}/credit-note.pdf`}
                    className="text-primary underline"
                  >
                    {t('opsRefund.creditNote', { number: r.creditNoteNo ?? '–' })}
                  </a>
                </li>
              ))}
            </ul>
          </Stack>
        </Card>
      </Stack>
    </OpsShell>
  );
}
