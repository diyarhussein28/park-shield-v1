import { useState } from 'react';
import { View } from 'react-native';
import { labelProblem, type LabelProblem } from '@/lib/billing';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { Field } from './form';
import { Banner, Button, P } from './ui';
import { useOptionalProfile } from '@/lib/profile';

export interface VehicleInput {
  nickname: string;
  plate: string;
  color: string;
  makeModel: string;
}

/** The form's message for a vehicle label that cannot be printed. */
export const labelErrorText = (p: LabelProblem) =>
  p === 'required'
    ? t('labelErrRequired')
    : p === 'length'
      ? t('labelErrLength')
      : t('labelErrChars');

/** Nickname, plate, colour, make and model (web: VehicleForm). */
export function VehicleForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: {
    nickname: string;
    plate: string | null;
    color: string | null;
    makeModel: string | null;
  };
  submitLabel: string;
  onSubmit: (v: VehicleInput) => Promise<void>;
}) {
  const [form, setForm] = useState<VehicleInput>({
    nickname: initial?.nickname ?? '',
    plate: initial?.plate ?? '',
    color: initial?.color ?? '',
    makeModel: initial?.makeModel ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const set = (k: keyof VehicleInput) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  // B1: the name is printed on the decal, so it follows the label rules (server: label_invalid).
  const problem = labelProblem(form.nickname);

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(form);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Field
        label={pt('vehicles.nickname')}
        hint={pt('vehicles.nicknameHint')}
        value={form.nickname}
        onChangeText={(v) => {
          setTouched(true);
          set('nickname')(v);
        }}
        error={touched && problem ? labelErrorText(problem) : null}
        maxLength={20}
      />
      <Field
        label={pt('vehicles.plate')}
        hint={pt('vehicles.plateHint')}
        value={form.plate}
        onChangeText={set('plate')}
        ltr
        maxLength={12}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Field
        label={pt('vehicles.color')}
        optional={pt('common.optional')}
        value={form.color}
        onChangeText={set('color')}
        maxLength={30}
      />
      <Field
        label={pt('vehicles.makeModel')}
        optional={pt('common.optional')}
        value={form.makeModel}
        onChangeText={set('makeModel')}
        maxLength={80}
      />
      <Button
        label={submitLabel}
        busy={busy}
        disabled={Boolean(problem) || form.plate.trim().length < 2}
        onPress={() => void submit()}
      />
    </View>
  );
}

export interface Address {
  name: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  country: 'DE';
}

/** Shipping address in Germany (web: AddressForm), for the included and the replacement decal. */
export function AddressForm({
  intro,
  submitLabel,
  onSubmit,
  initial,
  disabled,
}: {
  intro: string;
  submitLabel: string;
  onSubmit: (a: Address) => Promise<void>;
  /** The API's prefill (print options `addressPrefill`); wins over the sign-up profile. */
  initial?: {
    name: string;
    line1: string;
    line2?: string | null;
    postalCode: string;
    city: string;
  } | null;
  disabled?: boolean;
}) {
  // Prefilled with the sign-up address (Germany only: decals ship within Germany), so nobody
  // types it twice; it can still be changed for this order.
  const signup = useOptionalProfile()?.data?.profile;
  const fromSignup = signup?.country === 'DE';
  const [a, setA] = useState(
    initial
      ? {
          name: initial.name,
          line1: initial.line1,
          line2: initial.line2 ?? '',
          postalCode: initial.postalCode,
          city: initial.city,
        }
      : {
          name: fromSignup ? `${signup.firstName} ${signup.lastName}` : '',
          line1: fromSignup ? signup.street : '',
          line2: '',
          postalCode: fromSignup ? signup.postalCode : '',
          city: fromSignup ? signup.city : '',
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof a) => (v: string) => setA((x) => ({ ...x, [k]: v }));
  const valid = a.name.trim() && a.line1.trim() && /^\d{5}$/.test(a.postalCode) && a.city.trim();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...a, line2: a.line2 || undefined, country: 'DE' });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <P>{intro}</P>
      <Field
        label={pt('order.name')}
        value={a.name}
        onChangeText={set('name')}
        autoComplete="name"
      />
      <Field
        label={pt('order.line1')}
        value={a.line1}
        onChangeText={set('line1')}
        autoComplete="address-line1"
      />
      <Field
        label={pt('order.line2')}
        optional={pt('common.optional')}
        value={a.line2}
        onChangeText={set('line2')}
        autoComplete="address-line2"
      />
      <Field
        label={pt('order.postalCode')}
        value={a.postalCode}
        onChangeText={(v) => set('postalCode')(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        maxLength={5}
        autoComplete="postal-code"
      />
      <Field label={pt('order.city')} value={a.city} onChangeText={set('city')} />
      <P muted>{pt('order.countryNote')}</P>
      {error && <Banner tone="err">{error}</Banner>}
      <Button
        label={submitLabel}
        busy={busy}
        disabled={!valid || disabled}
        onPress={() => void submit()}
        testID="address-submit"
      />
    </View>
  );
}
