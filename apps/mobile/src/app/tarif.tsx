import { useRouter } from 'expo-router';
import { StepProgress } from '@/components/list';
import { CheckoutForm } from '@/components/subscription';
import { P, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useOptionalProfile } from '@/lib/profile';
import { SIGNUP_STEPS } from './registrieren';

/**
 * The paywall (§5.4, P7), last step of the sign-up: one plan card like the website's with everything
 * it includes and both § 312j buttons („Zahlungspflichtig bestellen – 19,99 € / Jahr“, Lifetime) under
 * the immediate-start declaration (`CheckoutForm`). No plan choice, no upgrade. After the payment: the welcome moment, then
 * straight to „Auto anlegen“.
 */
export default function Plans() {
  const router = useRouter();
  const newAccount = useOptionalProfile()?.newAccount ?? false;
  return (
    <Screen>
      {newAccount && (
        <StepProgress
          step={SIGNUP_STEPS}
          total={SIGNUP_STEPS}
          label={t('signUpStep', { step: SIGNUP_STEPS, total: SIGNUP_STEPS })}
        />
      )}
      <Title>{t('paywallTitle')}</Title>
      <P muted>{t('paywallIntro')}</P>
      <CheckoutForm
        onPaid={() => router.replace({ pathname: '/erfolg', params: { kind: 'paid' } })}
      />
    </Screen>
  );
}
