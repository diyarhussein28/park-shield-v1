import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OnboardingArt } from '@/components/art';
import { useReducedMotion } from '@/components/celebration';
import { LogoMark, Wordmark } from '@/components/icons';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { setFlag } from '@/lib/prefs';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';

const SCENES = [1, 2, 3] as const;

/**
 * First launch (§5.2): three short scenes with the decal idea, skippable, page dots, then
 * „Los geht’s“ (new account) or „Ich habe schon ein Konto“ (sign in).
 */
export default function Welcome() {
  const c = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const pager = useRef<ScrollViewInstance>(null);
  const [page, setPage] = useState(0);
  const last = page === SCENES.length - 1;

  const go = (i: number) => {
    pager.current?.scrollTo({ x: i * width, animated: !reduced });
    setPage(i);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)));
  const leave = async (to: '/registrieren' | '/anmelden') => {
    await setFlag('onboarded', true);
    router.replace(to);
  };

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
      <View style={s.top}>
        <View style={s.brand} accessible accessibilityLabel="ParkShield">
          <LogoMark size={28} />
          <Wordmark size={20} maxScale={1.3} />
        </View>
        {!last && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('obSkip')}
            onPress={() => go(SCENES.length - 1)}
            style={s.skip}
            hitSlop={8}
          >
            <Text style={[typeScale.label, { color: c.primary }]}>{t('obSkip')}</Text>
          </Pressable>
        )}
      </View>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={s.flex}
      >
        {SCENES.map((n) => (
          <View
            key={n}
            style={[s.page, { width }]}
            accessibilityElementsHidden={page !== n - 1}
            importantForAccessibility={page === n - 1 ? 'auto' : 'no-hide-descendants'}
          >
            <OnboardingArt scene={n} width={Math.min(300, width - 48)} />
            <Text accessibilityRole="header" style={[typeScale.display, s.center, { color: c.fg }]}>
              {t(`ob${n}Title`)}
            </Text>
            <Text style={[typeScale.body, s.center, { color: c.muted }]}>{t(`ob${n}Text`)}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={s.bottom}>
        <View
          style={s.dots}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('obPage', { n: page + 1 })}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') go(Math.min(page + 1, 2));
            if (e.nativeEvent.actionName === 'decrement') go(Math.max(page - 1, 0));
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        >
          {SCENES.map((n, i) => (
            <View
              key={n}
              style={[
                s.dot,
                { backgroundColor: i === page ? c.primary : c.border, width: i === page ? 22 : 8 },
              ]}
            />
          ))}
        </View>
        {last ? (
          <>
            <Button
              label={t('obStart')}
              onPress={() => void leave('/registrieren')}
              testID="ob-start"
            />
            <Button
              label={t('obHaveAccount')}
              variant="ghost"
              onPress={() => void leave('/anmelden')}
              testID="ob-signin"
            />
          </>
        ) : (
          <Button label={t('obNext')} onPress={() => go(page + 1)} testID="ob-next" />
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    minHeight: 48,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  page: {
    paddingHorizontal: space.xxl,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.lg,
  },
  center: { textAlign: 'center' },
  bottom: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    minHeight: 24,
    alignItems: 'center',
    borderRadius: radius.pill,
  },
  dot: { height: 8, borderRadius: radius.pill },
});
