import { lifetimeCheaperFromYear, yearlyTotalCents } from '@parkshield/shared/plans';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { lang, t } from '@/lib/i18n';
import { euro } from '@/lib/portal';
import { radius, space, touch, type as typeScale, useTheme } from '@/theme/tokens';
import { useReducedMotion } from './celebration';
import { Icon } from './icons';

/** „10 €“ for a whole amount, else „10,50 €“. */
const wholeEuro = (cents: number, locale: string) =>
  cents % 100 === 0
    ? new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'de-DE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
      }).format(cents / 100)
    : euro(cents, locale);

/**
 * The honest numbers next to the lifetime button (owner decision 2026-11-26): how much more than one
 * year, from which year it is cheaper, and what it saves over five years. Pure, unit-tested.
 */
export function lifetimeFacts(yearCents: number, lifetimeCents: number, locale = lang()) {
  return {
    diff: wholeEuro(Math.max(0, lifetimeCents - yearCents), locale),
    year: lifetimeCheaperFromYear(yearCents, lifetimeCents),
    saved: euro(Math.max(0, yearlyTotalCents(5, yearCents) - lifetimeCents), locale),
  };
}

/** A light band sweeps over the button a few times, then stops (WCAG 2.2.2: under 5 seconds). */
function useShine(reduced: boolean, width: number) {
  const [x] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(reduced ? 1 : 0.96));
  useEffect(() => {
    if (reduced || width === 0) return;
    const sweep = Animated.timing(x, {
      toValue: 1,
      duration: 900,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    const anim = Animated.parallel([
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(400),
        Animated.loop(Animated.sequence([sweep, Animated.delay(500)]), {
          iterations: 3,
          resetBeforeIteration: true,
        }),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
  }, [reduced, width, x, pop]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-80, width + 80] });
  return { translateX, pop };
}

/**
 * The lifetime offer inside the plan card, right under the yearly „Zahlungspflichtig bestellen“ (owner
 * decisions 2026-11-26 and 2026-11-28, like the website's pricing card): „oder“, then one outlined button
 * in the accent yellow with a short shine, the small label „Nur 10 € mehr – dafür für immer“ above the
 * § 312j text („Zahlungspflichtig bestellen – 29,99 € einmalig“), and one true line under it (cheaper
 * from the 2nd year, nothing to cancel). No timer, no false scarcity, no shaming „no“.
 */
export function LifetimeOffer({
  price,
  yearCents,
  lifetimeCents,
  onPress,
  busy,
  disabled,
}: {
  /** The price string the customer pays (the store's own when the store sells it). */
  price: string;
  yearCents: number;
  lifetimeCents: number;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const c = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const { translateX, pop } = useShine(reduced, width);
  const facts = lifetimeFacts(yearCents, lifetimeCents);
  const label = t('lifetimePayButton', { price });
  const badge = t('lifetimeBadge', { diff: facts.diff });
  return (
    <View style={s.wrap} testID="lifetime-offer">
      <View style={s.or} importantForAccessibility="no-hide-descendants">
        <View style={[s.rule, { backgroundColor: c.border }]} />
        <Text style={[typeScale.caption, { color: c.muted }]}>{t('lifetimeOr')}</Text>
        <View style={[s.rule, { backgroundColor: c.border }]} />
      </View>
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <Pressable
          testID="pay-lifetime"
          accessibilityRole="button"
          accessibilityLabel={`${badge}. ${label}`}
          accessibilityHint={t('lifetimeNoRenew')}
          accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
          disabled={disabled || busy}
          onPress={onPress}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          style={({ pressed }) => [
            s.button,
            {
              backgroundColor: c.accentSubtle,
              borderColor: c.accent,
              opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {!reduced && !disabled && (
            <Animated.View
              pointerEvents="none"
              style={[s.shine, { transform: [{ translateX }, { skewX: '-20deg' }] }]}
            />
          )}
          {busy ? (
            <ActivityIndicator color={c.accentSubtleFg} />
          ) : (
            <>
              <Text style={[typeScale.caption, s.badge, { color: c.accentSubtleFg }]}>{badge}</Text>
              <View style={s.labelRow}>
                <Text style={[typeScale.body, s.buttonText, { color: c.accentSubtleFg }]}>
                  {label}
                </Text>
                <Icon name="arrowRight" size={18} color={c.accentSubtleFg} />
              </View>
            </>
          )}
        </Pressable>
      </Animated.View>
      <Text style={[typeScale.caption, { color: c.muted, textAlign: 'center' }]}>
        {t('lifetimeLine', { year: facts.year })}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space.sm },
  or: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  button: {
    minHeight: touch.button + 8,
    borderWidth: 2,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 2,
    overflow: 'hidden',
  },
  badge: { fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  buttonText: { fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  shine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 48,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
