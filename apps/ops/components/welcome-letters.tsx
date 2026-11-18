'use client';

import { Badge, Button, Notice, Select, useI18n } from '@parkshield/ui';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { linkButton, Section } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { cx } from '@/lib/cx';
import { fmt } from '@/lib/format';
import { label } from '@/lib/labels';

export interface LetterVersion {
  id: string;
  version: number;
  status: 'new' | 'downloaded' | 'sent';
  plan: string;
  addressMissing: boolean;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  firstDownloadedAt: string | null;
  sentAt: string | null;
}

/** GET /ops/v1/customers/:id/welcome-letters (letters.print). */
export interface LettersView {
  letters: LetterVersion[];
  vehicles: { vehicleId: string; number: number; active: boolean }[];
}

const FORMATS = ['svg', 'png', 'pdf'] as const;

export const letterTone = (s: string) =>
  s === 'sent' ? 'success' : s === 'downloaded' ? 'info' : 'warning';

/** Downloads keep the page; the status (NEU → HERUNTERGELADEN) shows after a short refresh. */
function useRefreshSoon() {
  const router = useRouter();
  return () => setTimeout(() => router.refresh(), 1200);
}

function Disabled({ text, hint }: { text: string; hint: string }) {
  const id = useId();
  return (
    <span className="flex flex-col gap-1">
      <Button variant="secondary" disabled aria-describedby={id} title={hint}>
        {text}
      </Button>
      <span id={id} className="max-w-64 text-sm text-muted">
        {hint}
      </span>
    </span>
  );
}

function FormatSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <Select
      aria-label={t('opsLetters.qrFormat')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 w-24"
    >
      {FORMATS.map((f) => (
        <option key={f} value={f}>
          {f.toUpperCase()}
        </option>
      ))}
    </Select>
  );
}

/** Customer header: the two one-click downloads, disabled with a reason until available. */
export function LetterHeaderActions({
  customerId,
  data,
}: {
  customerId: string;
  data: LettersView;
}) {
  const { t } = useI18n();
  const refresh = useRefreshSoon();
  const [format, setFormat] = useState('svg');
  const hasLetter = data.letters.length > 0;
  const hasCode = data.vehicles.some((v) => v.active);
  return (
    <>
      {hasLetter ? (
        <a
          href={`/ops/v1/customers/${customerId}/welcome-letter/latest.pdf`}
          className={linkButton}
          onClick={refresh}
        >
          {t('opsLetters.download')}
        </a>
      ) : (
        <Disabled text={t('opsLetters.download')} hint={t('opsLetters.downloadPending')} />
      )}
      {hasCode ? (
        <span className="flex items-center gap-2">
          <a href={`/ops/v1/customers/${customerId}/qr?format=${format}`} className={linkButton}>
            {t('opsLetters.qrDownload')}
          </a>
          <FormatSelect value={format} onChange={setFormat} />
        </span>
      ) : (
        <Disabled text={t('opsLetters.qrDownload')} hint={t('opsLetters.qrPending')} />
      )}
    </>
  );
}

/** QR button in a vehicle row (single vehicle); a blocked code shows greyed out. */
export function VehicleQrButton({
  vehicleId,
  nickname,
  active,
}: {
  vehicleId: string;
  nickname: string;
  active: boolean;
}) {
  const { t } = useI18n();
  const [format, setFormat] = useState('svg');
  if (!active) {
    return (
      <span className="text-sm text-muted">{`${t('opsLetters.qrVehicle')}: ${t('opsLetters.qrLocked')}`}</span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <a
        href={`/ops/v1/vehicles/${vehicleId}/qr?format=${format}`}
        className={cx(linkButton, 'min-h-11')}
        aria-label={t('opsLetters.qrVehicleLabel', { name: nickname })}
      >
        {t('opsLetters.qrVehicle')}
      </a>
      <FormatSelect value={format} onChange={setFormat} />
    </span>
  );
}

/** Section „Willkommensbrief“: status, preview, download, sent, re-create and the versions. */
export function WelcomeLetterSection({
  customerId,
  data,
  canManage,
}: {
  customerId: string;
  data: LettersView;
  canManage: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const refresh = useRefreshSoon();
  const [busy, setBusy] = useState<'sent' | 'recreate' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const latest = data.letters[0];

  async function markSent() {
    if (!latest) return;
    setBusy('sent');
    setMsg(null);
    try {
      await opsApi(`/ops/v1/welcome-letters/${latest.id}`, {
        method: 'PATCH',
        body: { status: 'sent' },
      });
      setMsg({ tone: 'success', text: t('opsLetters.sentDone') });
      router.refresh();
    } catch {
      setMsg({ tone: 'danger', text: t('opsLetters.failed') });
    } finally {
      setBusy(null);
    }
  }

  async function recreate() {
    if (!window.confirm(t('opsLetters.recreateConfirm'))) return;
    setBusy('recreate');
    setMsg(null);
    try {
      const r = await opsApi<LetterVersion>(`/ops/v1/customers/${customerId}/welcome-letters`, {
        body: {},
      });
      setMsg({ tone: 'success', text: t('opsLetters.recreated', { version: r.version }) });
      router.refresh();
    } catch {
      setMsg({ tone: 'danger', text: t('opsLetters.failed') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title={t('opsLetters.section')}
      icon="text"
      aside={
        latest && (
          <Badge tone={letterTone(latest.status)}>{label(t, 'letter', latest.status)}</Badge>
        )
      }
    >
      {!latest ? (
        <p className="text-sm text-muted">{t('opsLetters.none')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {latest.addressMissing && (
            <Notice tone="warning">{t('opsLetters.addressMissing')}</Notice>
          )}
          <div className="flex flex-wrap gap-3">
            <a
              href={`/ops/v1/welcome-letters/${latest.id}/pdf?inline=1`}
              target="_blank"
              rel="noopener"
              className={linkButton}
            >
              {t('opsLetters.preview')}
            </a>
            <a
              href={`/ops/v1/welcome-letters/${latest.id}/pdf`}
              className={linkButton}
              onClick={refresh}
            >
              {t('opsLetters.pdf')}
            </a>
            <Button
              variant="secondary"
              busy={busy === 'sent'}
              disabled={latest.status === 'sent'}
              onClick={() => void markSent()}
            >
              {t('opsLetters.markSent')}
            </Button>
            {canManage && (
              <Button
                variant="secondary"
                busy={busy === 'recreate'}
                onClick={() => void recreate()}
              >
                {t('opsLetters.recreate')}
              </Button>
            )}
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div>
            <p className="text-sm font-semibold">{t('opsLetters.versions')}</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {data.letters.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {t('opsLetters.versionLine', {
                      version: l.version,
                      date: fmt(l.createdAt, locale),
                      by: l.createdBy ? (l.createdByName ?? '–') : t('opsLetters.system'),
                    })}
                  </span>
                  <Badge tone={letterTone(l.status)}>{label(t, 'letter', l.status)}</Badge>
                  {l.id !== latest.id && (
                    <a
                      href={`/ops/v1/welcome-letters/${l.id}/pdf?inline=1`}
                      target="_blank"
                      rel="noopener"
                      className="text-primary underline"
                    >
                      {t('opsLetters.preview')}
                      <span className="sr-only"> ({l.version})</span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Section>
  );
}
