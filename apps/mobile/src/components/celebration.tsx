import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { space, type as typeScale, useTheme } from '@/theme/tokens';

/** True when the system asks for less motion (iOS „Bewegung reduzieren“, Android „Animationen entfernen“). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => live && setReduced(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * A short success moment (P8): a yellow badge with a check pops in once (under half a second, no
 * sound, no loop), then the headline. With reduced motion it simply appears.
 */
export function Celebration({ title, text }: { title: string; text?: string }) {
  const c = useTheme();
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(reduced ? 1 : 0.4)).current;
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      scale.setValue(1);
      opacity.setValue(1);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [reduced, scale, opacity]);

  return (
    <View style={s.wrap} accessibilityLiveRegion="polite">
      <Animated.View
        testID="celebration-badge"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ transform: [{ scale }], opacity }}
      >
        <Svg width={112} height={112} viewBox="0 0 112 112">
          <Circle cx={56} cy={56} r={54} fill={c.accentSubtle} />
          <Circle cx={56} cy={56} r={40} fill={c.accent} />
          <Path
            d="M38 57l12 12 25-27"
            stroke={c.accentFg}
            strokeWidth={8}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>
      <Text accessibilityRole="header" style={[typeScale.display, s.center, { color: c.fg }]}>
        {title}
      </Text>
      {text ? <Text style={[typeScale.body, s.center, { color: c.muted }]}>{text}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.lg, paddingVertical: space.xl },
  center: { textAlign: 'center' },
});
