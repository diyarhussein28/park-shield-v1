'use client';

import { useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { api } from '@/lib/api-client';
import type { Vehicle } from '@/lib/api-server';

/**
 * Part B (2026-11-22): the free welcome print is no longer queued on its own; it waits for the owner's
 * confirmation („Drucken und zusenden lassen“). Until then this call to action stays on /konto and
 * /konto/fahrzeuge.
 */
export function WelcomePrintCta({ vehicles }: { vehicles: Vehicle[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ includedAvailable: boolean }>('/v1/orders')
      .then((r) => live && setOpen(Boolean(r.includedAvailable)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const target = vehicles.find((v) => v.decal);
  if (!open || !target) return null;
  return (
    <Link
      href={`/konto/fahrzeuge/${target.id}#drucken`}
      data-testid="welcome-print-cta"
      className="flex items-center justify-between gap-4 rounded-2xl border-2 border-primary bg-surface p-4 font-semibold hover:bg-secondary sm:p-5"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-lg font-bold">{t('order.welcomeCta')}</span>
        <span className="font-normal text-muted">{t('order.welcomeCtaText')}</span>
      </span>
      <Icon name="arrowRight" className="size-5 shrink-0" />
    </Link>
  );
}
