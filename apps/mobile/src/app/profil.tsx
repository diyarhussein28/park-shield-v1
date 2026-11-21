import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StepProgress } from '@/components/list';
import { PhoneVerify } from '@/components/phone-setup';
import {
  AddressFields,
  EMPTY_PROFILE,
  NameFields,
  serverErrors,
  validateProfile,
  type ProfileErrors,
} from '@/components/profile-form';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { useProfile, type ProfileData } from '@/lib/profile';
import { SIGNUP_STEPS } from './registrieren';

type Flow = 'signup' | 'complete' | 'edit';
type Step = 'name' | 'address' | 'phone';
const STEPS: Step[] = ['name', 'address', 'phone'];

/**
 * Name, address and the mobile number (required since 2026-11-21, verified by SMS code), in short
 * steps with a progress bar (§6):
 * - `signup`: steps 2–4 of the new sign-up (step 5 is the plan), then the Face ID offer and the plan;
 * - `complete`: accounts from before the sign-up or the phone rule complete what is missing once,
 *   blocking (§7); an account with name and address only sees the phone step;
 * - `edit`: „Ihre Angaben“ from the Konto tab, one form (the number is changed under
 *   „Benachrichtigungen“).
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { flow: raw } = useLocalSearchParams<{ flow?: string }>();
  const flow: Flow = raw === 'signup' || raw === 'edit' ? raw : 'complete';
  const { data, save, reload } = useProfile();
  const [step, setStep] = useState<Step>('name');
  // Name and address were already there: only the phone is missing (decided once, so saving the
  // address in this flow does not switch the layout half-way).
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [value, setValue] = useState<ProfileData>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<ProfileErrors>({});
  // A corrected field loses its error at once (not only on the next „Weiter“).
  const change = (next: ProfileData) => {
    setErrors((e) => {
      const kept = { ...e };
      for (const k of Object.keys(e) as (keyof ProfileData)[])
        if (next[k] !== value[k]) delete kept[k];
      return kept;
    });
    setValue(next);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.profile) {
      const { firstName, lastName, street, postalCode, city, country } = data.profile;
      setValue({ firstName, lastName, street, postalCode, city, country });
    }
  }, [data?.profile]);

  // Reopened with name and address saved but no verified number: straight to the phone step.
  const missingPhoneOnly =
    flow !== 'edit' && Boolean(data?.complete) && data?.phoneVerified === false;
  const decided = useRef(false);
  useEffect(() => {
    // Only the first answer decides (see phoneOnly).
    if (decided.current || !data) return;
    decided.current = true;
    if (missingPhoneOnly) {
      setStep('phone');
      if (flow === 'complete') setPhoneOnly(true);
    }
  }, [data, missingPhoneOnly, flow]);

  const done = () => {
    if (flow === 'edit') router.back();
    else
      router.replace({
        pathname: '/app-sperre',
        params: { next: flow === 'signup' ? 'tarif' : 'home' },
      });
  };

  const submit = async (part: 'name' | 'address' | 'all') => {
    const e = validateProfile(value, part);
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    if (part === 'name') return setStep('address');
    setBusy(true);
    try {
      const saved = await save({
        ...value,
        firstName: value.firstName.trim(),
        lastName: value.lastName.trim(),
        street: value.street.trim(),
        postalCode: value.postalCode.trim(),
        city: value.city.trim(),
      });
      if (flow === 'edit') done();
      // The number is already verified (e.g. an old account that only lacked its address): done.
      else if (saved?.phoneVerified === true) done();
      else setStep('phone');
    } catch (err) {
      const fields = serverErrors(err);
      if (fields) {
        setErrors(fields);
        if (fields.firstName || fields.lastName) setStep('name');
      } else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const offset = flow === 'signup' ? 1 : 0;
  const total = flow === 'signup' ? SIGNUP_STEPS : STEPS.length;
  const index = STEPS.indexOf(step) + 1 + offset;
  const title =
    flow === 'edit'
      ? pt('profile.title')
      : phoneOnly
        ? t('phoneCompleteTitle')
        : flow === 'complete'
          ? pt('profile.completeTitle')
          : t('signUpTitle');

  return (
    <Screen>
      <Stack.Screen
        options={{
          title,
          // Blocking: an old account cannot skip it (owner decision 2026-11-20).
          headerBackVisible: flow === 'edit',
          gestureEnabled: flow === 'edit',
        }}
      />
      {flow !== 'edit' && !phoneOnly && (
        <StepProgress step={index} total={total} label={t('signUpStep', { step: index, total })} />
      )}
      {flow === 'complete' && step === 'name' && <P muted>{pt('profile.completeIntro')}</P>}

      {flow === 'edit' ? (
        <>
          <Title>{pt('profile.title')}</Title>
          <NameFields value={value} onChange={change} errors={errors} />
          <AddressFields value={value} onChange={change} errors={errors} />
          <P muted>{pt('profile.privacyNote')}</P>
          <Button label={pt('vehicles.save')} busy={busy} onPress={() => void submit('all')} />
        </>
      ) : step === 'name' ? (
        <>
          <Title>{t('signUpNameTitle')}</Title>
          <P muted>{pt('profile.whyName')}</P>
          <NameFields value={value} onChange={change} errors={errors} />
          <Button label={t('continue')} onPress={() => void submit('name')} testID="name-next" />
        </>
      ) : step === 'address' ? (
        <>
          <Title>{t('signUpAddressTitle')}</Title>
          <P muted>{pt('profile.whyAddress')}</P>
          <AddressFields value={value} onChange={change} errors={errors} />
          <P muted>{pt('profile.privacyNote')}</P>
          <Button
            label={pt('profile.save')}
            busy={busy}
            onPress={() => void submit('address')}
            testID="address-next"
          />
          <Button label={pt('common.back')} variant="ghost" onPress={() => setStep('name')} />
        </>
      ) : (
        <>
          <Title>{t('phoneTitle')}</Title>
          <P muted>{phoneOnly ? t('phoneCompleteIntro') : t('phoneIntro')}</P>
          <PhoneVerify
            onVerified={async () => {
              // The gate must see the verified number before the next screen, or it sends us back.
              await reload();
              done();
            }}
          />
        </>
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </Screen>
  );
}
