import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { EmailCode } from '@/components/email-code';
import { LogoMark } from '@/components/icons';
import { Button, Screen } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { tokenFromLink, useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';

/**
 * Sign-in for existing accounts (AUTH.md): e-mail → „Code eingeben“. The e-mail carries a 6-digit code
 * and a link to the website's bridge page, whose „In der App öffnen“ lands on auth/callback. Links of
 * older e-mails (/app/anmelden#t=…) are still redeemed here. The title is in the screen only, not
 * repeated in the header (P5).
 */
export default function SignIn() {
  const { consume } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ t?: string }>();
  const url = Linking.useURL();
  const [error, setError] = useState<string | null>(null);
  const [onEmail, setOnEmail] = useState(true);
  const used = useRef<string | null>(null);

  // A legacy link that opened the app (initial URL or while running).
  useEffect(() => {
    const token = params.t ?? tokenFromLink(url);
    if (!token || used.current === token) return;
    used.current = token;
    consume(token).catch((e: unknown) =>
      setError(e instanceof ApiError && e.status === 401 ? t('linkInvalid') : t('error')),
    );
  }, [params.t, url, consume]);

  return (
    <Screen>
      <View style={s.brand}>
        <LogoMark size={56} />
      </View>
      <EmailCode
        emailTitle={t('signInTitle')}
        emailIntro={t('signInIntro')}
        error={error}
        onEmailStep={setOnEmail}
      />
      {onEmail && (
        <Button
          label={t('newAccount')}
          variant="ghost"
          onPress={() => router.replace('/registrieren')}
          testID="to-signup"
        />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  brand: { alignItems: 'center', paddingTop: 8 },
});
