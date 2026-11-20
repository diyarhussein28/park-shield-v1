import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius, space, touch, type as typeScale, useTheme } from '@/theme/tokens';
import { Illustration, type IllustrationName } from './illustration';

export { useTheme, type Theme } from '@/theme/tokens';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = useTheme();
  const body = <View style={s.screenBody}>{children}</View>;
  return (
    <SafeAreaView style={[s.screen, { backgroundColor: c.bg }]} edges={['bottom', 'left', 'right']}>
      {scroll ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={s.scroll}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={[typeScale.title, { color: c.fg }]}>
      {children}
    </Text>
  );
}

export function P({
  children,
  muted,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: object;
}) {
  const c = useTheme();
  return <Text style={[typeScale.body, { color: muted ? c.muted : c.fg }, style]}>{children}</Text>;
}

/** Primary · secondary · ghost · danger; 52 pt high, `lg` 56 pt (the alert's „Ich komme“). */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  busy,
  disabled,
  accessibilityHint,
  testID,
}: {
  label: string;
  onPress: PressableProps['onPress'];
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  busy?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  testID?: string;
}) {
  const c = useTheme();
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? c.danger : 'transparent';
  const fg = variant === 'primary' ? c.primaryFg : variant === 'danger' ? c.dangerFg : c.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          minHeight: size === 'lg' ? touch.primaryAction : touch.button,
          backgroundColor: bg,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        variant === 'secondary' && { borderWidth: 2, borderColor: c.primary },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text
          style={[typeScale.body, s.buttonText, { color: fg }, size === 'lg' && { fontSize: 19 }]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Banner({
  tone = 'info',
  children,
  style,
  testID,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'err';
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const c = useTheme();
  const [bg, fg] = {
    info: [c.infoBg, c.infoFg],
    ok: [c.successBg, c.successFg],
    warn: [c.warningBg, c.warningFg],
    err: [c.dangerBg, c.dangerText],
  }[tone];
  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'err' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      style={[s.banner, { backgroundColor: bg }, style]}
    >
      {typeof children === 'string' ? (
        <Text style={[typeScale.body, { color: fg }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

/** Surface, 1 px border, radius 16, padding 16, a whisper of shadow (the website's card). */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return (
    <View style={[s.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>
      {children}
    </View>
  );
}

/** A card with a header and an optional one-line intro. */
export function Section({
  title,
  intro,
  children,
  style,
}: {
  title: string;
  intro?: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <Card style={style}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: c.fg }]}>
        {title}
      </Text>
      {intro ? (
        <Text style={[typeScale.label, { color: c.muted, fontWeight: '400' }]}>{intro}</Text>
      ) : null}
      {children}
    </Card>
  );
}

/** Small status pill. */
export function Chip({
  children,
  tone = 'info',
}: {
  children: string;
  tone?: 'info' | 'ok' | 'warn' | 'urgent' | 'neutral';
}) {
  const c = useTheme();
  const [bg, fg] = {
    info: [c.infoBg, c.infoFg],
    ok: [c.successBg, c.successFg],
    warn: [c.warningBg, c.warningFg],
    urgent: [c.dangerBg, c.dangerText],
    neutral: [c.secondary, c.secondaryFg],
  }[tone];
  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[typeScale.caption, { color: fg, fontWeight: '700' }]}>{children}</Text>
    </View>
  );
}

/** Friendly empty state: illustration slot, title, one sentence, one action. */
export function EmptyState({
  illustration,
  title,
  text,
  action,
}: {
  illustration: IllustrationName;
  title: string;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const c = useTheme();
  return (
    <View style={s.empty}>
      <Illustration name={illustration} />
      <Text
        accessibilityRole="header"
        style={[typeScale.heading, { color: c.fg, textAlign: 'center' }]}
      >
        {title}
      </Text>
      <Text style={[typeScale.body, { color: c.muted, textAlign: 'center' }]}>{text}</Text>
      {action && <Button label={action.label} variant="secondary" onPress={action.onPress} />}
    </View>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const c = useTheme();
  const now = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now }}
      style={[s.bar, { backgroundColor: c.secondary }]}
    >
      <View style={[s.barFill, { width: `${now}%`, backgroundColor: c.primary }]} />
    </View>
  );
}

export function Loading() {
  const c = useTheme();
  return (
    <View style={[s.center, { backgroundColor: c.bg }]} accessibilityLabel="…">
      <ActivityIndicator color={c.primary} size="large" />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1 },
  screenBody: { flex: 1, padding: space.lg, gap: space.md },
  button: {
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontWeight: '700', textAlign: 'center' },
  banner: { borderRadius: radius.md, padding: space.md + 2, gap: space.sm },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    gap: space.sm,
    ...Platform.select({
      ios: {
        shadowColor: '#0f172a',
        shadowOpacity: 0.05,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 1 },
      default: {},
    }),
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  empty: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xxl,
    paddingHorizontal: space.lg,
  },
  bar: { height: 10, borderRadius: radius.pill, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.pill },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
});
