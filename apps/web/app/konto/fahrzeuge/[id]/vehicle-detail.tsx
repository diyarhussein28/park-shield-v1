'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  ADDON_PRICES_CENTS,
  CTA_MAX,
  CTA_SUGGESTIONS,
  DECAL_PRODUCTS,
  DECAL_TEMPLATES,
  type DecalProduct,
  type DecalTemplate,
} from '@parkshield/shared';
import {
  Button,
  Card,
  Container,
  Field,
  Heading,
  Input,
  Notice,
  Select,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { clsx } from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api, ApiError, errorText } from '@/lib/api-client';
import type { OrderSummary, Vehicle, VehicleMode } from '@/lib/api-server';
import { VehicleForm } from '../vehicles-view';
import { ModeCard } from './mode-card';

const CUSTOM = '__custom__';

function ChoiceGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  label,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: (v: T) => ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o}
            className={clsx(
              'flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-4',
              o === value ? 'border-primary bg-info-bg text-info-fg' : 'border-border-strong',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o}
              checked={o === value}
              onChange={() => onChange(o)}
              className="size-5"
            />
            {label(o)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Designer({ vehicle, onSaved }: { vehicle: Vehicle; onSaved: (v: Vehicle) => void }) {
  const { t } = useI18n();
  const saved = vehicle.decal!;
  const savedIsSuggestion = (CTA_SUGGESTIONS as readonly string[]).includes(saved.cta);
  const [template, setTemplate] = useState<DecalTemplate>(saved.template);
  const [choice, setChoice] = useState<string>(savedIsSuggestion ? saved.cta : CUSTOM);
  const [custom, setCustom] = useState(savedIsSuggestion ? '' : saved.cta);
  const [product, setProduct] = useState<DecalProduct>('uv_vinyl_sticker');
  const cta = choice === CUSTOM ? custom.trim() : choice;
  const [previewCta, setPreviewCta] = useState(cta);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Debounce typing so the preview is not re-rendered on every key stroke.
  useEffect(() => {
    const timer = setTimeout(() => setPreviewCta(cta), 350);
    return () => clearTimeout(timer);
  }, [cta]);

  const src = `/v1/vehicles/${vehicle.id}/decal.svg?${new URLSearchParams({
    template,
    product,
    ...(previewCta ? { cta: previewCta } : {}),
  })}`;
  const previewBroken = brokenSrc === src;

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      onSaved(
        await api<Vehicle>(`/v1/vehicles/${vehicle.id}/decal`, {
          method: 'PUT',
          body: { template, cta },
        }),
      );
      setMessage({ tone: 'success', text: t('vehicles.saved') });
    } catch (err) {
      const blocked = err instanceof ApiError && err.body?.error === 'cta_not_allowed';
      setMessage({ tone: 'danger', text: blocked ? t('decal.ctaNotAllowed') : errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Stack gap={6}>
          <Heading level={2} className="text-xl">
            {t('decal.title')}
          </Heading>
          <ChoiceGroup
            legend={t('decal.template')}
            name="template"
            options={DECAL_TEMPLATES}
            value={template}
            onChange={setTemplate}
            label={(o) => t(`decal.template_${o}` as MessageKey)}
          />
          <ChoiceGroup
            legend={t('decal.cta')}
            name="cta"
            options={[...CTA_SUGGESTIONS, CUSTOM]}
            value={choice}
            onChange={setChoice}
            label={(o) => (o === CUSTOM ? t('decal.ctaCustom') : o)}
          />
          {choice === CUSTOM && (
            <Field label={t('decal.ctaCustomLabel')}>
              {({ id }) => (
                <Input
                  id={id}
                  value={custom}
                  maxLength={CTA_MAX}
                  onChange={(e) => setCustom(e.target.value)}
                />
              )}
            </Field>
          )}
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <Button onClick={save} busy={busy} disabled={!cta} className="w-fit">
            {t('decal.save')}
          </Button>
        </Stack>
        <Stack gap={4}>
          <Heading level={3}>{t('decal.preview')}</Heading>
          <ChoiceGroup
            legend={t('decal.product')}
            name="product"
            options={DECAL_PRODUCTS}
            value={product}
            onChange={setProduct}
            label={(o) => t(`decal.product_${o}` as MessageKey)}
          />
          {previewBroken ? (
            <Notice tone="danger">{t('decal.ctaNotAllowed')}</Notice>
          ) : (
            <img
              src={src}
              alt={t('decal.previewAlt', { cta: previewCta })}
              onError={() => setBrokenSrc(src)}
              className={clsx(
                'w-full rounded-xl border border-border bg-surface',
                product === 'uv_vinyl_sticker' ? 'max-w-sm' : 'max-w-xs',
              )}
            />
          )}
          <a
            href={`/v1/vehicles/${vehicle.id}/decal.pdf`}
            download
            className="inline-flex min-h-12 w-fit items-center rounded-xl bg-secondary px-5 font-semibold text-secondary-fg"
          >
            {t('decal.homePdf')}
          </a>
          <Text muted className="text-sm">
            {t('decal.homePdfHint')}
          </Text>
        </Stack>
      </div>
    </Card>
  );
}

type Address = {
  name: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  country: 'DE';
};

function AddressForm({
  intro,
  submitLabel,
  onSubmit,
}: {
  intro: string;
  submitLabel: string;
  onSubmit: (address: Address) => Promise<void>;
}) {
  const { t } = useI18n();
  const [a, setA] = useState({ name: '', line1: '', line2: '', postalCode: '', city: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof a) => (e: { target: { value: string } }) =>
    setA((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...a, line2: a.line2 || undefined, country: 'DE' });
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Text>{intro}</Text>
      <Field label={t('order.name')}>
        {({ id }) => (
          <Input id={id} required autoComplete="name" value={a.name} onChange={set('name')} />
        )}
      </Field>
      <Field label={t('order.line1')}>
        {({ id }) => (
          <Input
            id={id}
            required
            autoComplete="address-line1"
            value={a.line1}
            onChange={set('line1')}
          />
        )}
      </Field>
      <Field label={t('order.line2')} optionalLabel={t('common.optional')}>
        {({ id }) => (
          <Input id={id} autoComplete="address-line2" value={a.line2} onChange={set('line2')} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field label={t('order.postalCode')}>
          {({ id }) => (
            <Input
              id={id}
              required
              inputMode="numeric"
              pattern="\d{5}"
              autoComplete="postal-code"
              value={a.postalCode}
              onChange={set('postalCode')}
            />
          )}
        </Field>
        <Field label={t('order.city')}>
          {({ id }) => (
            <Input
              id={id}
              required
              autoComplete="address-level2"
              value={a.city}
              onChange={set('city')}
            />
          )}
        </Field>
      </div>
      <Text muted className="text-sm">
        {t('order.countryNote')}
      </Text>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" busy={busy} className="w-fit">
        {submitLabel}
      </Button>
    </form>
  );
}

const euro = (cents: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);

function DecalTest({ vehicle }: { vehicle: Vehicle }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<{ until: string; scanUrl: string } | null>(null);
  const lastTest = vehicle.decal?.lastTestAt;

  async function start() {
    setOpen(
      await api<{ until: string; scanUrl: string }>(`/v1/vehicles/${vehicle.id}/test-window`, {
        body: {},
      }),
    );
  }

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('decalTest.title')}
        </Heading>
        <Text>{t('decalTest.intro')}</Text>
        <Text muted>
          {lastTest ? t('decalTest.lastTest', { date: new Date(lastTest) }) : t('decalTest.never')}
        </Text>
        {open ? (
          <>
            <Notice tone="info">{t('decalTest.open', { time: new Date(open.until) })}</Notice>
            <a
              href={open.scanUrl}
              target="_blank"
              rel="noreferrer"
              className="w-fit font-semibold text-primary underline"
            >
              {t('decalTest.openHere')}
            </a>
          </>
        ) : (
          <Button onClick={start} className="w-fit">
            {t('decalTest.button')}
          </Button>
        )}
      </Stack>
    </Card>
  );
}

const REASONS = ['leaked', 'car_sold', 'damaged', 'other'] as const;

function RevokeAndReplace({
  vehicle,
  onReissued,
  orderResult,
  freeReplacement,
}: {
  vehicle: Vehicle;
  onReissued: (v: Vehicle) => void;
  orderResult?: 'paid' | 'canceled';
  freeReplacement: boolean;
}) {
  const { t, locale } = useI18n();
  const [reason, setReason] = useState<(typeof REASONS)[number]>('leaked');
  const [done, setDone] = useState(false);
  const price = freeReplacement
    ? t('replacement.free')
    : euro(ADDON_PRICES_CENTS.replacementDecal, locale);

  async function revoke() {
    if (!window.confirm(t('revoke.confirm'))) return;
    onReissued(
      await api<Vehicle>(`/v1/vehicles/${vehicle.id}/tokens`, { body: { confirm: true, reason } }),
    );
    setDone(true);
  }

  return (
    <Card>
      <Stack gap={6}>
        <Stack gap={3}>
          <Heading level={2} className="text-xl">
            {t('revoke.title')}
          </Heading>
          <Text>{t('revoke.intro')}</Text>
          {done && <Notice tone="success">{t('revoke.done')}</Notice>}
          <Field label={t('revoke.reason')}>
            {({ id }) => (
              <Select
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value as typeof reason)}
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`revoke.reason_${r}` as MessageKey)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="danger" onClick={revoke} className="w-fit">
            {t('revoke.button')}
          </Button>
        </Stack>
        <Stack gap={3}>
          <Heading level={3}>{t('replacement.title')}</Heading>
          {orderResult === 'paid' && <Notice tone="success">{t('replacement.paid')}</Notice>}
          {orderResult === 'canceled' && (
            <Notice tone="warning">{t('replacement.canceled')}</Notice>
          )}
          <AddressForm
            intro={freeReplacement ? t('replacement.freeIntro') : t('replacement.intro', { price })}
            submitLabel={t('replacement.submit', { price })}
            onSubmit={async (address) => {
              const { url } = await api<{ url: string }>(
                `/v1/vehicles/${vehicle.id}/order-replacement`,
                {
                  body: { address },
                },
              );
              window.location.assign(url);
            }}
          />
        </Stack>
      </Stack>
    </Card>
  );
}

export function VehicleDetail({
  vehicle: initial,
  orders: initialOrders,
  includedAvailable,
  orderResult,
  mode,
  freeReplacements = 0,
}: {
  mode: VehicleMode | null;
  freeReplacements?: number;
  vehicle: Vehicle;
  orders: OrderSummary[];
  includedAvailable: boolean;
  orderResult?: 'paid' | 'canceled';
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [vehicle, setVehicle] = useState(initial);
  const [orders, setOrders] = useState(initialOrders);
  const [canOrder, setCanOrder] = useState(includedAvailable);
  const [justOrdered, setJustOrdered] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);

  async function remove() {
    if (!window.confirm(t('vehicles.deleteConfirm'))) return;
    await api(`/v1/vehicles/${vehicle.id}`, { method: 'DELETE' });
    router.push('/konto/fahrzeuge');
    router.refresh();
  }

  return (
    <PageShell>
      <Container className="max-w-5xl py-10">
        <Stack gap={6}>
          <div>
            <Link href="/konto/fahrzeuge" className="text-primary underline">
              {t('vehicles.back')}
            </Link>
            <Heading level={1} className="mt-2">
              {vehicle.nickname}
            </Heading>
          </div>

          {vehicle.decal && <DecalTest key={vehicle.decal.tokenId} vehicle={vehicle} />}
          <ModeCard vehicleId={vehicle.id} initial={mode} />
          {vehicle.decal && (
            <Designer key={`d-${vehicle.decal.tokenId}`} vehicle={vehicle} onSaved={setVehicle} />
          )}

          <Card>
            <Stack gap={4}>
              <Heading level={2} className="text-xl">
                {t('order.title')}
              </Heading>
              {justOrdered && <Notice tone="success">{t('order.submitted')}</Notice>}
              {canOrder ? (
                <AddressForm
                  intro={t('order.includedIntro')}
                  submitLabel={t('order.submit')}
                  onSubmit={async (address) => {
                    const o = await api<OrderSummary>(`/v1/vehicles/${vehicle.id}/order-included`, {
                      body: { address },
                    });
                    setOrders((list) => [o, ...list]);
                    setCanOrder(false);
                    setJustOrdered(true);
                  }}
                />
              ) : (
                orders.length === 0 && <Text muted>{t('order.used')}</Text>
              )}
              {orders.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {orders.map((o) => (
                    <li key={o.id}>
                      <Text>
                        {t('order.orderLine', {
                          nickname: o.nickname ?? vehicle.nickname,
                          date: new Date(o.createdAt),
                          status: t(`order.status_${o.status}` as MessageKey),
                        })}
                      </Text>
                      {o.trackingNumber && (
                        <Text muted>{t('order.tracking', { number: o.trackingNumber })}</Text>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Stack>
          </Card>

          {vehicle.decal && (
            <RevokeAndReplace
              vehicle={vehicle}
              onReissued={setVehicle}
              orderResult={orderResult}
              freeReplacement={freeReplacements > 0}
            />
          )}

          <Card>
            <Stack gap={4}>
              <Heading level={2} className="text-xl">
                {t('vehicles.details')}
              </Heading>
              {detailsSaved && <Notice tone="success">{t('vehicles.saved')}</Notice>}
              <VehicleForm
                initial={vehicle}
                submitLabel={t('vehicles.save')}
                onSubmit={async (v) => {
                  setVehicle(
                    await api<Vehicle>(`/v1/vehicles/${vehicle.id}`, { method: 'PATCH', body: v }),
                  );
                  setDetailsSaved(true);
                }}
              />
              <Button variant="danger" onClick={remove} className="w-fit">
                {t('vehicles.delete')}
              </Button>
            </Stack>
          </Card>
        </Stack>
      </Container>
    </PageShell>
  );
}
