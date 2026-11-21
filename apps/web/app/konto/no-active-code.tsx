'use client';

import { Button, Notice, useI18n } from '@parkshield/ui';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { api, errorText } from '@/lib/api-client';
import type { Vehicle } from '@/lib/api-server';

/**
 * After „Sperren“ the vehicle has no active code: a clear warning with the one action that fixes it.
 * Creating a new code is free (`POST /v1/vehicles/:id/tokens`); printing is a separate step.
 */
export function NoActiveCode({
  vehicle,
  onCreated,
  headingLevel = 2,
}: {
  vehicle: Vehicle;
  onCreated: (v: Vehicle) => void;
  headingLevel?: 2 | 3;
}) {
  const { t } = useI18n();
  const H = `h${headingLevel}` as const;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      onCreated(await api<Vehicle>(`/v1/vehicles/${vehicle.id}/tokens`, { body: {} }));
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby={`no-code-${vehicle.id}`}
      className="flex flex-col gap-3 rounded-2xl border-2 border-danger bg-danger-bg p-5 text-danger-text sm:p-6"
    >
      <H id={`no-code-${vehicle.id}`} className="flex items-start gap-2 text-xl font-bold">
        <Icon name="alert" className="mt-0.5 size-6 shrink-0" />
        <span className="min-w-0 wrap-anywhere">
          {t('portal.noCodeTitle')}
          <span className="sr-only">: {vehicle.nickname}</span>
        </span>
      </H>
      <p>{t('portal.noCodeText')}</p>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button onClick={create} busy={busy} className="w-fit">
        {t('portal.newCode')}
      </Button>
    </section>
  );
}
