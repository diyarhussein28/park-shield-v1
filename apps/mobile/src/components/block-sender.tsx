import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/portal';
import { space, touch, type as typeScale, useTheme } from '@/theme/tokens';
import { Icon, type IconName } from './icons';
import { Banner, Button } from './ui';

/** POST /v1/app/alerts/:id/block (apps/api/src/history/history.service.ts `block`). */
export interface BlockResult {
  blocked: boolean;
  chatClosed: boolean;
  phoneBanned: boolean;
  protectedMode: boolean;
  senderBlocked: boolean;
  blockedUntil: string | null;
}

/** POST /v1/app/alerts/:id/unblock-sender (`HistoryService.unblock`). */
export interface UnblockResult {
  unblocked: boolean;
  senderBlocked: boolean;
  blockedUntil: string | null;
}

/** „noch 12 Tage“ for a block with an end date; nothing without one. */
export function blockLeft(until: string | null): string | null {
  if (!until) return null;
  const days = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 86_400_000));
  return t('senderBlockedLeft', { days });
}

/** „Absender blockiert · noch 30 Tage“ */
export const blockedText = (until: string | null) =>
  [t('senderBlocked'), blockLeft(until)].filter(Boolean).join(' · ');

/** A text button with a leading icon, ≥ 44 pt high (the alert card's footer action). */
function LinkAction({
  icon,
  label,
  onPress,
  busy,
  testID,
  tone = 'primary',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  busy?: boolean;
  testID?: string;
  tone?: 'primary' | 'muted';
}) {
  const c = useTheme();
  const color = tone === 'muted' ? c.muted : c.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(busy), disabled: Boolean(busy) }}
      disabled={busy}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [s.link, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
    >
      <Icon name={icon} size={22} color={color} />
      <Text style={[typeScale.body, s.linkText, { color }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * „Absender blockieren“ (Stage 3, 2026-11-21): asks first and says exactly what happens, then blocks
 * through the API: the live chat ends at once (the person at the vehicle sees „Der Chat wurde
 * beendet.“), the reminder and the SMS for this alert are cancelled, and the existing abuse module
 * blocks further alerts from this sender to the vehicle (server-side only: no identifier or storage
 * on any device). Not offered for test alerts. `variant="link"` is the alert card's footer action.
 */
export function BlockSenderButton({
  alertId,
  onBlocked,
  variant = 'secondary',
  testID = 'block-sender',
}: {
  alertId: string;
  onBlocked: (r: BlockResult) => void | Promise<void>;
  variant?: 'secondary' | 'ghost' | 'link';
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
      {variant === 'link' ? (
        <LinkAction
          icon="ban"
          label={t('blockSender')}
          onPress={confirm}
          busy={busy}
          testID={testID}
        />
      ) : (
        <Button
          label={t('blockSender')}
          variant={variant}
          busy={busy}
          onPress={confirm}
          testID={testID}
        />
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </>
  );
}

/**
 * „Blockierung aufheben“ (2026-11-22), wherever a block is shown: asks first, then ends the owner's
 * block of this sender on the server (audited). The sender can send alerts again; a chat the block
 * ended stays closed.
 */
export function UnblockSenderButton({
  alertId,
  onUnblocked,
  variant = 'secondary',
  testID = 'unblock-sender',
}: {
  alertId: string;
  onUnblocked: (r: UnblockResult) => void | Promise<void>;
  variant?: 'secondary' | 'link';
  testID?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unblock = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<UnblockResult>(`/v1/app/alerts/${alertId}/unblock-sender`, { body: {} });
      await onUnblocked(r);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () =>
    Alert.alert(t('unblockConfirmTitle'), t('unblockConfirmText'), [
      { text: t('lockCancel'), style: 'cancel' },
      { text: t('unblockButton'), onPress: () => void unblock() },
    ]);

  return (
    <>
      {variant === 'link' ? (
        <LinkAction
          icon="unlock"
          label={t('unblockSender')}
          onPress={confirm}
          busy={busy}
          testID={testID}
        />
      ) : (
        <Button
          label={t('unblockSender')}
          variant="secondary"
          busy={busy}
          onPress={confirm}
          testID={testID}
        />
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </>
  );
}

/** The blocked state: ban icon + „Absender blockiert · noch 30 Tage“ (read as one label). */
export function SenderBlockedStatus({ until }: { until: string | null }) {
  const c = useTheme();
  const text = blockedText(until);
  return (
    <View
      accessible
      accessibilityLabel={text}
      testID="sender-blocked"
      style={[s.link, { minHeight: undefined }]}
    >
      <Icon name="ban" size={20} color={c.muted} />
      <Text style={[typeScale.label, { color: c.muted, fontWeight: '600', flexShrink: 1 }]}>
        {text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.min,
    alignSelf: 'flex-start',
  },
  linkText: { fontWeight: '700' },
});
