'use client';

import { useI18n } from '@parkshield/ui';
import type { ReactNode } from 'react';
import { Icon, LogoMark } from './icons';

/** Centered frame for sign-in and invitation: brand, one card, the access note. */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <LogoMark className="size-11" />
          <span className="leading-tight">
            <span className="block text-xl font-bold tracking-tight">ParkShield</span>
            <span className="block text-sm text-muted">{t('ops.brandSub')}</span>
          </span>
        </div>
        <div className="rounded-2xl border border-border bg-bg p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <div className="mt-4 flex flex-col gap-4">{children}</div>
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-muted">
          <Icon name="lock" className="size-4 shrink-0" />
          {t('ops.vpnOnly')}
        </p>
      </div>
    </main>
  );
}
