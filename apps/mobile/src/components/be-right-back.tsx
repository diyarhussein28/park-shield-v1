import {
  checkStatusText,
  graphemeCount,
  normalizeStatusText,
  STATUS_DEFAULT_DURATION,
  STATUS_DURATIONS,
  STATUS_MAX_MINUTES,
  STATUS_PRESETS,
  STATUS_TEXT_MAX,
  type StatusDuration,
  type StatusPreset,
} from '@parkshield/shared/vehicle-status';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { t, type Key } from '@/lib/i18n';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import {
  endStatus,
  extendStatus,
  getStatus,
  minutesLeftOf,
  mmss,
  onStatusChange,
  setStatus,
  statusChanged,
  type VehicleStatus,
} from '@/lib/vehicle-status';
import { radius, space, touch, type as typeScale, useTheme } from '@/theme/tokens';
import { Icon } from './icons';
import { Banner, Button, Chip } from './ui';

type Choice = StatusPreset | 'CUSTOM';

const presetText = (key: StatusPreset) => pt(`scanner.brbPreset_${key}` as MessageKey);

function errorKey(err: unknown): Key {
  const code = err instanceof ApiError ? err.body?.error : undefined;
  if (code === 'text_contact_data') return 'brbErrContact';
  if (code === 'text_too_long') return 'brbErrLong';
  if (code === 'text_too_many_lines') return 'brbErrLines';
  if (code === 'text_empty') return 'brbErrEmpty';
  if (code === 'at_cap') return 'brbAtCap';
  if (code === 'vehicle_inactive') return 'brbVehicleInactive';
  if (code === 'subscription_inactive') return 'brbSubscriptionInactive';
  if (err instanceof ApiError && err.status === 429) return 'brbRate';
  return 'error';
}

/** The client mirror of the API's text check (the API decides). */
function textProblem(raw: string): Key | null {
  const p = checkStatusText(normalizeStatusText(raw));
  if (p === 'contact_data') return 'brbErrContact';
  if (p === 'too_long') return 'brbErrLong';
  if (p === 'too_many_lines') return 'brbErrLines';
  if (p === 'empty') return 'brbErrEmpty';
  return null;
}

/**
 * The status of one vehicle: loaded on focus, on return to the foreground, on a push or a
 * notification action, and once more when the countdown reaches zero.
 */
export function useVehicleStatus(vehicleId: string | null) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatusState] = useState<VehicleStatus | null>(null);
  const load = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const r = await getStatus(vehicleId);
      setEnabled(r.enabled);
      setStatusState(r.status);
    } catch {
      // Offline: keep what is shown; the countdown still hides an expired status.
    }
  }, [vehicleId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    const off = onStatusChange((id) => {
      if (!id || id === vehicleId) void load();
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load();
    });
    return () => {
      off();
      sub.remove();
    };
  }, [load, vehicleId]);
  return { enabled, status, setStatus: setStatusState, reload: load };
}

