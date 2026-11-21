import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { HAS_FIREBASE } from '@/lib/config';
import { t } from '@/lib/i18n';
import { permission, requestPermission, type PushPermission } from '@/lib/push';
import { type as typeScale, useTheme } from '@/theme/tokens';
import { Banner, Button } from './ui';

/**
 * The persistent warning when alerts cannot reach this owner by push (owner decision 2026-11-21):
 * notifications switched off on the phone, or no device registered with the API (`pushReady` from
 * GET /v1/app/alerts). Alerts are push only now, so without it the first sign is the SMS after 30
 * minutes. Shown on Start, Warnungen and „Benachrichtigungen“ until it is fixed; never asks for the
 * permission by itself (P6), only on the button.
 */
export function PushOffBanner({
  pushReady,
  onChanged,
}: {
  /** false = no device registered for push; undefined = not known yet (no warning). */
  pushReady: boolean | undefined;
  onChanged?: () => void | Promise<void>;
}) {
  const c = useTheme();
  const [perm, setPerm] = useState<PushPermission | null>(null);
  useEffect(() => {
    void permission()
      .then(setPerm)
      .catch(() => setPerm(null));
  }, [pushReady]);

  if (!(pushReady === false || perm === 'denied')) return null;
  const allow = async () => {
    const p = await requestPermission().catch(() => 'undetermined' as const);
    setPerm(p);
    if (p === 'granted') await onChanged?.();
  };
  return (
    <Banner tone="warn" testID="push-off">
      <View style={{ gap: 10 }}>
        <Text style={[typeScale.body, { color: c.warningFg, fontWeight: '700' }]}>
          {t('pushOffWarning')}
        </Text>
        {HAS_FIREBASE && perm === 'undetermined' && (
          <Button label={t('pushTitle')} onPress={() => void allow()} testID="push-allow" />
        )}
        {perm === 'denied' && (
          <Button
            label={t('pushOpenSettings')}
            variant="secondary"
            onPress={() => void Linking.openSettings()}
            testID="push-settings"
          />
        )}
      </View>
    </Banner>
  );
}
