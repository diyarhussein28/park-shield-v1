'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Badge, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import type { Vehicle } from '@/lib/api-server';

/** One vehicle's QR code: the stored decal rendered as an image, its status and the two main actions. */
export function QrCard({
  vehicle: v,
  manageLabel,
  headingLevel = 3,
}: {
  vehicle: Vehicle;
  manageLabel?: string;
  /** 2 where the cards sit directly under the page title, 3 inside a titled section. */
  headingLevel?: 2 | 3;
}) {
  const { t } = useI18n();
  const H = `h${headingLevel}` as const;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-bg">
      {v.decal ? (
        <div className="grid place-items-center border-b border-border bg-secondary/40 p-4">
          <img
            src={`/v1/vehicles/${v.id}/decal.svg`}
            alt={t('portal.qrAlt', { nickname: v.nickname })}
            width={224}
            height={224}
            className="h-auto w-full max-w-56"
          />
        </div>
      ) : (
        // After „Sperren“: no active code until the owner creates a new one (free).
        <div className="grid min-h-40 place-items-center border-b-2 border-danger bg-danger-bg p-4 text-center font-semibold text-danger-text">
          <span className="flex flex-col items-center gap-2">
            <Icon name="alert" className="size-6" />
            {t('portal.noCodeTitle')}
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <H className="text-lg font-bold wrap-anywhere">{v.nickname}</H>
          <p className="text-muted wrap-anywhere">
            {[v.plate, v.color, v.makeModel].filter(Boolean).join(' · ')}
          </p>
        </div>
        {v.decal && (
          <Badge tone={v.decal.status === 'assigned' ? 'success' : 'info'} className="w-fit">
            {t('vehicles.decalStatus', {
              hint: v.decal.codeHint,
              status: t(`vehicles.status_${v.decal.status}` as MessageKey),
            })}
          </Badge>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {v.decal && (
            <a
              href={`/v1/vehicles/${v.id}/decal.pdf`}
              download
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-fg hover:bg-primary-hover"
            >
              <Icon name="download" className="size-5" />
              {t('portal.downloadPdf')}
              <span className="sr-only">: {v.nickname}</span>
            </a>
          )}
          <Link
            href={`/konto/fahrzeuge/${v.id}`}
            className="inline-flex min-h-12 items-center rounded-xl border-2 border-border-strong px-4 font-semibold hover:border-primary"
          >
            {manageLabel ?? t('portal.manageQr')}
            <span className="sr-only">: {v.nickname}</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
