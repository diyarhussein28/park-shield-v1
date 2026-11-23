import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { PhoneVerify } from '@/components/phone-setup';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';

/**
 * Konto → „Handynummer ändern“ (SMS only): the new number gets a 6-digit SMS code after the explicit
 * opt-in; only then does the API replace the old number in place (contact_channels, encrypted, new
 * blind index, verified_at / opted_in_at = now) and write `user.phone_changed` to the audit log. Until
 * then the old number stays the one that gets the escalation SMS.
 */
export default function ChangePhone() {
  const router = useRouter();
  const { data, reload } = useProfile();
  const [done, setDone] = useState(false);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('phoneChangeTitle') }} />
      <Title>{t('phoneChangeTitle')}</Title>
      {done ? (
        <>
          <Banner tone="ok" testID="phone-change-done">
            {t('phoneChangeDone')}
          </Banner>
          <Button label={t('continue')} onPress={() => router.back()} />
        </>
      ) : (
        <>
          {data?.phone && <P>{t('phoneCurrent', { phone: data.phone })}</P>}
          <P muted>{t('phoneChangeHint')}</P>
          {/* TODO [LEGAL REVIEW] consent wording for the replaced number (LEGAL_REVIEW.md §8). */}
          <PhoneVerify
            consentLabel={t('phoneConsent')}
            onVerified={async () => {
              await reload();
              setDone(true);
            }}
            onCancel={() => router.back()}
          />
        </>
      )}
    </Screen>
  );
}
