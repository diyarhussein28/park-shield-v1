import { useRouter } from 'expo-router';
import { useState } from 'react';
import { EmailCode } from '@/components/email-code';
import { StepProgress } from '@/components/list';
import { Button, Screen } from '@/components/ui';
import { t } from '@/lib/i18n';

/** Total sign-up steps: e-mail and code, name, address, phone (optional). */
export const SIGNUP_STEPS = 4;

/**
 * Sign-up, step 1 (§6, owner decision: before payment): the e-mail, verified with the 6-digit code.
 * The account exists once the code is right; the root layout then continues with name, address and
 * phone (/profil?flow=signup).
 */
export default function SignUp() {
  const router = useRouter();
  const [onEmail, setOnEmail] = useState(true);
  return (
    <Screen>
      <StepProgress
        step={1}
        total={SIGNUP_STEPS}
        label={t('signUpStep', { step: 1, total: SIGNUP_STEPS })}
      />
      <EmailCode
        emailTitle={t('signUpEmailTitle')}
        emailIntro={t('signUpEmailIntro')}
        onEmailStep={setOnEmail}
      />
      {onEmail && (
        <Button
          label={t('obHaveAccount')}
          variant="ghost"
          onPress={() => router.replace('/anmelden')}
          testID="to-signin"
        />
      )}
    </Screen>
  );
}
