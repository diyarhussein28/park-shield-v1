import { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/portal';
import { Banner, Button } from './ui';

/** POST /v1/app/alerts/:id/block (apps/api/src/history/history.service.ts `block`). */
export interface BlockResult {
  blocked: boolean;
  chatClosed: boolean;
  phoneBanned: boolean;
  protectedMode: boolean;
}

/**
 * „Absender blockieren“ (Stage 3, 2026-11-21): asks first and says exactly what happens, then blocks
 * through the API: the live chat ends at once (the person at the vehicle sees „Der Chat wurde
 * beendet.“), the reminder and the SMS for this alert are cancelled, and the existing abuse module
 * blocks further alerts from this sender to the vehicle (server-side only: no identifier or storage
 * on any device). Not offered for test alerts.
 */
export function BlockSenderButton({
  alertId,
  onBlocked,
  variant = 'secondary',
  testID = 'block-sender',
}: {
  alertId: string;
  onBlocked: (r: BlockResult) => void | Promise<void>;
  variant?: 'secondary' | 'ghost';
  testID?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const block = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<BlockResult>(`/v1/app/alerts/${alertId}/block`, { body: {} });
      await onBlocked(r);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () =>
    Alert.alert(
      t('blockConfirmTitle'),
      [t('blockConfirm1'), t('blockConfirm2'), t('blockConfirm3')].map((l) => `• ${l}`).join('\n'),
      [
        { text: t('lockCancel'), style: 'cancel' },
        { text: t('blockButton'), style: 'destructive', onPress: () => void block() },
      ],
    );

  return (
    <>
      <Button
        label={t('blockSender')}
        variant={variant}
        busy={busy}
        onPress={confirm}
        testID={testID}
      />
      {error && <Banner tone="err">{error}</Banner>}
    </>
  );
}
