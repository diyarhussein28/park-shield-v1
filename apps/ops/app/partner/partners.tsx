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
  useI18n,
} from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

export interface Partners {
  partners: {
    id: string;
    name: string;
    kind: string;
    contactEmail: string | null;
    commissionPct: number;
    active: boolean;
    codes: number;
    claimed: number;
    redemptions: number;
  }[];
}
export interface Batches {
  batches: {
    id: string;
    quantity: number;
    status: 'generated' | 'printed' | 'shipped';
    note: string | null;
    createdAt: string;
    partner: string | null;
    promoCode: string | null;
    claimed: number;
    active: number;
  }[];
}
export interface Promos {
  promos: { id: string; code: string; active: boolean }[];
}

const KINDS = ['hausverwaltung', 'driving_school', 'dealer', 'rental', 'insurer', 'other'] as const;

/** US-39 / AD-07: partners and their pre-printed decal batches. */
export function PartnersView({
  me,
  partners: p0,
  batches: b0,
  promos,
}: {
  me: StaffMe;
  partners: Partners | null;
  batches: Batches | null;
  promos: Promos | null;
}) {
  const { t, locale } = useI18n();
  const [partners, setPartners] = useState(p0?.partners ?? []);
  const [batches, setBatches] = useState(b0?.batches ?? []);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [np, setNp] = useState({
    name: '',
    kind: 'hausverwaltung',
    contactEmail: '',
    commissionPct: '0',
  });
  const [nb, setNb] = useState({ partnerId: '', promoCodeId: '', quantity: '50', note: '' });
  const canPartners = me.permissions.includes('partners.manage');
  const canBatches = me.permissions.includes('tokens.manage');

  const reload = async () => {
    setPartners((await opsApi<Partners>('/ops/v1/partners')).partners);
    if (canBatches) setBatches((await opsApi<Batches>('/ops/v1/batches')).batches);
  };
  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg({ tone: 'success', text: ok });
      return true;
    } catch {
      setMsg({ tone: 'danger', text: t('ops.error') });
      return false;
    }
  }
  const active = partners.filter((x) => x.active);

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsPartners.title')}</Heading>
          <Text muted>{t('opsPartners.intro')}</Text>
        </div>
        {!p0 && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsPartners.partners')}
            </Heading>
            <ul className="flex flex-col gap-2" aria-label={t('opsPartners.partners')}>
              {partners.length === 0 && <li>{t('opsPartners.noPartners')}</li>}
              {partners.map((x) => (
                <li
                  key={x.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3"
                >
                  <span className="font-semibold">{x.name}</span>
                  <Badge>{t(`opsPartners.kind_${x.kind}` as MessageKey)}</Badge>
                  {!x.active && <Badge tone="warning">{t('opsPartners.inactive')}</Badge>}
                  <span className="text-sm text-muted">
                    {t('opsPartners.stats', {
                      codes: x.codes,
                      claimed: x.claimed,
                      redemptions: x.redemptions,
                    })}
                  </span>
                  {canPartners && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        run(
                          () =>
                            opsApi(`/ops/v1/partners/${x.id}/active`, {
                              body: { active: !x.active },
                            }),
                          t('opsPartners.saved'),
                        )
                      }
                    >
                      {x.active ? t('opsPartners.deactivate') : t('opsPartners.activate')}
                      <span className="sr-only">: {x.name}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canPartners && (
              <form
                className="grid gap-3 md:grid-cols-2"
                aria-label={t('opsPartners.newPartner')}
                onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  const ok = await run(
                    () =>
                      opsApi('/ops/v1/partners', {
                        body: { ...np, commissionPct: Number(np.commissionPct) || 0 },
                      }),
                    t('opsPartners.created'),
                  );
                  if (ok)
                    setNp({
                      name: '',
                      kind: 'hausverwaltung',
                      contactEmail: '',
                      commissionPct: '0',
                    });
                }}
              >
                <Heading level={3} className="text-base md:col-span-2">
                  {t('opsPartners.newPartner')}
                </Heading>
                <Field label={t('opsPartners.name')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      minLength={2}
                      maxLength={120}
                      value={np.name}
                      onChange={(e) => setNp({ ...np, name: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t('opsPartners.kind')}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={np.kind}
                      onChange={(e) => setNp({ ...np, kind: e.target.value })}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`opsPartners.kind_${k}` as MessageKey)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('opsPartners.contactEmail')} optionalLabel={t('common.optional')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="email"
                      value={np.contactEmail}
                      onChange={(e) => setNp({ ...np, contactEmail: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t('opsPartners.commission')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={np.commissionPct}
                      onChange={(e) => setNp({ ...np, commissionPct: e.target.value })}
                    />
                  )}
                </Field>
                <Button type="submit" className="w-fit">
                  {t('opsPartners.create')}
                </Button>
              </form>
            )}
          </Stack>
        </Card>

        {canBatches && (
          <Card>
            <Stack gap={3}>
              <Heading level={2} className="text-xl">
                {t('opsPartners.batches')}
              </Heading>
              <Text muted>{t('opsPartners.printFileNote')}</Text>
              <ul className="flex flex-col gap-2" aria-label={t('opsPartners.batches')}>
                {batches.length === 0 && <li>{t('opsPartners.noBatches')}</li>}
                {batches.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-col gap-2 rounded-xl border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{b.partner ?? '–'}</span>
                      <Badge tone={b.status === 'shipped' ? 'success' : 'info'}>
                        {t(`opsPartners.batch_${b.status}` as MessageKey)}
                      </Badge>
                      {b.promoCode && <Badge>{b.promoCode}</Badge>}
                      <span className="text-sm text-muted">
                        {t('opsPartners.batchLine', {
                          quantity: b.quantity,
                          claimed: b.claimed,
                          active: b.active,
                        })}{' '}
                        · {fmt(b.createdAt, locale)}
                        {b.note ? ` · „${b.note}“` : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <a
                        href={`/ops/v1/batches/${b.id}/print.pdf`}
                        className="text-primary underline"
                      >
                        {t('opsPartners.printFile')}
                        <span className="sr-only">
                          {' '}
                          ({b.partner}, {b.quantity})
                        </span>
                      </a>
                      {b.status === 'generated' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(
                              () => opsApi(`/ops/v1/batches/${b.id}/printed`, { body: {} }),
                              t('opsPartners.saved'),
                            )
                          }
                        >
                          {t('opsPartners.markPrinted')}
                        </Button>
                      )}
                      {b.status === 'printed' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(
                              () => opsApi(`/ops/v1/batches/${b.id}/shipped`, { body: {} }),
                              t('opsPartners.saved'),
                            )
                          }
                        >
                          {t('opsPartners.markShipped')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <form
                className="grid gap-3 md:grid-cols-2"
                aria-label={t('opsPartners.newBatch')}
                onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  const ok = await run(
                    () =>
                      opsApi('/ops/v1/batches', {
                        body: {
                          partnerId: nb.partnerId,
                          ...(nb.promoCodeId ? { promoCodeId: nb.promoCodeId } : {}),
                          quantity: Number(nb.quantity),
                          ...(nb.note ? { note: nb.note } : {}),
                        },
                      }),
                    t('opsPartners.batchCreated', { quantity: Number(nb.quantity) }),
                  );
                  if (ok) setNb({ partnerId: '', promoCodeId: '', quantity: '50', note: '' });
                }}
              >
                <Heading level={3} className="text-base md:col-span-2">
                  {t('opsPartners.newBatch')}
                </Heading>
                <Field label={t('opsPartners.partner')}>
                  {({ id }) => (
                    <Select
                      id={id}
                      required
                      value={nb.partnerId}
                      onChange={(e) => setNb({ ...nb, partnerId: e.target.value })}
                    >
                      <option value="">{t('opsPartners.choose')}</option>
                      {active.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('opsPartners.promo')}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={nb.promoCodeId}
                      onChange={(e) => setNb({ ...nb, promoCodeId: e.target.value })}
                    >
                      <option value="">{t('opsPartners.noPromo')}</option>
                      {(promos?.promos ?? [])
                        .filter((x) => x.active)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.code}
                          </option>
                        ))}
                    </Select>
                  )}
                </Field>
                <Field label={t('opsPartners.quantity')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      required
                      min={1}
                      max={1000}
                      value={nb.quantity}
                      onChange={(e) => setNb({ ...nb, quantity: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t('opsPartners.batchNote')} optionalLabel={t('common.optional')}>
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
                  {t('opsPartners.createBatch')}
                </Button>
              </form>
            </Stack>
          </Card>
        )}
      </Stack>
    </OpsShell>
  );
}
