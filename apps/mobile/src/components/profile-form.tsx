import { ApiError } from '@/lib/api';
import type { ProfileData } from '@/lib/profile';
import { pt } from '@/lib/portal-i18n';
import { asciiDigits } from '@/lib/text';
import { Field, Segmented } from './form';

export type ProfileErrors = Partial<Record<keyof ProfileData, string>>;

export const EMPTY_PROFILE: ProfileData = {
  firstName: '',
  lastName: '',
  street: '',
  postalCode: '',
  city: '',
  country: 'DE',
};

const COUNTRIES = ['DE', 'AT', 'CH'] as const;
const MARKUP = /[<>{}\\[\]`$|^~@#%*=+;]/;

/** The same rules as the API (profile.service.ts), so mistakes show before sending. */
export function validateProfile(p: ProfileData, part: 'name' | 'address' | 'all'): ProfileErrors {
  const e: ProfileErrors = {};
  const check = (k: keyof ProfileData, max: number) => {
    const v = p[k].trim();
    if (!v) e[k] = pt('profile.required');
    else if (v.length > max) e[k] = pt('profile.tooLong');
    else if (MARKUP.test(v)) e[k] = pt('profile.invalidCharacters');
  };
  if (part !== 'address') {
    check('firstName', 60);
    check('lastName', 60);
  }
  if (part !== 'name') {
    check('street', 100);
    check('city', 60);
    const code = p.postalCode.trim();
    if (!code) e.postalCode = pt('profile.required');
    else if (p.country === 'DE' ? !/^\d{5}$/.test(code) : !/^[A-Za-z0-9 -]{3,10}$/.test(code))
      e.postalCode = pt('profile.postalCodeInvalid');
  }
  return e;
}

/** Field errors from the API's 400 answer ({ issues: [{ path }] }). */
export function serverErrors(err: unknown): ProfileErrors | null {
  if (!(err instanceof ApiError) || err.status !== 400) return null;
  const issues = (err.body?.issues as { path: string }[] | undefined) ?? [];
  const e: ProfileErrors = {};
  for (const i of issues) {
    const k = i.path as keyof ProfileData;
    e[k] = k === 'postalCode' ? pt('profile.postalCodeInvalid') : pt('profile.invalidCharacters');
  }
  return e;
}

export function NameFields({
  value,
  onChange,
  errors,
}: {
  value: ProfileData;
  onChange: (p: ProfileData) => void;
  errors: ProfileErrors;
}) {
  return (
    <>
      <Field
        label={pt('profile.firstName')}
        value={value.firstName}
        onChangeText={(firstName) => onChange({ ...value, firstName })}
        autoComplete="given-name"
        textContentType="givenName"
        autoCapitalize="words"
        maxLength={60}
        error={errors.firstName}
        testID="firstName"
      />
      <Field
        label={pt('profile.lastName')}
        value={value.lastName}
        onChangeText={(lastName) => onChange({ ...value, lastName })}
        autoComplete="family-name"
        textContentType="familyName"
        autoCapitalize="words"
        maxLength={60}
        error={errors.lastName}
        testID="lastName"
      />
    </>
  );
}

export function AddressFields({
  value,
  onChange,
  errors,
}: {
  value: ProfileData;
  onChange: (p: ProfileData) => void;
  errors: ProfileErrors;
}) {
  return (
    <>
      <Field
        label={pt('profile.street')}
        value={value.street}
        onChangeText={(street) => onChange({ ...value, street })}
        autoComplete="street-address"
        textContentType="fullStreetAddress"
        maxLength={100}
        error={errors.street}
        testID="street"
      />
      <Field
        label={pt('profile.postalCode')}
        value={value.postalCode}
        onChangeText={(v) =>
          onChange({
            ...value,
            postalCode:
              value.country === 'DE'
                ? asciiDigits(v).replace(/\D/g, '').slice(0, 5)
                : asciiDigits(v),
          })
        }
        keyboardType={value.country === 'DE' ? 'number-pad' : 'default'}
        autoComplete="postal-code"
        textContentType="postalCode"
        maxLength={10}
        ltr
        error={errors.postalCode}
        testID="postalCode"
      />
      <Field
        label={pt('profile.city')}
        value={value.city}
        onChangeText={(city) => onChange({ ...value, city })}
        autoComplete="postal-address-locality"
        textContentType="addressCity"
        maxLength={60}
        error={errors.city}
        testID="city"
      />
      <Segmented
        legend={pt('profile.country')}
        options={COUNTRIES}
        value={
          (COUNTRIES as readonly string[]).includes(value.country) ? (value.country as 'DE') : null
        }
        onChange={(country) => onChange({ ...value, country })}
        label={(c) => pt(`profile.country${c}`)}
      />
    </>
  );
}
