import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { digitsOnly } from '@/lib/text';
import { radius, space, useTheme } from '@/theme/tokens';

export const CODE_LENGTH = 6;

/**
 * The 6-digit code as six boxes over one real input (P17): the system's code autofill
 * (`oneTimeCode`), paste, Arabic-Indic digits converted, and `onComplete` once six digits are in.
 * VoiceOver reads the one input with its label; the boxes are decoration.
 */
export function CodeInput({
  label,
  value,
  onChange,
  onComplete,
  error,
  testID,
  autoFocus = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: boolean;
  testID?: string;
  autoFocus?: boolean;
}) {
  const c = useTheme();
  const ref = useRef<TextInputInstance>(null);
  const change = (raw: string) => {
    const next = digitsOnly(raw, CODE_LENGTH);
    onChange(next);
    if (next.length === CODE_LENGTH && next !== value) onComplete?.(next);
  };
  return (
    <Pressable onPress={() => ref.current?.focus()} accessible={false} style={s.wrap}>
      <View
        style={s.row}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const digit = value[i] ?? '';
          const active = i === Math.min(value.length, CODE_LENGTH - 1);
          return (
            <View
              key={i}
              style={[
                s.box,
                {
                  backgroundColor: c.bg,
                  borderColor: error ? c.urgent : active ? c.primary : c.borderStrong,
                  borderWidth: active || error ? 2.5 : 1.5,
                },
              ]}
            >
              <Text maxFontSizeMultiplier={1.6} style={[s.digit, { color: c.fg }]}>
                {digit}
              </Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={CODE_LENGTH * 2}
        caretHidden
        style={s.hidden}
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'relative' },
  row: { flexDirection: 'row', gap: space.sm, justifyContent: 'center', writingDirection: 'ltr' },
  box: {
    flex: 1,
    maxWidth: 52,
    aspectRatio: 0.82,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Over the boxes, invisible: taps, paste menu and autofill reach the real input.
  hidden: { ...StyleSheet.absoluteFill, opacity: 0.02, color: 'transparent' },
});
