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
  Select,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { errorCode, euro, fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';
import type { Partners } from '../partner/partners';

export interface PromoList {
  promos: {
    id: string;
    code: string;
    kind: 'percent_off' | 'amount_off' | 'extra_months';
    value: number;
    appliesTo: string[] | null;
    priceLockMonths: number | null;
    maxRedemptions: number | null;
    validUntil: string | null;
    active: boolean;
    synced: boolean;
    partner: string | null;
    redemptions: number;
  }[];
}

const EMPTY = {
  code: '',
  kind: 'percent_off',
  value: '',
  priceLockMonths: '',
  maxRedemptions: '',
  validUntil: '',
  partnerId: '',
  plusOnly: false,
};

/** US-40 / AD-13: promo codes, synced to Stripe coupons, with the founders' price lock. */
export function PromosView({
  me,
  initial,
  partners,
}: {
  me: StaffMe;
  initial: PromoList | null;
  partners: Partners['partners'];
}) {
  const { t, locale } = useI18n();
  const [promos, setPromos] = useState(initial?.promos ?? []);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const canManage = me.permissions.includes('promo.manage');
  const reload = async () => setPromos((await opsApi<PromoList>('/ops/v1/promo-codes')).promos);

  const valueText = (p: PromoList['promos'][number]) =>
    p.kind === 'percent_off'
      ? t('opsPromo.valuePercent', { value: p.value })
      : p.kind === 'amount_off'
        ? t('opsPromo.valueAmount', { amount: euro(p.value, locale) })
        : t('opsPromo.valueMonths', { months: p.value });

  async function create(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const value =
      form.kind === 'amount_off'
        ? Math.round(Number(form.value.replace(',', '.')) * 100)
        : Number(form.value);
    try {
      await opsApi('/ops/v1/promo-codes', {
        body: {
          code: form.code,
          kind: form.kind,
          value,
          ...(form.plusOnly ? { appliesTo: ['plus'] } : {}),
          ...(form.priceLockMonths ? { priceLockMonths: Number(form.priceLockMonths) } : {}),
          ...(form.maxRedemptions ? { maxRedemptions: Number(form.maxRedemptions) } : {}),
          ...(form.validUntil
            ? { validUntil: new Date(`${form.validUntil}T23:59:59`).toISOString() }
            : {}),
          ...(form.partnerId ? { partnerId: form.partnerId } : {}),
        },
      });
      setMsg({ tone: 'success', text: t('opsPromo.created', { code: form.code.toUpperCase() }) });
      setForm(EMPTY);
      await reload();
    } catch (err) {
      const code = errorCode(err);
      setMsg({
        tone: 'danger',
        text:
          code === 'promo_exists'
            ? t('opsPromo.exists')
            : code === 'value_out_of_range'
              ? t('opsPromo.range')
              : t('ops.error'),
      });
    }
  }

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsPromo.title')}</Heading>
          <Text muted>{t('opsPromo.intro')}</Text>
        </div>
        {!initial && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <ul className="flex flex-col gap-2" aria-label={t('opsPromo.list')}>
          {promos.length === 0 && <li>{t('opsPromo.empty')}</li>}
          {promos.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3"
            >
              <span className="font-mono font-semibold">{p.code}</span>
              <Badge tone={p.active ? 'success' : 'warning'}>
                {p.active ? t('opsPromo.active') : t('opsPromo.inactive')}
              </Badge>
              <span>{valueText(p)}</span>
              {p.priceLockMonths && (
                <Badge tone="info">{t('opsPromo.priceLock', { months: p.priceLockMonths })}</Badge>
              )}
              <span className="text-sm text-muted">
                {t('opsPromo.redemptions', { count: p.redemptions, max: p.maxRedemptions ?? '∞' })}
                {p.validUntil && ` · ${t('opsPromo.until', { date: fmt(p.validUntil, locale) })}`}
                {p.partner && ` · ${p.partner}`}
                {!p.synced && ` · ${t('opsPromo.notSynced')}`}
              </span>
              {canManage && p.active && (
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await opsApi(`/ops/v1/promo-codes/${p.id}/deactivate`, { body: {} });
                    setMsg({ tone: 'success', text: t('opsPromo.deactivated', { code: p.code }) });
                    await reload();
                  }}
                >
                  {t('opsPromo.deactivate')}
                  <span className="sr-only">: {p.code}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <Card>
            <form
              onSubmit={create}
              className="grid gap-3 md:grid-cols-2"
              aria-label={t('opsPromo.new')}
            >
              <Heading level={2} className="text-xl md:col-span-2">
                {t('opsPromo.new')}
              </Heading>
              <Field label={t('opsPromo.code')} hint={t('opsPromo.codeHint')}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    required
                    pattern="[A-Za-z0-9-]{3,40}"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('opsPromo.kind')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  >
                    {(['percent_off', 'amount_off', 'extra_months'] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(`opsPromo.kind_${k}` as MessageKey)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t(`opsPromo.valueLabel_${form.kind}` as MessageKey)}>
                {({ id }) => (
                  <Input
                    id={id}
                    required
                    inputMode="decimal"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('opsPromo.priceLockLabel')} optionalLabel={t('common.optional')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={120}
                    value={form.priceLockMonths}
                    onChange={(e) => setForm({ ...form, priceLockMonths: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('opsPromo.maxLabel')} optionalLabel={t('common.optional')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    value={form.maxRedemptions}
                    onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('opsPromo.validLabel')} optionalLabel={t('common.optional')}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={form.validUntil}
                    onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('opsPromo.partner')} optionalLabel={t('common.optional')}>
                {({ id }) => (
                  <Select
                    id={id}
                    value={form.partnerId}
                    onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
                  >
                    <option value="">–</option>
                    {partners.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Checkbox
                label={t('opsPromo.plusOnly')}
                checked={form.plusOnly}
                onChange={(e) => setForm({ ...form, plusOnly: e.target.checked })}
              />
              <Button type="submit" className="w-fit md:col-span-2">
                {t('opsPromo.create')}
              </Button>
            </form>
          </Card>
        )}
      </Stack>
    </OpsShell>
  );
}
