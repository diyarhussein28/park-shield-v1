'use client';

import { Button, Card, Field, Heading, Notice, Select, Stack, Text, useI18n } from '@parkshield/ui';
import { clsx } from 'clsx';
import { useState } from 'react';
import { api, errorText } from '@/lib/api-client';
import type { VehicleMode, VehicleModeKind } from '@/lib/api-server';

const MODES: VehicleModeKind[] = ['sensitive_spot', 'short_stop'];
const DURATIONS = [30, 60, 120, 240, 480, 720];

/** OW-17 / US-26: "sensitive spot" (urgent only) or "short stop" (return time shown), up to 12 h. */
export function ModeCard({
  vehicleId,
  initial,
}: {
  vehicleId: string;
  initial: VehicleMode | null;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(initial);
  const [mode, setMode] = useState<VehicleModeKind>('short_stop');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ mode: VehicleMode | null }>(`/v1/vehicles/${vehicleId}/mode`, {
        body: { mode, minutes },
      });
      setActive(r.mode);
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    try {
      await api(`/v1/vehicles/${vehicleId}/mode`, { method: 'DELETE' });
      setActive(null);
      setMessage({ tone: 'success', text: t('modes.ended') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('modes.title')}
        </Heading>
        <Text>{t('modes.intro')}</Text>
        {active ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Notice tone="info">
              {t('modes.active', {
                mode: t(`modes.${active.mode}`),
                until: new Date(active.endsAt),
              })}
            </Notice>
            <Button variant="secondary" busy={busy} onClick={end}>
              {t('modes.end')}
            </Button>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{t('modes.title')}</legend>
              {MODES.map((m) => (
                <label
                  key={m}
                  className={clsx(
                    'flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3',
                    m === mode ? 'border-primary bg-info-bg text-info-fg' : 'border-border-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="mode"
                    value={m}
                    checked={m === mode}
                    onChange={() => setMode(m)}
                    className="mt-1 size-5"
                  />
                  <span>
                    <span className="block font-semibold">{t(`modes.${m}`)}</span>
                    <span className="block text-sm">{t(`modes.${m}Hint`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field label={t('modes.duration')}>
              {({ id }) => (
                <Select
                  id={id}
                  className="max-w-xs"
                  value={String(minutes)}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {t('modes.minutes', { minutes: d, hours: d / 60 })}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button busy={busy} onClick={start} className="w-fit">
              {t('modes.start')}
            </Button>
          </>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </Stack>
    </Card>
  );
}
