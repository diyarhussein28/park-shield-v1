import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { biometricInfo, biometricName, type BiometricKind } from '@/lib/biometrics';
import { t } from '@/lib/i18n';
import { useLock } from '@/lib/lock';
import { space, type as typeScale, useTheme } from '@/theme/tokens';
import { LogoMark, Wordmark } from './icons';
import { Banner, Button } from './ui';

/**
 * Covers the app while it is locked (§6): branded, one „Entsperren“ button; asks for Face ID once by
 * itself when it appears. The device passcode is the fallback inside the system prompt.
 */
export function LockScreen() {
  const c = useTheme();
  const { unlock } = useLock();
  const [kind, setKind] = useState<BiometricKind>('deviceCode');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  const tryUnlock = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await unlock();
    setBusy(false);
    if (!ok) setFailed(true);
  };

  useEffect(() => {
    void biometricInfo().then((i) => setKind(i.kind));
    // Asks once by itself, a moment after appearing (a notification tap may still open its alert).
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!asked.current) {
      asked.current = true;
      timer = setTimeout(() => void tryUnlock(), 400);
    }
    return () => clearTimeout(timer);
    // Once, when the lock appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const method = biometricName(kind);
  return (
    <SafeAreaView
      testID="lock-screen"
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, s.screen, { backgroundColor: c.bg }]}
    >
      <View style={s.body}>
        <View accessible accessibilityLabel="ParkShield" style={s.brand}>
          <LogoMark size={88} />
          <Wordmark size={28} />
        </View>
        <Text accessibilityRole="header" style={[typeScale.title, s.center, { color: c.fg }]}>
          {t('lockTitle')}
        </Text>
        <Text style={[typeScale.body, s.center, { color: c.muted }]}>
          {t('lockText', { method })}
        </Text>
      </View>
      <View style={s.actions}>
        {failed && <Banner tone="warn">{t('lockFailed')}</Banner>}
        <Button
          label={t('lockButton')}
          onPress={() => void tryUnlock()}
          busy={busy}
          testID="unlock"
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { zIndex: 100, justifyContent: 'space-between' },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xxl,
  },
  brand: { alignItems: 'center', gap: space.sm },
  center: { textAlign: 'center' },
  actions: { padding: space.lg, gap: space.sm },
});
