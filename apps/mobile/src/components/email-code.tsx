import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { CodeInput } from './code-input';
import { Field } from './form';
import { Banner, Button, P, Title } from './ui';

const RESEND_SECONDS = 60;

/**
 * E-mail → 6-digit code (AUTH.md). The text and the button both say „Code“ (P4); the code boxes fill
 * from the system's autofill and sign in by themselves once six digits are in (P17).
 */
export function EmailCode({
  emailTitle,
  emailIntro,
  error: outerError,
  onEmailStep,
}: {
  emailTitle: string;
  emailIntro: string;
  error?: string | null;
  /** Called with true while the e-mail is asked for, false on the code step. */
  onEmailStep?: (onEmail: boolean) => void;
}) {
  const { requestCode, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => onEmailStep?.(!sentTo), [sentTo, onEmailStep]);

  // „Code erneut senden“ only after 60 seconds.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

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

  const submit = async (value = code) => {
    if (!sentTo || !/^\d{6}$/.test(value) || busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await verifyCode(sentTo, value);
    } catch (e) {
      const why = e instanceof ApiError ? e.body?.error : undefined;
      setCode('');
      if (why === 'code_expired') {
        setExpired(true);
        setError(t('codeExpired'));
      } else setError(why === 'code_invalid' ? t('codeInvalid') : t('error'));
    } finally {
      setBusy(false);
    }
  };

  if (!sentTo)
    return (
      <>
        <Title>{emailTitle}</Title>
        <P muted>{emailIntro}</P>
        <Field
          label={t('email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => valid && void send(email)}
          testID="email"
        />
        <Button
          label={t('sendCode')}
          onPress={() => void send(email)}
          busy={busy}
          disabled={!valid}
          testID="send-code"
        />
        {(error ?? outerError) && <Banner tone="err">{error ?? outerError}</Banner>}
      </>
    );

  return (
    <>
      <Title>{t('codeTitle')}</Title>
      <P muted>{t('codeIntro', { email: sentTo })}</P>
      <CodeInput
        label={t('codeLabel')}
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={(v) => void submit(v)}
        error={Boolean(error)}
        testID="code"
      />
      <Button
        label={t('codeSubmit')}
        onPress={() => void submit()}
        busy={busy}
        disabled={code.length !== 6}
        testID="code-submit"
      />
      {info && <Banner tone="ok">{info}</Banner>}
      {error && <Banner tone="err">{error}</Banner>}
      {expired ? (
        <Button label={t('codeNew')} variant="secondary" onPress={() => void send(sentTo, true)} />
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
  );
}
