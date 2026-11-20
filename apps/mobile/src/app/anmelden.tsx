import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Field } from '@/components/form';
import { LogoMark, Wordmark } from '@/components/icons';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { tokenFromLink, useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';

const RESEND_SECONDS = 60;

/**
 * Sign-in (AUTH.md): e-mail → „Code eingeben“. The e-mail carries a 6-digit code (works in Expo Go and
 * with every e-mail app) and a link to the website's bridge page, whose „In der App öffnen“ lands on
 * auth/callback. Links of older e-mails (/app/anmelden#t=…) are still redeemed here.
 */
export default function SignIn() {
  const { requestCode, verifyCode, consume } = useAuth();
  const params = useLocalSearchParams<{ t?: string }>();
  const url = Linking.useURL();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const used = useRef<string | null>(null);

  // A legacy link that opened the app (initial URL or while running).
  useEffect(() => {
    const token = params.t ?? tokenFromLink(url);
    if (!token || used.current === token) return;
    used.current = token;
    setBusy(true);
    consume(token)
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.status === 401 ? t('linkInvalid') : t('error')),
      )
      .finally(() => setBusy(false));
  }, [params.t, url, consume]);

  // „Code erneut senden“ only after 60 seconds.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const send = async (to: string, again = false) => {
    setBusy(true);
    setError(null);
    setExpired(false);
    setInfo(null);
    try {
      await requestCode(to);
      setSentTo(to.trim());
      setCode('');
      setWait(RESEND_SECONDS);
      if (again) setInfo(t('codeResent'));
    } catch {
      setError(t('error'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!sentTo || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await verifyCode(sentTo, code);
    } catch (e) {
      const why = e instanceof ApiError ? e.body?.error : undefined;
      if (why === 'code_expired') {
        setExpired(true);
        setError(t('codeExpired'));
      } else setError(why === 'code_invalid' ? t('codeInvalid') : t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={s.brand}>
        <LogoMark size={64} />
        <Wordmark size={28} />
      </View>
      {sentTo ? (
        <>
          <Title>{t('codeTitle')}</Title>
          <P muted>{t('codeIntro', { email: sentTo })}</P>
          <Field
            label={t('codeLabel')}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            testID="code"
          />
          <Button
            label={t('codeSubmit')}
            onPress={() => void submit()}
            busy={busy}
            disabled={code.length !== 6}
          />
          {info && <Banner tone="ok">{info}</Banner>}
          {error && <Banner tone="err">{error}</Banner>}
          {expired ? (
            <Button
              label={t('codeNew')}
              variant="secondary"
              onPress={() => void send(sentTo, true)}
            />
          ) : (
            <Button
              label={wait > 0 ? t('codeResendIn', { seconds: wait }) : t('codeResend')}
              variant="secondary"
              disabled={wait > 0}
              onPress={() => void send(sentTo, true)}
            />
          )}
          <P muted>{t('codeHint')}</P>
          <Button
            label={t('codeOtherEmail')}
            variant="ghost"
            onPress={() => {
              setSentTo(null);
              setError(null);
              setExpired(false);
            }}
          />
        </>
      ) : (
        <>
          <Title>{t('signInTitle')}</Title>
          <P muted>{t('signInIntro')}</P>
          <Field
            label={t('email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            testID="email"
          />
          <Button
            label={t('sendCode')}
            onPress={() => void send(email)}
            busy={busy}
            disabled={!email.includes('@')}
            testID="send-code"
          />
          {error && <Banner tone="err">{error}</Banner>}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  brand: { alignItems: 'center', gap: 8, paddingVertical: 16 },
});
