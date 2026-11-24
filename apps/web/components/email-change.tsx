'use client';

import { Button, Field, Input, Notice, useI18n } from '@parkshield/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Section } from '@/components/konto-shell';
import { api, ApiError, errorText } from '@/lib/api-client';

type Message = { tone: 'success' | 'danger' | 'info'; text: string } | null;

/**
 * Konto → „E-Mail-Adresse ändern“ on the website, the same flow as the app's
 * `apps/mobile/src/app/email-aendern.tsx` (API `apps/api/src/profile/email-change.service.ts`):
 * a 6-digit code goes to the new address; the account keeps the old address (and signs in with it)
 * until the code is confirmed here. The old address then gets a security notice and Stripe receipts
 * go to the new one.
 */
export function EmailChange({ email }: { email: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [current, setCurrent] = useState(email);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  function explain(err: unknown): string {
    const body =
      err instanceof ApiError ? (err.body as { error?: string; attemptsLeft?: number }) : null;
    switch (body?.error) {
      case 'email_taken':
        return t('account.emailTaken');
      case 'email_unchanged':
        return t('account.emailUnchanged');
      case 'invalid_request':
        return t('account.emailInvalid');
      case 'code_wrong':
        return t('account.emailCodeWrong', { left: body.attemptsLeft ?? 0 });
      case 'code_expired':
        return t('account.emailCodeExpired');
      default:
        return errorText(err, t);
    }
  }

  async function start(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMessage(null);
    setInputError(null);
    try {
      const r = await api<{ email: string }>('/v1/me/email/change', {
        body: { email: input.trim() },
      });
      setSentTo(r.email);
      setCode('');
      if (!e) setMessage({ tone: 'info', text: t('account.emailResent') });
    } catch (err) {
      const why = err instanceof ApiError ? err.body?.error : undefined;
      if (why === 'email_taken' || why === 'email_unchanged' || why === 'invalid_request')
        setInputError(explain(err));
      else setMessage({ tone: 'danger', text: explain(err) });
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ email: string }>('/v1/me/email/change/verify', {
        body: { code: code.trim() },
      });
      setCurrent(r.email);
      setSentTo(null);
      setEditing(false);
      setInput('');
      setMessage({ tone: 'success', text: t('account.emailDone', { email: r.email }) });
      router.refresh();
    } catch (err) {
      const why = err instanceof ApiError ? err.body?.error : undefined;
      setCode('');
      if (why === 'code_expired' || why === 'email_taken') setSentTo(null);
      setMessage({ tone: 'danger', text: explain(err) });
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (sentTo) void api('/v1/me/email/change', { method: 'DELETE' }).catch(() => undefined);
    setEditing(false);
    setSentTo(null);
    setInput('');
    setCode('');
    setMessage(null);
    setInputError(null);
  }

  return (
    <Section title={t('account.emailTitle')} icon="mail" intro={t('account.emailIntro')}>
      {!editing ? (
        <>
          <p className="text-lg font-semibold wrap-anywhere" data-testid="account-email">
            {t('account.emailYours', { email: current })}
          </p>
          <Button variant="secondary" className="w-fit" onClick={() => setEditing(true)}>
            {t('account.emailChange')}
          </Button>
        </>
      ) : sentTo ? (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <Notice tone="info">
            <span className="wrap-anywhere">{t('account.emailCodeSent', { email: sentTo })}</span>
          </Notice>
          <Field label={t('account.emailCode')}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                aria-describedby={describedBy}
                className="max-w-48 text-center text-2xl tracking-[0.3em]"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" busy={busy} disabled={code.length !== 6}>
              {t('account.emailConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => void start()} busy={busy}>
              {t('account.emailResend')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSentTo(null);
                setMessage(null);
              }}
            >
              {t('account.emailOther')}
            </Button>
            <Button variant="ghost" onClick={cancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={start} className="flex flex-col gap-4">
          <p className="text-muted">{t('account.emailChangeIntro')}</p>
          <Field label={t('account.emailNew')} error={inputError}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                required
                type="email"
                autoComplete="email"
                maxLength={254}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (inputError) setInputError(null);
                }}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                className="max-w-sm"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" busy={busy}>
              {t('account.emailSend')}
            </Button>
            <Button variant="ghost" onClick={cancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </Section>
  );
}
