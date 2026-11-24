'use client';

import { Button, Field, Input, Notice, useI18n } from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { OpsApiError, opsApi } from '@/lib/api';

/**
 * „Neuen Code trotz Wartezeit ausstellen“ (2026-11-24, permission `codes.override_cooldown`): a
 * support case such as a stolen decal. The API revokes the active code, issues a free one with the
 * same design and audits the reason (`qr_code.replaced`).
 */
export function OverrideNewCode({ vehicleId, nickname }: { vehicleId: string; nickname: string }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await opsApi<{ codeHint: string }>(`/ops/v1/vehicles/${vehicleId}/new-code`, {
        body: { reason },
      });
      setMsg({ tone: 'success', text: t('opsCustomers.overrideDone', { hint: r.codeHint }) });
      setReason('');
      window.location.reload();
    } catch (err) {
      setMsg({
        tone: 'danger',
        text:
          err instanceof OpsApiError && err.body?.error === 'subscription_required'
            ? t('opsCustomers.overrideNoSubscription')
            : t('ops.error'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-2 text-sm">
      <summary className="min-h-12 cursor-pointer content-center font-semibold">
        {t('opsCustomers.overrideTitle')} („{nickname}“)
      </summary>
      <form onSubmit={submit} className="mt-2 flex flex-col gap-3">
        <p className="text-muted">{t('opsCustomers.overrideHint')}</p>
        <Field label={t('opsCustomers.overrideReason')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              maxLength={200}
              required
            />
          )}
        </Field>
        <Button type="submit" busy={busy} className="w-fit">
          {t('opsCustomers.overrideButton')}
        </Button>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </form>
    </details>
  );
}
