import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { CodeInput } from '@/components/code-input';
import { Check, Field } from '@/components/form';
import { StepProgress } from '@/components/list';
import {
  AddressFields,
  EMPTY_PROFILE,
  NameFields,
  serverErrors,
  validateProfile,
  type ProfileErrors,
} from '@/components/profile-form';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { useProfile, type ProfileData } from '@/lib/profile';
import { SIGNUP_STEPS } from './registrieren';

type Flow = 'signup' | 'complete' | 'edit';
type Step = 'name' | 'address' | 'phone';
const STEPS: Step[] = ['name', 'address', 'phone'];

/**
 * Name, address and (optionally) the mobile number, in short steps with a progress bar (§6):
 * - `signup`: steps 2–4 of the new sign-up, then the Face ID offer and the plans;
 * - `complete`: accounts from before the sign-up existed complete them once, blocking (§7);
 * - `edit`: „Ihre Angaben“ from the Konto tab, one form.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const { flow: raw } = useLocalSearchParams<{ flow?: string }>();
  const flow: Flow = raw === 'signup' || raw === 'edit' ? raw : 'complete';
  const { data, save } = useProfile();
  const [step, setStep] = useState<Step>('name');
  const [value, setValue] = useState<ProfileData>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.profile) {
      const { firstName, lastName, street, postalCode, city, country } = data.profile;
      setValue({ firstName, lastName, street, postalCode, city, country });
    }
  }, [data?.profile]);

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
      await save({
        ...value,
        firstName: value.firstName.trim(),
        lastName: value.lastName.trim(),
        street: value.street.trim(),
        postalCode: value.postalCode.trim(),
        city: value.city.trim(),
      });
      if (flow === 'edit') done();
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
      {flow !== 'edit' && (
        <StepProgress step={index} total={total} label={t('signUpStep', { step: index, total })} />
      )}
      {flow === 'complete' && step === 'name' && <P muted>{pt('profile.completeIntro')}</P>}

      {flow === 'edit' ? (
        <>
          <Title>{pt('profile.title')}</Title>
          <NameFields value={value} onChange={setValue} errors={errors} />
          <AddressFields value={value} onChange={setValue} errors={errors} />
          <P muted>{pt('profile.privacyNote')}</P>
          <Button label={pt('vehicles.save')} busy={busy} onPress={() => void submit('all')} />
        </>
      ) : step === 'name' ? (
        <>
          <Title>{t('signUpNameTitle')}</Title>
          <P muted>{pt('profile.whyName')}</P>
          <NameFields value={value} onChange={setValue} errors={errors} />
          <Button label={t('continue')} onPress={() => void submit('name')} testID="name-next" />
        </>
      ) : step === 'address' ? (
        <>
          <Title>{t('signUpAddressTitle')}</Title>
          <P muted>{pt('profile.whyAddress')}</P>
          <AddressFields value={value} onChange={setValue} errors={errors} />
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
        <PhoneStep alreadyLinked={data?.phone ?? null} onDone={done} />
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </Screen>
  );
}

/**
 * Optional mobile number (§6): verified with one SMS code through the same flow as „Benachrichtigungen“
 * (it becomes the SMS channel; nothing is pre-ticked, the opt-in stays explicit). „Überspringen“ is
 * always possible.
 */
function PhoneStep({
  alreadyLinked,
  onDone,
}: {
  alreadyLinked: string | null;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [linked, setLinked] = useState(alreadyLinked);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api('/v1/channels/phone', { body: { phone, channels: ['sms'], consent: true } });
      setSent(true);
      setCode('');
    } catch (err) {
      const why = err instanceof ApiError ? err.body?.error : undefined;
      setMessage({
        tone: 'err',
        text:
          why === 'phone_invalid'
            ? t('signUpPhoneInvalid')
            : why === 'channel_unavailable'
              ? pt('channels.phoneNoneAvailable')
              : errorText(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api('/v1/channels/phone/verify', { body: { code: value } });
      setLinked(phone);
      setMessage({ tone: 'ok', text: t('signUpPhoneDone') });
    } catch (err) {
      const why = err instanceof ApiError ? err.body?.error : undefined;
      setCode('');
      if (why === 'code_expired') setSent(false);
      setMessage({
        tone: 'err',
        text:
          why === 'code_wrong'
            ? t('signUpPhoneWrong')
            : why === 'code_expired'
              ? pt('channels.waCodeExpired')
              : errorText(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title>{t('signUpPhoneTitle')}</Title>
      <P muted>{t('signUpPhoneIntro')}</P>
      {linked ? (
        <>
          <Banner tone="ok">{`${t('signUpPhoneDone')} ${linked}`}</Banner>
          <Button label={t('continue')} onPress={onDone} testID="phone-done" />
        </>
      ) : sent ? (
        <>
          <CodeInput
            label={t('signUpPhoneCode')}
            value={code}
            onChange={setCode}
            onComplete={(v) => void verify(v)}
            error={message?.tone === 'err'}
          />
          <Button
            label={pt('channels.waVerify')}
            busy={busy}
            disabled={code.length !== 6}
            onPress={() => void verify()}
          />
          <Button
            label={pt('channels.waOtherNumber')}
            variant="ghost"
            onPress={() => setSent(false)}
          />
        </>
      ) : (
        <>
          <Field
            label={t('signUpPhoneLabel')}
            hint={pt('channels.waPhoneHint')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={30}
            testID="phone"
          />
          <Check label={pt('channels.phoneVia_sms')} checked={consent} onChange={setConsent} />
          <P muted>{pt('channels.phoneConsentNote')}</P>
          <Button
            label={t('signUpPhoneSend')}
            busy={busy}
            disabled={phone.trim().length < 6 || !consent}
            onPress={() => void start()}
          />
        </>
      )}
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      {!linked && <Button label={t('skip')} variant="ghost" onPress={onDone} testID="phone-skip" />}
    </>
  );
}
