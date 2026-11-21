'use client';

import { PLAN_LIMIT_DEFAULTS } from '@parkshield/shared';
import { Button, Field, Input, Notice, Text, useI18n } from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { KontoShell, Section } from '@/components/konto-shell';
import { api, ApiError, errorText } from '@/lib/api-client';
import type { Vehicle } from '@/lib/api-server';
import { NoActiveCode } from '../no-active-code';
import { QrCard } from '../qr-card';

export function VehicleForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Pick<Vehicle, 'nickname' | 'plate' | 'color' | 'makeModel'>;
  submitLabel: string;
  onSubmit: (v: {
    nickname: string;
    plate: string;
    color: string;
    makeModel: string;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    nickname: initial?.nickname ?? '',
    plate: initial?.plate ?? '',
    color: initial?.color ?? '',
    makeModel: initial?.makeModel ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit(form);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('vehicles.nickname')} hint={t('vehicles.nicknameHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            required
            maxLength={60}
            value={form.nickname}
            onChange={set('nickname')}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <Field label={t('vehicles.plate')} hint={t('vehicles.plateHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            required
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
            value={form.plate}
            onChange={set('plate')}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('vehicles.color')} optionalLabel={t('common.optional')}>
          {({ id }) => <Input id={id} maxLength={30} value={form.color} onChange={set('color')} />}
        </Field>
        <Field label={t('vehicles.makeModel')} optionalLabel={t('common.optional')}>
          {({ id }) => (
            <Input id={id} maxLength={80} value={form.makeModel} onChange={set('makeModel')} />
          )}
        </Field>
      </div>
      <Button type="submit" busy={busy} className="w-fit">
        {submitLabel}
      </Button>
    </form>
  );
}

/** Adds a vehicle (its QR code is issued in the same transaction) and turns the vehicle limit into text. */
export function useAddVehicle(onAdded: (v: Vehicle) => void) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  async function add(v: { nickname: string; plate: string; color: string; makeModel: string }) {
    setError(null);
    try {
      onAdded(await api<Vehicle>('/v1/vehicles', { body: v }));
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'vehicle_limit') {
        const body = err.body as { limit: number };
        setError(t('vehicles.limitReached', { limit: body.limit }));
      } else {
        setError(errorText(err, t));
      }
    }
  }

  return { add, error };
}

export function VehiclesView({ initial, subscribed }: { initial: Vehicle[]; subscribed: boolean }) {
  const { t } = useI18n();
  const [vehicles, setVehicles] = useState(initial);
  const [formKey, setFormKey] = useState(0);
  const { add, error } = useAddVehicle((created) => {
    setVehicles((list) => [...list, created]);
    setFormKey((k) => k + 1);
  });

  // One vehicle per account (setting `limits.vehicles`, owner decision 2026-11-21): once it is there,
  // no add form and no upgrade prompt, just a plain note.
  const limit = PLAN_LIMIT_DEFAULTS.vehicles;
  const full = vehicles.length >= limit;

  return (
    <KontoShell title={t('portal.vehiclesTitle')} intro={t('vehicles.intro')}>
      {vehicles
        .filter((v) => !v.decal)
        .map((v) => (
          <NoActiveCode
            key={v.id}
            vehicle={v}
            onCreated={(nv) => setVehicles((list) => list.map((x) => (x.id === nv.id ? nv : x)))}
          />
        ))}
      {vehicles.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {vehicles.map((v) => (
            <li key={v.id}>
              <QrCard vehicle={v} manageLabel={t('vehicles.open')} headingLevel={2} />
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <Text muted>{t('vehicles.limitReached', { limit })}</Text>
      ) : (
        <Section
          title={t('vehicles.add')}
          icon="plus"
          intro={subscribed ? t('portal.addIntro') : undefined}
          className={vehicles.length === 0 ? 'border-2 border-primary' : undefined}
        >
          {subscribed ? (
            <VehicleForm key={formKey} submitLabel={t('vehicles.add')} onSubmit={add} />
          ) : (
            <Notice tone="info">{t('vehicles.noSubscription')}</Notice>
          )}
          {error && <Notice tone="warning">{error}</Notice>}
        </Section>
      )}
    </KontoShell>
  );
}
