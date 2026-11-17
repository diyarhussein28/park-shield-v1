'use client';

import { Button, Notice, Text, useI18n } from '@parkshield/ui';
import { useState } from 'react';
import { Section } from '@/components/konto-shell';
import { api, errorText } from '@/lib/api-client';
import type { VehicleProtection } from '@/lib/api-server';

/**
 * Abuse protection §4: Protected Mode per vehicle. Alerts always arrive; only the free text of senders
 * without a confirmed mobile number waits behind "Anzeigen" in the history.
 */
export function ProtectionCard({
  vehicleId,
  initial,
}: {
  vehicleId: string;
  initial: VehicleProtection;
}) {
  const { t } = useI18n();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(active: boolean) {
    setBusy(true);
    setError(null);
    try {
      setState(
        await api<VehicleProtection>(`/v1/vehicles/${vehicleId}/protection`, {
          method: 'PUT',
          body: { active },
        }),
      );
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('protectedMode.title')} icon="shield" intro={t('protectedMode.intro')}>
      <div role="status">
        {state.active ? (
          <Notice tone="info">
            {state.activeUntil
              ? t(
                  state.source === 'auto'
                    ? 'protectedMode.activeAuto'
                    : 'protectedMode.activeUntil',
                  {
                    until: new Date(state.activeUntil),
                  },
                )
              : t('protectedMode.activeManual')}
          </Notice>
        ) : (
          <Text muted>{t('protectedMode.off')}</Text>
        )}
      </div>
      <Button
        variant={state.active ? 'secondary' : 'primary'}
        busy={busy}
        className="w-fit"
        onClick={() => toggle(!state.active)}
      >
        {state.active ? t('protectedMode.turnOff') : t('protectedMode.turnOn')}
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </Section>
  );
}
