'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Badge,
  Button,
  Card,
  Container,
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
import { PageShell } from '@/components/site-chrome';
import { api, ApiError, errorText } from '@/lib/api-client';
import type { Vehicle } from '@/lib/api-server';

const PLAN_LABEL: Record<string, string> = { plus: 'Plus', premium: 'Premium' };

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

export function VehiclesView({ initial, subscribed }: { initial: Vehicle[]; subscribed: boolean }) {
  const { t } = useI18n();
  const [vehicles, setVehicles] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function add(v: { nickname: string; plate: string; color: string; makeModel: string }) {
    setError(null);
    try {
      const created = await api<Vehicle>('/v1/vehicles', { body: v });
      setVehicles((list) => [...list, created]);
      setFormKey((k) => k + 1);
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'vehicle_limit') {
        const body = err.body as { limit: number; plan: string };
        setError(
          t('vehicles.limitReached', {
            limit: body.limit,
            plan: PLAN_LABEL[body.plan] ?? body.plan,
          }),
        );
      } else {
        setError(errorText(err, t));
      }
    }
  }

  return (
    <PageShell>
      <Container className="py-10">
        <Stack gap={6}>
          <div>
            <Link href="/konto" className="text-primary underline">
              {t('vehicles.toAccount')}
            </Link>
            <Heading level={1} className="mt-2">
              {t('vehicles.title')}
            </Heading>
            <Text muted>{t('vehicles.intro')}</Text>
          </div>

          {vehicles.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {vehicles.map((v) => (
                <li key={v.id}>
                  <Card className="flex h-full flex-col gap-3">
                    <Heading level={2} className="text-xl">
                      {v.nickname}
                    </Heading>
                    <Text muted>{[v.plate, v.color, v.makeModel].filter(Boolean).join(' · ')}</Text>
                    {v.decal && (
                      <Badge
                        tone={v.decal.status === 'active' ? 'success' : 'info'}
                        className="w-fit"
                      >
                        {t('vehicles.decalStatus', {
                          hint: v.decal.codeHint,
                          status: t(`vehicles.status_${v.decal.status}` as MessageKey),
                        })}
                      </Badge>
                    )}
                    <Link
                      href={`/konto/fahrzeuge/${v.id}`}
                      className="mt-auto inline-flex min-h-12 w-fit items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
                    >
                      {t('vehicles.open')}
                      <span className="sr-only">: {v.nickname}</span>
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          <Card>
            <Stack gap={4}>
              <Heading level={2} className="text-xl">
                {t('vehicles.add')}
              </Heading>
              {subscribed ? (
                <VehicleForm key={formKey} submitLabel={t('vehicles.add')} onSubmit={add} />
              ) : (
                <Notice tone="info">{t('vehicles.noSubscription')}</Notice>
              )}
              {error && <Notice tone="warning">{error}</Notice>}
            </Stack>
          </Card>
        </Stack>
      </Container>
    </PageShell>
  );
}
