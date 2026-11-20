import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { type, useTheme } from '@/theme/tokens';
import { Icon, type IconName } from './icons';
import { Chip } from './ui';

/** Label above the input, optional hint below, error in red (the website's Field). */
export function Field({
  label,
  hint,
  error,
  optional,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null; optional?: string }) {
  const c = useTheme();
  return (
    <View style={s.field}>
      <Text style={[s.label, { color: c.fg }]}>
        {label}
        {optional ? <Text style={{ color: c.muted, fontWeight: '400' }}> ({optional})</Text> : null}
      </Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={c.muted}
        style={[
          s.input,
          { color: c.fg, borderColor: error ? c.urgent : c.borderStrong, backgroundColor: c.bg },
          input.multiline && s.multiline,
        ]}
        {...input}
      />
      {hint ? <Text style={[s.hint, { color: c.muted }]}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={[s.hint, { color: c.urgent, fontWeight: '700' }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** A single choice (the website's radio groups and selects), large touch targets. */
export function Choice<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  label,
  hint,
}: {
  legend?: string;
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  label: (v: T) => string;
  hint?: (v: T) => string | undefined;
}) {
  const c = useTheme();
  return (
    <View style={s.field} accessibilityRole="radiogroup" accessibilityLabel={legend}>
      {legend ? <Text style={[s.label, { color: c.fg }]}>{legend}</Text> : null}
      {options.map((o) => {
        const on = o === value;
        const h = hint?.(o);
        return (
          <Pressable
            key={String(o)}
            accessibilityRole="radio"
            accessibilityLabel={label(o)}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o)}
            style={[
              s.option,
              {
                borderColor: on ? c.primary : c.borderStrong,
                backgroundColor: on ? c.infoBg : c.bg,
              },
            ]}
          >
            <View style={[s.radio, { borderColor: on ? c.primary : c.muted }]}>
              {on && <View style={[s.radioDot, { backgroundColor: c.primary }]} />}
            </View>
            <View style={s.optionText}>
              <Text style={{ color: on ? c.infoFg : c.fg, fontSize: 17, fontWeight: '600' }}>
                {label(o)}
              </Text>
              {h ? <Text style={{ color: on ? c.infoFg : c.muted, fontSize: 15 }}>{h}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A checkbox with its text (consent, quiet-hour days, „Ich habe … geprüft“). */
export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={s.check}
    >
      <View
        style={[
          s.box,
          {
            borderColor: checked ? c.primary : c.muted,
            backgroundColor: checked ? c.primary : c.bg,
          },
        ]}
      >
        {checked && <Text style={{ color: c.primaryFg, fontWeight: '900' }}>✓</Text>}
      </View>
      <Text style={[s.checkText, { color: c.fg }]}>{label}</Text>
    </Pressable>
  );
}

/** A row that opens another screen (the portal's navigation and quick links). */
export function ListRow({
  icon,
  title,
  text,
  onPress,
  badge,
}: {
  icon?: IconName;
  title: string;
  text?: string;
  onPress: () => void;
  badge?: ReactNode;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text ? `${title}, ${text}` : title}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { backgroundColor: c.surface, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {icon && (
        <View style={[s.rowIcon, { backgroundColor: c.infoBg }]}>
          <Icon name={icon} size={20} color={c.primary} />
        </View>
      )}
      <View style={s.optionText}>
        <Text style={[type.body, { color: c.fg, fontWeight: '700' }]}>{title}</Text>
        {text ? (
          <Text style={[type.label, { color: c.muted, fontWeight: '400' }]}>{text}</Text>
        ) : null}
      </View>
      {badge}
      <Icon name="arrowRight" size={20} color={c.muted} />
    </Pressable>
  );
}

/** Two or three short options side by side (e-mail language, plan period …). */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  label,
}: {
  legend: string;
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  label: (v: T) => string;
}) {
  const c = useTheme();
  return (
    <View style={s.field}>
      <Text style={[s.label, { color: c.fg }]}>{legend}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={legend}
        style={[s.segments, { backgroundColor: c.secondary }]}
      >
        {options.map((o) => {
          const on = o === value;
          return (
            <Pressable
              key={o}
              accessibilityRole="radio"
              accessibilityLabel={label(o)}
              accessibilityState={{ checked: on }}
              onPress={() => onChange(o)}
              style={[
                s.segment,
                on && { backgroundColor: c.bg, borderColor: c.primary, borderWidth: 2 },
              ]}
            >
              <Text style={[type.label, { color: on ? c.primary : c.fg, textAlign: 'center' }]}>
                {label(o)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function H3({ children }: { children: ReactNode }) {
  const c = useTheme();
  return (
    <Text accessibilityRole="header" style={{ color: c.fg, fontSize: 19, fontWeight: '800' }}>
      {children}
    </Text>
  );
}

/** The website's Badge is the app's Chip. */
export const Badge = Chip;

const s = StyleSheet.create({
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segments: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  field: { gap: 6 },
  label: { fontSize: 17, fontWeight: '700' },
  input: { minHeight: 50, borderWidth: 2, borderRadius: 14, paddingHorizontal: 12, fontSize: 17 },
  multiline: { minHeight: 110, paddingTop: 12, textAlignVertical: 'top' },
  hint: { fontSize: 15, lineHeight: 21 },
  option: {
    minHeight: 52,
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionText: { flex: 1, gap: 2 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  check: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    minHeight: 44,
    paddingVertical: 6,
  },
  box: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { flex: 1, fontSize: 17, lineHeight: 24 },
  row: {
    minHeight: 60,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
