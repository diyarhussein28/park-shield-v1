import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { CodeInput } from '@/components/code-input';
import { Field } from '@/components/form';
import { Banner, Button, P, Screen, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { errorText } from '@/lib/portal';
import { useProfile } from '@/lib/profile';

const RESEND_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The API's e-mail-change errors in plain words (apps/api/src/profile/email-change.service.ts). */
function changeError(err: unknown): string {
  const body =
    err instanceof ApiError ? (err.body as { error?: string; attemptsLeft?: number } | null) : null;
  if (err instanceof ApiError && err.status === 429) return t('tooManyTries');
  switch (body?.error) {
    case 'email_taken':
      return t('emailTaken');
    case 'email_unchanged':
      return t('emailUnchanged');
    case 'invalid_request':
      return t('emailInvalid');
    case 'code_wrong':
      return t('phoneCodeWrong', { left: body.attemptsLeft ?? 0 });
    case 'code_expired':
      return t('codeExpired');
    default:
      return errorText(err);
  }
}

/**
 * Konto → „E-Mail-Adresse ändern“: the new address gets a 6-digit code; the account keeps the old
 * address (and signs in with it) until the code is confirmed here. Afterwards the old address gets a
 * security notice and Stripe receipts go to the new one.
 */
export default function ChangeEmail() {
  const router = useRouter();
  const { data, reload } = useProfile();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const valid = EMAIL.test(email.trim());

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ email: string }>('/v1/me/email/change', {
        body: { email: email.trim() },
      });
      setSentTo(r.email);
      setCode('');
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(changeError(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    if (!/^\d{6}$/.test(value) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ email: string }>('/v1/me/email/change/verify', {
        body: { code: value },
      });
      await reload();
      setDone(r.email);
    } catch (err) {
      const why = err instanceof ApiError ? err.body?.error : undefined;
      setCode('');
      if (why === 'code_expired' || why === 'email_taken') setSentTo(null);
      setError(changeError(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    void api('/v1/me/email/change', { method: 'DELETE' }).catch(() => undefined);
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('emailChangeTitle') }} />
      {done ? (
        <>
          <Title>{t('emailChangeTitle')}</Title>
          <Banner tone="ok" testID="email-change-done">
            {t('emailChangeDone', { email: done })}
          </Banner>
          <Button label={t('continue')} onPress={() => router.back()} />
        </>
      ) : sentTo ? (
        <>
          <Title>{t('codeTitle')}</Title>
          <P muted>{t('emailChangeCodeSent', { email: sentTo })}</P>
          <CodeInput
            label={t('codeLabel')}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (error) setError(null);
            }}
            onComplete={(v) => void verify(v)}
            error={Boolean(error)}
            testID="email-change-code"
          />
          <Button
            label={t('emailChangeConfirm')}
            busy={busy}
            disabled={code.length !== 6}
            onPress={() => void verify()}
            testID="email-change-verify"
          />
          {error && <Banner tone="err">{error}</Banner>}
          <Button
            label={wait > 0 ? t('codeResendIn', { seconds: wait }) : t('codeResend')}
            variant="secondary"
            disabled={wait > 0 || busy}
            onPress={() => void send()}
          />
          <Button
            label={t('emailChangeOther')}
            variant="ghost"
            onPress={() => {
              setSentTo(null);
              setError(null);
            }}
          />
          <Button label={t('lockCancel')} variant="ghost" onPress={cancel} />
        </>
      ) : (
        <>
          <Title>{t('emailChangeTitle')}</Title>
          {data?.email && <P>{t('emailChangeCurrent', { email: data.email })}</P>}
          <P muted>{t('emailChangeIntro')}</P>
          <Field
            label={t('emailChangeNew')}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (error) setError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="send"
            maxLength={254}
            onSubmitEditing={() => valid && void send()}
            testID="email-change-input"
          />
          <Button
            label={t('emailChangeSend')}
            busy={busy}
            disabled={!valid}
            onPress={() => void send()}
            testID="email-change-send"
          />
          {error && <Banner tone="err">{error}</Banner>}
          <Button label={t('lockCancel')} variant="ghost" onPress={() => router.back()} />
        </>
      )}
    </Screen>
  );
}