/** Milliseconds left, ticking once a second while a status is shown. */
function useCountdown(expiresAt: string | null, onZero: () => void) {
  const [now, setNow] = useState(() => Date.now());
  const zero = useRef(onZero);
  useEffect(() => {
    zero.current = onZero;
  }, [onZero]);
  useEffect(() => {
    if (!expiresAt) return;
    const end = Date.parse(expiresAt);
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= end) {
        clearInterval(id);
        zero.current();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return expiresAt ? Date.parse(expiresAt) - now : 0;
}

/**
 * „Bin gleich zurück“ on a vehicle card (Home, vehicle screen): the button opens the sheet (two taps
 * with the defaults: button → „Aktivieren“); while a status runs, the banner with the message, a
 * live mm:ss countdown, „+5 Min“, „Beenden“ and how many people are waiting.
 */
export function BeRightBack({ vehicleId }: { vehicleId: string }) {
  const { enabled, status, setStatus: put, reload } = useVehicleStatus(vehicleId);
  const [open, setOpen] = useState(false);
  // A new key per opening: the sheet starts with the defaults every time (first preset, 10 min).
  const [sheetKey, setSheetKey] = useState(0);
  if (!enabled) return null;
  return (
    <View style={s.full}>
      {status ? (
        <ActiveBanner
          vehicleId={vehicleId}
          status={status}
          onChange={(next) => {
            put(next);
            statusChanged(vehicleId);
          }}
          onExpired={() => void reload()}
        />
      ) : (
        <Button
          label={t('brbButton')}
          variant="secondary"
          accessibilityHint={t('brbButtonHint')}
          onPress={() => {
            setSheetKey((k) => k + 1);
            setOpen(true);
          }}
          testID="brb-open"
        />
      )}
      <StatusSheet
        key={sheetKey}
        visible={open}
        vehicleId={vehicleId}
        onClose={() => setOpen(false)}
        onActivated={(next) => {
          put(next);
          setOpen(false);
          statusChanged(vehicleId);
        }}
      />
    </View>
  );
}

function ActiveBanner({
  vehicleId,
  status,
  onChange,
  onExpired,
}: {
  vehicleId: string;
  status: VehicleStatus;
  onChange: (next: VehicleStatus | null) => void;
  onExpired: () => void;
}) {
  const c = useTheme();
  const [busy, setBusy] = useState<'extend' | 'end' | null>(null);
  const [error, setError] = useState<Key | null>(null);
  const left = useCountdown(status.expiresAt, onExpired);
  const minutes = minutesLeftOf(left);
  const message = status.presetKey ? presetText(status.presetKey) : (status.customText ?? '');
  // The 60-minute cap moves with the clock: „+5 Min“ comes back once the end is below now + 60 min.
  const canExtend = left < STATUS_MAX_MINUTES * 60_000 - 1000;
  if (left <= 0) return null;
  return (
    <View
      testID="brb-banner"
      style={[s.banner, { backgroundColor: c.infoBg, borderColor: c.primary }]}
    >
      <View style={s.bannerHead}>
        <Icon name="clock" size={20} color={c.infoFg} />
        <Text accessibilityRole="header" style={[typeScale.label, s.flex, { color: c.infoFg }]}>
          {t('brbButton')}
        </Text>
        <Chip tone="ok">{t('brbActive')}</Chip>
      </View>
      <Text testID="brb-message" style={[typeScale.body, s.message, { color: c.infoFg }]}>
        {message}
      </Text>
      {/* The visible mm:ss ticks every second; screen readers get the minutes, politely, once a
          minute (the label changes only when the minute does). */}
      <View
        accessible
        accessibilityLabel={t('brbLeftSr', { count: minutes })}
        accessibilityLiveRegion="polite"
      >
        <Text
          testID="brb-countdown"
          style={[typeScale.heading, { color: c.infoFg, fontVariant: ['tabular-nums'] }]}
        >
          {t('brbEndsIn', { time: mmss(left) })}
        </Text>
      </View>
      {status.waitingCount > 0 && (
        <Text testID="brb-waiting" style={[typeScale.label, { color: c.infoFg }]}>
          {t('brbWaiting', { count: status.waitingCount })}
        </Text>
      )}
      {error && <Banner tone="err">{t(error)}</Banner>}
      <View style={s.row}>
        <View style={s.flex}>
          <Button
            label={t('brbExtend')}
            variant="secondary"
            accessibilityHint={canExtend ? t('brbExtendLabel') : t('brbAtCap')}
            disabled={!canExtend}
            busy={busy === 'extend'}
            onPress={async () => {
              setBusy('extend');
              setError(null);
              try {
                onChange(await extendStatus(vehicleId));
              } catch (err) {
                setError(errorKey(err));
              } finally {
                setBusy(null);
              }
            }}
            testID="brb-extend"
          />
        </View>
        <View style={s.flex}>
          <Button
            label={t('brbEnd')}
            variant="secondary"
            accessibilityHint={t('brbEndLabel')}
            busy={busy === 'end'}
            onPress={async () => {
              setBusy('end');
              setError(null);
              try {
                await endStatus(vehicleId);
                onChange(null);
              } catch (err) {
                setError(errorKey(err));
              } finally {
                setBusy(null);
              }
            }}
            testID="brb-end"
          />
        </View>
      </View>
    </View>
  );
}

/** One radio row (preset or „Eigene Nachricht“). */
function RadioRow({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        s.radio,
        {
          borderColor: selected ? c.primary : c.border,
          backgroundColor: selected ? c.infoBg : c.bg,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[s.dot, { borderColor: selected ? c.primary : c.borderStrong }]}>
        {selected && <View style={[s.dotInner, { backgroundColor: c.primary }]} />}
      </View>
      <Text style={[typeScale.body, s.flex, { color: c.fg }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The bottom sheet: presets (the first is preselected), „Eigene Nachricht“ with a live 0/150 counter,
 * the hint and the same check as the API, duration chips (10 min preselected), the preview „So sehen
 * es andere“, the traffic-rules note and „Aktivieren“.
 */
export function StatusSheet({
  visible,
  vehicleId,
  onClose,
  onActivated,
}: {
  visible: boolean;
  vehicleId: string;
  onClose: () => void;
  onActivated: (status: VehicleStatus) => void;
}) {
  const c = useTheme();
  const [choice, setChoice] = useState<Choice>(STATUS_PRESETS[0]);
  const [text, setText] = useState('');
  const [duration, setDuration] = useState<StatusDuration>(STATUS_DEFAULT_DURATION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);

  const custom = choice === 'CUSTOM';
  const count = graphemeCount(normalizeStatusText(text));
  const problem = custom && text.trim() ? textProblem(text) : null;
  const preview = custom ? normalizeStatusText(text) : presetText(choice);

  const activate = async () => {
    if (custom) {
      const p = textProblem(text);
      if (p) {
        setError(p);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const st = await setStatus(
        vehicleId,
        custom ? { customText: normalizeStatusText(text) } : { presetKey: choice },
        duration,
      );
      onActivated(st);
    } catch (err) {
      setError(errorKey(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[s.scrim, { backgroundColor: 'rgba(15,23,42,0.45)' }]}>
        <Pressable
          style={s.flex}
          accessibilityRole="button"
          accessibilityLabel={t('brbClose')}
          onPress={onClose}
        />
        <SafeAreaView
          edges={['bottom']}
          style={[s.sheet, { backgroundColor: c.bg, borderColor: c.border }]}
          testID="brb-sheet"
        >
          <View style={[s.grabber, { backgroundColor: c.border }]} />
          <ScrollView contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
            <View style={s.sheetHead}>
              <Text accessibilityRole="header" style={[typeScale.title, s.flex, { color: c.fg }]}>
                {t('brbSheetTitle')}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('brbClose')}
                hitSlop={12}
                onPress={onClose}
                style={s.close}
              >
                <Icon name="close" size={24} color={c.muted} />
              </Pressable>
            </View>
            <Text style={[typeScale.body, { color: c.muted }]}>{t('brbSheetIntro')}</Text>

            <Text style={[typeScale.label, { color: c.fg }]}>{t('brbMessage')}</Text>
            <View accessibilityRole="radiogroup" style={s.list}>
              {STATUS_PRESETS.map((k) => (
                <RadioRow
                  key={k}
                  label={presetText(k)}
                  selected={choice === k}
                  onPress={() => setChoice(k)}
                  testID={`brb-preset-${k}`}
                />
              ))}
              <RadioRow
                label={t('brbCustom')}
                selected={custom}
                onPress={() => setChoice('CUSTOM')}
                testID="brb-preset-CUSTOM"
              />
            </View>
            {custom && (
              <View style={s.list}>
                <TextInput
                  testID="brb-text"
                  value={text}
                  onChangeText={setText}
                  multiline
                  autoFocus
                  accessibilityLabel={t('brbCustom')}
                  accessibilityHint={t('brbHint')}
                  placeholder={t('brbCustomPlaceholder')}
                  placeholderTextColor={c.muted}
                  style={[
                    typeScale.body,
                    s.input,
                    { color: c.fg, borderColor: problem ? c.danger : c.borderStrong },
                  ]}
                />
                <View style={s.row}>
                  <Text style={[typeScale.caption, s.flex, { color: c.muted }]}>
                    {t('brbHint')}
                  </Text>
                  <Text
                    testID="brb-counter"
                    accessibilityLiveRegion="polite"
                    style={[
                      typeScale.caption,
                      { color: count > STATUS_TEXT_MAX ? c.dangerText : c.muted },
                    ]}
                  >
                    {t('brbCounter', { count })}
                  </Text>
                </View>
                {problem && (
                  <Text
                    testID="brb-text-error"
                    accessibilityRole="alert"
                    style={[typeScale.label, { color: c.dangerText }]}
                  >
                    {t(problem)}
                  </Text>
                )}
              </View>
            )}

            <Text style={[typeScale.label, { color: c.fg }]}>{t('brbDuration')}</Text>
            <View accessibilityRole="radiogroup" style={s.chips}>
              {STATUS_DURATIONS.map((m) => {
                const on = duration === m;
                return (
                  <Pressable
                    key={m}
                    testID={`brb-duration-${m}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={t('brbMinutesLabel', { count: m })}
                    onPress={() => setDuration(m)}
                    style={[
                      s.chip,
                      {
                        backgroundColor: on ? c.primary : c.bg,
                        borderColor: on ? c.primary : c.borderStrong,
                      },
                    ]}
                  >
                    <Text style={[typeScale.label, { color: on ? c.primaryFg : c.fg }]}>
                      {t('brbMinutes', { count: m })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[typeScale.label, { color: c.fg }]}>{t('brbPreview')}</Text>
            <View
              testID="brb-preview"
              style={[s.preview, { backgroundColor: c.infoBg, borderColor: c.primary }]}
            >
              <Text style={[typeScale.caption, { color: c.infoFg }]}>{pt('scanner.brbTitle')}</Text>
              <Text style={[typeScale.heading, { color: c.infoFg }]}>
                {preview || t('brbCustomPlaceholder')}
              </Text>
              <Text style={[typeScale.label, { color: c.infoFg }]}>
                {pt('scanner.brbBack', { minutes: duration })}
              </Text>
              <View style={[s.fakeButton, { backgroundColor: c.primary }]}>
                <Text style={[typeScale.label, { color: c.primaryFg }]}>
                  {pt('scanner.brbWait')}
                </Text>
              </View>
            </View>

            <Banner tone="warn">{t('brbNote')}</Banner>
            {error && <Banner tone="err">{t(error)}</Banner>}
            <Button
              label={t('brbActivate')}
              size="lg"
              busy={busy}
              disabled={Boolean(problem)}
              onPress={() => void activate()}
              testID="brb-activate"
            />
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  full: { alignSelf: 'stretch', gap: space.sm },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  banner: { borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  bannerHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  message: { fontWeight: '700', fontSize: 19, lineHeight: 26 },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: radius.lg + 8,
    borderTopRightRadius: radius.lg + 8,
    borderWidth: 1,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, marginTop: space.sm },
  sheetBody: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  close: {
    minWidth: touch.min,
    minHeight: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: space.sm },
  radio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch.min,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1.5,
    borderRadius: radius.md,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: { width: 11, height: 11, borderRadius: 6 },
  input: {
    minHeight: 96,
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: space.md,
    textAlignVertical: 'top',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minWidth: 64,
    minHeight: touch.min,
    paddingHorizontal: space.md,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: { borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  fakeButton: {
    marginTop: space.sm,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
