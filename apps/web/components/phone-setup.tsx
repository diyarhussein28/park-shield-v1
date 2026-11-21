'use client';

import { Badge, Button, Field, Input, Notice, useI18n } from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { api, ApiError, errorText } from '@/lib/api-client';
import type { Usage } from '@/lib/api-server';

type Message = { tone: 'success' | 'danger' | 'warning' | 'info'; text: string } | null;

/**
 * The owner's mobile number (required since 2026-11-21): typed once, confirmed with one SMS code and
 * used only for the single escalation SMS after 30 minutes without a reaction. It can be changed (the
 * new number applies once its code is confirmed), never removed; account deletion removes it.
 * The API accepts mobile numbers from the allowed countries only (`phone_not_mobile`, `phone_country`).
 */
export function PhoneSetup({
  phone,
  usage,
  onVerified,
  headingLevel = 2,
  embedded = false,
}: {
  /** The verified number, masked by the API; null while none is verified. */
  phone: string | null;
  usage?: Usage;
  onVerified: () => Promise<void> | void;
  headingLevel?: 2 | 3;
  /** Inside another card (set-up guide, checkout): no own border and no visible title. */
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const H = `h${headingLevel}` as const;
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  async function start(e?: FormEvent) {
    e?.preventDefault();
    setMessage(null);
    setPhoneError(null);
    setBusy(true);
    try {
      // TODO [LEGAL REVIEW] legal basis of the required number (contract performance, Art. 6(1)(b)
      // GDPR); the purpose is shown next to the field (channels.phonePrivacy).
      const r = await api<{ phone: string }>('/v1/channels/sms', {
        body: { phone: input, consent: true },
      });
      setSent(r.phone);
      setCode('');
      if (!e) setMessage({ tone: 'info', text: t('channels.phoneResent') });
    } catch (err) {
      const error = err instanceof ApiError ? err.body?.error : undefined;
      if (error === 'phone_invalid') setPhoneError(t('channels.waPhoneInvalid'));
      else if (error === 'phone_not_mobile') setPhoneError(t('channels.phoneNotMobile'));
      else if (error === 'phone_country') setPhoneError(t('channels.phoneCountry'));
      else if (error === 'channel_unavailable')
        setMessage({ tone: 'warning', text: t('channels.phoneNoneAvailable') });
      else setMessage({ tone: 'danger', text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api('/v1/channels/sms/verify', { body: { code: code.trim() } });
      setSent(null);
      setEditing(false);
      setInput('');
      await onVerified();
      setMessage({ tone: 'success', text: t('channels.phoneLinkedNow') });
    } catch (err) {
      const body =
        err instanceof ApiError ? (err.body as { error?: string; attemptsLeft?: number }) : null;
      if (body?.error === 'code_wrong') {
        setMessage({
          tone: 'danger',
          text: t('channels.waCodeWrong', { left: body.attemptsLeft ?? 0 }),
        });
        if (!body.attemptsLeft) setSent(null);
      } else if (body?.error === 'code_expired') {
        setMessage({ tone: 'danger', text: t('channels.waCodeExpired') });
        setSent(null);
      } else setMessage({ tone: 'danger', text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const form = sent ? (
    <form onSubmit={verify} className="flex flex-col gap-4">
      {/* The number as typed (only in this browser), so a typo is easy to spot. */}
      <Notice tone="info">
        {t('channels.phoneCodeSent', { phone: input.trim() || sent })}{' '}
        {t('channels.phoneCheckNumber')}
      </Notice>
      <Field label={t('channels.waCode')} hint={t('channels.phoneCodeHint')}>
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
        <Button type="submit" busy={busy}>
          {t('channels.waVerify')}
        </Button>
        <Button variant="ghost" onClick={() => void start()} busy={busy}>
          {t('channels.phoneResend')}
        </Button>
        <Button variant="ghost" onClick={() => setSent(null)}>
          {t('channels.waOtherNumber')}
        </Button>
      </div>
    </form>
  ) : (
    <form onSubmit={start} className="flex flex-col gap-4">
      <Field label={t('channels.waPhone')} hint={t('channels.waPhoneHint')} error={phoneError}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            required
            type="tel"
            autoComplete="tel"
            maxLength={30}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className="max-w-sm"
          />
        )}
      </Field>
      {phone && <p className="text-sm text-muted">{t('channels.phoneChangeHint')}</p>}
      {/* TODO [LEGAL REVIEW] privacy notice for the mobile number (purpose: escalation SMS). */}
      <p className="text-sm text-muted">{t('channels.phonePrivacy')}</p>
      <Button type="submit" busy={busy} className="w-fit">
        {t('channels.phoneSendCode')}
      </Button>
    </form>
  );

  const sms = usage?.sms;
  return (
    <section
      aria-labelledby="phone-title"
      className={
        embedded ? 'min-w-0' : 'rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6'
      }
    >
      {embedded ? (
        // Inside another card the surrounding title says it already: no second visible heading.
        <>
          <H id="phone-title" className="sr-only">
            {t('channels.phoneMandatoryTitle')}
          </H>
          <p className="text-muted">{t('channels.phoneRequiredIntro')}</p>
        </>
      ) : (
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-bg text-info-fg">
            <Icon name="phone" className="size-5" />
          </span>
          <div className="min-w-0">
            <H id="phone-title" className="text-xl font-bold tracking-tight">
              {t('channels.phoneMandatoryTitle')}
            </H>
            <p className="mt-1 text-muted">{t('channels.phonePurpose')}</p>
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-4">
        {phone && !editing ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-lg font-semibold wrap-anywhere">
                {t('channels.phoneYours', { phone })}
              </p>
              <Badge tone="success">{t('channels.phoneVerified')}</Badge>
            </div>
            {sms && sms.limit > 0 && (
              <p className="text-sm text-muted">
                {t('channels.phoneUsage', { used: sms.used, limit: sms.limit })}
              </p>
            )}
            {sms?.capReached && (
              <Notice tone="warning">
                {t('channels.smsCapReached', { used: sms.used, limit: sms.limit })}
              </Notice>
            )}
            <Button variant="secondary" className="w-fit" onClick={() => setEditing(true)}>
              {t('channels.phoneChangeNumber')}
            </Button>
          </>
        ) : (
          <>
            {form}
            {phone && (
              <Button
                variant="ghost"
                className="w-fit"
                onClick={() => {
                  setEditing(false);
                  setSent(null);
                }}
              >
                {t('common.cancel')}
              </Button>
            )}
          </>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </div>
    </section>
  );
}
