'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  CTA_MAX,
  CTA_SUGGESTIONS,
  DECAL_PRODUCTS,
  DECAL_TEMPLATES,
  isValidVehicleLabel,
  type DecalProduct,
  type DecalTemplate,
} from '@parkshield/shared';
import { Badge, Button, Field, Input, Notice, Select, Stack, Text, useI18n } from '@parkshield/ui';
import { clsx } from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { KontoShell, Section } from '@/components/konto-shell';
import { api, ApiError, errorText } from '@/lib/api-client';
import type {
  OrderSummary,
  PrintOptions,
  Vehicle,
  VehicleMode,
  VehicleProtection,
} from '@/lib/api-server';
import { NoActiveCode } from '../../no-active-code';
import { useEuro } from '../../parts';
import { VehicleForm } from '../vehicles-view';
import { ModeCard } from './mode-card';
import { ProtectionCard } from './protection-card';

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
    <Section
      id="design"
      title={t('decal.title')}
      icon="zap"
      intro={t('portal.designIntro')}
      className="scroll-mt-6"
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <Stack gap={6}>
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
          <h3 className="text-lg font-bold">{t('decal.preview')}</h3>
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
        </Stack>
      </div>
    </Section>
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
  initial,
  submitLabel,
  submitDisabled,
  beforeSubmit,
  onSubmit,
}: {
  intro?: string;
  /** Prefill (the sign-up address); the owner may change it for this shipment. */
  initial?: Address | null;
  submitLabel: string;
  submitDisabled?: boolean;
  /** Shown right above the button (the personalisation notice). */
  beforeSubmit?: ReactNode;
  onSubmit: (address: Address) => Promise<void>;
}) {
  const { t } = useI18n();
  const [a, setA] = useState({
    name: initial?.name ?? '',
    line1: initial?.line1 ?? '',
    line2: initial?.line2 ?? '',
    postalCode: initial?.postalCode ?? '',
    city: initial?.city ?? '',
  });
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
      {intro && <Text>{intro}</Text>}
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
      {beforeSubmit}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button type="submit" busy={busy} disabled={submitDisabled} className="w-fit">
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * The vehicle's own QR code first: what it is, where a scan leads, how to print it and how to test it.
 * The code itself lives in the database (qr_tokens: SHA-256 hash for lookups, AES-GCM copy for
 * re-rendering), so this image and the PDF always show the same, current code.
 */
function QrHero({ vehicle }: { vehicle: Vehicle }) {
  const { t } = useI18n();
  const decal = vehicle.decal!;
  const [open, setOpen] = useState<{ until: string; scanUrl: string } | null>(null);
  const src = `/v1/vehicles/${vehicle.id}/decal.svg?${new URLSearchParams({
    template: decal.template,
    cta: decal.cta,
  })}`;

  async function start() {
    setOpen(
      await api<{ until: string; scanUrl: string }>(`/v1/vehicles/${vehicle.id}/test-window`, {
        body: {},
      }),
    );
  }

  return (
    <Section
      title={t('portal.qrHeroTitle')}
      icon="qr"
      className="border-2 border-primary"
      aside={
        <Badge tone={decal.status === 'assigned' ? 'success' : 'info'}>
          {t('vehicles.decalStatus', {
            hint: decal.codeHint,
            status: t(`vehicles.status_${decal.status}` as MessageKey),
          })}
        </Badge>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:items-start">
        <div className="grid place-items-center rounded-2xl border border-border bg-secondary/40 p-4">
          <img
            src={src}
            alt={t('portal.qrAlt', { nickname: vehicle.nickname })}
            width={256}
            height={256}
            className="h-auto w-full max-w-64"
          />
        </div>
        <Stack gap={4}>
          <Text>{t('portal.qrHeroText', { nickname: vehicle.nickname })}</Text>
          <a
            href="#drucken"
            className="inline-flex min-h-12 w-fit items-center gap-2 font-semibold text-primary underline-offset-4 hover:underline"
          >
            <Icon name="download" className="size-5" />
            {t('order.printTitle')}
          </a>
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="text-lg font-bold">{t('decalTest.title')}</h3>
            <Text>{t('decalTest.intro')}</Text>
            <Text muted>
              {decal.lastTestAt
                ? t('decalTest.lastTest', { date: new Date(decal.lastTestAt) })
                : t('decalTest.never')}
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
              <Button variant="secondary" onClick={start} className="w-fit">
                {t('decalTest.button')}
              </Button>
            )}
          </div>
        </Stack>
      </div>
    </Section>
  );
}

