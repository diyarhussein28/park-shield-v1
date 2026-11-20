import { Children, isValidElement, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { radius, space, type as typeScale, useTheme } from '@/theme/tokens';
import { Icon, type IconName } from './icons';

/**
 * An iOS-style grouped list: an optional header, rows in one rounded group separated by hairlines,
 * an optional footer note (P12).
 */
export function Group({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  const c = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={s.group}>
      {title ? (
        <Text
          accessibilityRole="header"
          style={[typeScale.caption, s.groupTitle, { color: c.muted }]}
        >
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={[s.groupBody, { backgroundColor: c.surface, borderColor: c.border }]}>
        {rows.map((row, i) => (
          <View key={row.key ?? i}>
            {i > 0 && <View style={[s.separator, { backgroundColor: c.border }]} />}
            {row}
          </View>
        ))}
      </View>
      {footer ? (
        <Text style={[typeScale.caption, s.groupFooter, { color: c.muted }]}>{footer}</Text>
      ) : null}
    </View>
  );
}

function RowIcon({ icon, tone }: { icon: IconName; tone: 'primary' | 'accent' | 'danger' }) {
  const c = useTheme();
  const [bg, fg] = {
    primary: [c.infoBg, c.primary],
    accent: [c.accentSubtle, c.accentSubtleFg],
    danger: [c.dangerBg, c.urgent],
  }[tone];
  return (
    <View style={[s.icon, { backgroundColor: bg }]}>
      <Icon name={icon} size={18} color={fg} />
    </View>
  );
}

/** A row that opens a screen: icon, title, optional detail on the right or below, chevron. */
export function Row({
  icon,
  iconTone = 'primary',
  title,
  detail,
  subtitle,
  onPress,
  destructive,
  testID,
}: {
  icon?: IconName;
  iconTone?: 'primary' | 'accent' | 'danger';
  title: string;
  detail?: string;
  subtitle?: string;
  onPress: () => void;
  /** Sign-out style: red text, no icon box, no chevron. */
  destructive?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, detail, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [s.row, { backgroundColor: pressed ? c.secondary : 'transparent' }]}
    >
      {icon && !destructive && <RowIcon icon={icon} tone={iconTone} />}
      <View style={s.text}>
        <Text
          style={[
            typeScale.body,
            { color: destructive ? c.urgent : c.fg, fontWeight: destructive ? '600' : '500' },
            destructive && { textAlign: 'center' },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typeScale.caption, { color: c.muted, fontWeight: '400' }]}>{subtitle}</Text>
        ) : null}
      </View>
      {detail ? (
        <Text numberOfLines={1} style={[typeScale.label, s.detail, { color: c.muted }]}>
          {detail}
        </Text>
      ) : null}
      {!destructive && <Icon name="chevronRight" size={18} color={c.muted} />}
    </Pressable>
  );
}

/** A native on/off switch with its label (P14): the whole row toggles. */
export function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
  disabled,
  testID,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessible={false}
      onPress={() => !disabled && onChange(!value)}
      style={[s.row, disabled && { opacity: 0.55 }]}
    >
      {icon && <RowIcon icon={icon} tone="primary" />}
      <View style={s.text}>
        <Text style={[typeScale.body, { color: c.fg, fontWeight: '500' }]}>{title}</Text>
        {subtitle ? (
          <Text style={[typeScale.caption, { color: c.muted, fontWeight: '400' }]}>{subtitle}</Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: c.primary, false: c.secondary }}
        ios_backgroundColor={c.secondary}
      />
    </Pressable>
  );
}

/** „Details“: long legal or how-to text folded away, one tap to open (P7, P10). */
export function Collapsible({
  title,
  children,
  initiallyOpen = false,
  testID,
}: {
  title: string;
  children: ReactNode;
  initiallyOpen?: boolean;
  testID?: string;
}) {
  const c = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={[s.collapsible, { borderColor: c.border }]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        onPress={() => setOpen((o) => !o)}
        style={s.collapsibleHead}
      >
        <Text style={[typeScale.label, { color: c.primary, flex: 1 }]}>{title}</Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={18} color={c.primary} />
        </View>
      </Pressable>
      {open && <View style={s.collapsibleBody}>{children}</View>}
    </View>
  );
}

/** Thin progress bar with „Schritt 2 von 4“ for the sign-up steps. */
export function StepProgress({
  step,
  total,
  label,
}: {
  step: number;
  total: number;
  label: string;
}) {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 1, max: total, now: step }}
      style={s.progress}
    >
      <Text style={[typeScale.caption, { color: c.muted }]}>{label}</Text>
      <View style={s.progressTrack}>
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            style={[s.progressDash, { backgroundColor: i < step ? c.primary : c.secondary }]}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  group: { gap: space.xs + 2 },
  groupTitle: { paddingHorizontal: space.lg, letterSpacing: 0.6 },
  groupFooter: { paddingHorizontal: space.lg },
  groupBody: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: space.lg + 30 + space.md },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  detail: { maxWidth: '45%', fontWeight: '400' },
  collapsible: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.xs },
  collapsibleHead: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  collapsibleBody: { gap: space.sm, paddingBottom: space.sm },
  progress: { gap: space.xs },
  progressTrack: { flexDirection: 'row', gap: 6 },
  progressDash: { flex: 1, height: 5, borderRadius: radius.pill },
});