const REASONS = ['leaked', 'car_sold', 'damaged', 'other'] as const;

const download =
  'inline-flex min-h-12 items-center gap-2 rounded-xl border-2 border-border-strong px-4 font-semibold hover:border-primary';

/**
 * One section with both ways to the decal, each with its price before the owner confirms (2026-11-21):
 * self-printing is always free (PDF 80 × 80 mm with cut marks, PNG, SVG); printing and shipping is free
 * once (the welcome print, or a replacement ops granted) and then a one-time Stripe payment.
 */
function PrintOptionsSection({
  vehicle,
  options,
  orders,
  orderResult,
  onOrdered,
}: {
  vehicle: Vehicle;
  options: PrintOptions;
  orders: OrderSummary[];
  orderResult?: 'paid' | 'canceled';
  onOrdered: () => Promise<void>;
}) {
  const { t } = useI18n();
  const euro = useEuro();
  const [ordered, setOrdered] = useState(false);
  // Part B (2026-11-22): one confirmation step before „Drucken und zusenden lassen“ is ordered.
  const [confirming, setConfirming] = useState(false);
  const shipped = options.shipped;
  const label = options.personalization?.label ?? vehicle.nickname;
  const labelValid = options.personalization?.labelValid ?? isValidVehicleLabel(label);
  const price = shipped.free
    ? shipped.welcomePrint
      ? t('order.priceWelcome')
      : t('order.priceFree')
    : t('order.pricePaid', { price: euro(shipped.priceCents) });
  const base = `/v1/vehicles/${vehicle.id}`;

  return (
    <Section
      id="drucken"
      title={t('order.printTitle')}
      icon="truck"
      intro={vehicle.decal ? t('order.printIntro') : undefined}
      className="scroll-mt-6"
    >
      {orderResult === 'paid' && <Notice tone="success">{t('order.paidNotice')}</Notice>}
      {orderResult === 'canceled' && <Notice tone="warning">{t('order.canceledNotice')}</Notice>}
      {ordered && <Notice tone="success">{t('order.submitted')}</Notice>}
      {!vehicle.decal ? (
        <Text muted>{t('order.needsCode')}</Text>
      ) : (
        <ol className="grid gap-4 xl:grid-cols-2">
          <li className="flex flex-col gap-3 rounded-2xl border border-border bg-bg p-4 sm:p-5">
            <h3 className="text-lg font-bold">{t('order.selfTitle')}</h3>
            <Text>{t('order.selfText')}</Text>
            <div className="flex flex-wrap gap-2">
              <a href={`${base}/decal.pdf`} download className={download}>
                <Icon name="download" className="size-5" />
                {t('order.selfPdf')}
              </a>
              <a href={`${base}/decal.png`} download className={download}>
                <Icon name="download" className="size-5" />
                {t('order.selfPng')}
              </a>
              <a href={`${base}/decal.svg`} download className={download}>
                <Icon name="download" className="size-5" />
                {t('order.selfSvg')}
              </a>
            </div>
            <Notice tone="info">{t('order.paperNotice')}</Notice>
          </li>
          <li className="flex flex-col gap-3 rounded-2xl border border-border bg-bg p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold">{t('order.shippedTitle')}</h3>
              <Badge tone={shipped.free ? 'success' : 'info'}>{price}</Badge>
            </div>
            <Text>{t('order.shippedText')}</Text>
            {!confirming ? (
              <Button
                variant="secondary"
                className="w-fit"
                onClick={() => setConfirming(true)}
                data-testid="print-confirm-open"
              >
                {t('order.confirmNext')}
              </Button>
            ) : (
              <div className="flex flex-col gap-4" data-testid="print-confirm">
                <h4 className="font-bold">{t('order.confirmTitle')}</h4>
                <Text>{t('order.confirmIntro')}</Text>
                <img
                  src={`${base}/decal.svg?${new URLSearchParams({
                    template: options.personalization?.template ?? vehicle.decal.template,
                    cta: options.personalization?.cta ?? vehicle.decal.cta,
                  })}`}
                  alt={t('decal.previewAlt', {
                    cta: options.personalization?.cta ?? vehicle.decal.cta,
                  })}
                  className="w-full max-w-xs rounded-xl border border-border bg-surface"
                />
                <Text>{t('order.confirmLabel', { label })}</Text>
                <a href="#design" className="w-fit font-semibold underline">
                  {t('order.confirmDesign')}
                </a>
                {!labelValid && <Notice tone="danger">{t('order.labelInvalid')}</Notice>}
                <AddressForm
                  initial={options.addressPrefill ?? null}
                  submitDisabled={!labelValid}
                  submitLabel={
                    shipped.free
                      ? t('order.confirmFree')
                      : t('order.confirmPaid', { price: euro(shipped.priceCents) })
                  }
                  beforeSubmit={
                    // TODO [LEGAL REVIEW] § 312g Abs. 2 Nr. 1 BGB notice before the order (personalised sticker).
                    <Notice tone="info">{t('order.personalizedNotice')}</Notice>
                  }
                  onSubmit={async (address) => {
                    const r = await api<{ id?: string; url: string; free: boolean }>(
                      `${base}/order-print`,
                      { body: { address, personalizationConfirmed: true } },
                    );
                    if (!r.free) {
                      // 3 € one-time payment on Stripe's page; back to this page with ?order=paid|canceled.
                      window.location.assign(r.url);
                      return;
                    }
                    setOrdered(true);
                    setConfirming(false);
                    await onOrdered();
                  }}
                />
                <Button variant="ghost" className="w-fit" onClick={() => setConfirming(false)}>
                  {t('order.confirmBack')}
                </Button>
              </div>
            )}
          </li>
        </ol>
      )}
      {orders.length > 0 && (
        <>
          <h3 className="text-lg font-bold">{t('order.orders')}</h3>
          <ul className="flex flex-col divide-y divide-border">
            {orders.map((o) => (
              <li key={o.id} className="py-2">
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
        </>
      )}
    </Section>
  );
}

/**
 * „Sperren“ (2026-11-21): the code stops working at once and no new code is created. A confirmation
 * dialog says exactly what happens; afterwards the vehicle shows „Kein aktiver Code“ with the free
 * „Neuen Code erstellen“.
 */
function LockCode({
  vehicle,
  printPriceCents,
  onLocked,
}: {
  vehicle: Vehicle;
  printPriceCents: number;
  onLocked: (v: Vehicle) => void;
}) {
  const { t } = useI18n();
  const euro = useEuro();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('leaked');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lock() {
    setBusy(true);
    setError(null);
    try {
      const v = await api<Vehicle>(`/v1/vehicles/${vehicle.id}/tokens/revoke`, {
        body: { confirm: true, reason },
      });
      dialog.current?.close();
      onLocked(v);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('revoke.title')} icon="lock" intro={t('revoke.lockIntro')}>
      <Field label={t('revoke.reason')}>
        {({ id }) => (
          <Select
            id={id}
            value={reason}
            onChange={(e) => setReason(e.target.value as typeof reason)}
            className="max-w-sm"
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`revoke.reason_${r}` as MessageKey)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button variant="danger" onClick={() => dialog.current?.showModal()} className="w-fit">
        {t('revoke.lockButton')}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`lock-title-${vehicle.id}`}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-fg shadow-xl backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 id={`lock-title-${vehicle.id}`} className="text-xl font-bold">
            {t('revoke.dialogTitle')}
          </h2>
          <ul className="flex flex-col gap-2">
            {[
              t('revoke.dialogStop'),
              t('revoke.dialogNoNew'),
              t('revoke.dialogFree'),
              t('revoke.dialogPrint', { price: euro(printPriceCents) }),
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Icon name="arrowRight" className="mt-1 size-4 shrink-0 text-muted" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" onClick={lock} busy={busy}>
              {t('revoke.dialogConfirm')}
            </Button>
            <Button variant="secondary" onClick={() => dialog.current?.close()}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </dialog>
    </Section>
  );
}

export function VehicleDetail({
  vehicle: initial,
  orders: initialOrders,
  printOptions: initialOptions,
  printPriceCents,
  orderResult,
  mode,
  protection,
}: {
  mode: VehicleMode | null;
  protection: VehicleProtection;
  vehicle: Vehicle;
  orders: OrderSummary[];
  printOptions: PrintOptions;
  printPriceCents: number;
  orderResult?: 'paid' | 'canceled';
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [vehicle, setVehicle] = useState(initial);
  const [orders, setOrders] = useState(initialOrders);
  const [options, setOptions] = useState(initialOptions);
  const [notice, setNotice] = useState<'locked' | 'created' | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);

  async function reloadOrders() {
    const [list, opts] = await Promise.all([
      api<{ orders: OrderSummary[] }>('/v1/orders'),
      api<PrintOptions>(`/v1/vehicles/${vehicle.id}/print-options`),
    ]);
    setOrders(list.orders.filter((o) => o.vehicleId === vehicle.id));
    setOptions(opts);
  }

  async function remove() {
    if (!window.confirm(t('vehicles.deleteConfirm'))) return;
    await api(`/v1/vehicles/${vehicle.id}`, { method: 'DELETE' });
    router.push('/konto/fahrzeuge');
    router.refresh();
  }

  return (
    <KontoShell
      title={vehicle.nickname}
      intro={[vehicle.plate, vehicle.color, vehicle.makeModel].filter(Boolean).join(' · ')}
      back={{ href: '/konto/fahrzeuge', label: t('vehicles.back') }}
    >
      {notice === 'locked' && <Notice tone="success">{t('revoke.lockedDone')}</Notice>}
      {notice === 'created' && <Notice tone="success">{t('portal.newCodeDone')}</Notice>}
      {!vehicle.decal && (
        <NoActiveCode
          vehicle={vehicle}
          onCreated={(v) => {
            setVehicle(v);
            setNotice('created');
          }}
        />
      )}
      {vehicle.decal && (
        <QrHero
          key={`${vehicle.decal.tokenId}-${vehicle.decal.template}-${vehicle.decal.cta}`}
          vehicle={vehicle}
        />
      )}
      <PrintOptionsSection
        key={vehicle.decal?.tokenId ?? 'none'}
        vehicle={vehicle}
        options={options}
        orders={orders}
        orderResult={orderResult}
        onOrdered={reloadOrders}
      />
      {vehicle.decal && (
        <Designer key={`d-${vehicle.decal.tokenId}`} vehicle={vehicle} onSaved={setVehicle} />
      )}

      <ModeCard vehicleId={vehicle.id} initial={mode} />

      <ProtectionCard vehicleId={vehicle.id} initial={protection} />

      <Section title={t('vehicles.details')} icon="car">
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
      </Section>

      {vehicle.decal && (
        <LockCode
          vehicle={vehicle}
          printPriceCents={printPriceCents}
          onLocked={(v) => {
            setVehicle(v);
            setNotice('locked');
            window.scrollTo({ top: 0 });
          }}
        />
      )}

      <Section title={t('vehicles.delete')} icon="alert" intro={t('portal.deleteIntro')}>
        <Button variant="danger" onClick={remove} className="w-fit">
          {t('vehicles.delete')}
        </Button>
      </Section>
    </KontoShell>
  );
}
