import { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { errorText, type Usage } from '@/lib/portal';
import { CodeInput } from './code-input';
import { Badge, Field } from './form';
import { Banner, Button, Card, P, Title } from './ui';

type Message = { tone: 'ok' | 'err' | 'info'; text: string } | null;

/** The API's phone errors in plain words (apps/api/src/channels/channels.service.ts). */
function phoneError(err: unknown): string {
  const body =
    err instanceof ApiError ? (err.body as { error?: string; attemptsLeft?: number } | null) : null;
  switch (body?.error) {
    case 'phone_invalid':
      return t('phoneInvalid');
    case 'phone_not_mobile':
      return t('phoneNotMobile');
    case 'phone_country':
      return t('phoneCountry');
    case 'channel_unavailable':
      return t('phoneUnavailable');
    case 'code_wrong':
      return t('phoneCodeWrong', { left: body.attemptsLeft ?? 0 });
    case 'code_expired':
      return t('phoneCodeExpired');
    default:
      return errorText(err);
  }
}

/**
 * The owner's mobile number (required since 2026-11-21: one SMS when an alert gets no reaction for 30
 * minutes): typed once, confirmed with a 6-digit SMS code. Used in the sign-up, in the blocking
 * „Konto vervollständigen“ and for „Nummer ändern“: the number only changes once the new one is
 * confirmed (the API keeps the old one until then; it can never just be removed).
 */
export function PhoneVerify({
  onVerified,
  onCancel,
}: {
  onVerified: () => Promise<void> | void;
  onCancel?: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const start = async (resend = false) => {
    setBusy(true);
    setMessage(null);
    try {
      // The number is part of the contract (escalation SMS); the API still wants the explicit flag.
      const r = await api<{ phone?: string }>('/v1/channels/phone', {
        body: { phone: phone.trim(), channels: ['sms'], consent: true },
      });
      setSent(r?.phone ?? phone.trim());
      setCode('');
      if (resend) setMessage({ tone: 'info', text: t('phoneResent') });
    } catch (err) {
      setMessage({ tone: 'err', text: phoneError(err) });
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
      setBusy(false);
      await onVerified();
      return;
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string } | null) : null;
      setCode('');
      if (body?.error === 'code_expired') setSent(null);
      setMessage({ tone: 'err', text: phoneError(err) });
    }
    setBusy(false);
  };

  return (
    <View style={{ gap: 12 }}>
      {sent ? (
        <>
          <Banner tone="info">{t('phoneCodeSent', { phone: sent })}</Banner>
          <CodeInput
            label={t('signUpPhoneCode')}
            value={code}
            onChange={setCode}
            onComplete={(v) => void verify(v)}
            error={message?.tone === 'err'}
            testID="phone-code"
          />
          <Button
            label={t('phoneVerify')}
            busy={busy}
            disabled={code.length !== 6}
            onPress={() => void verify()}
            testID="phone-verify"
          />
          <Button
            label={t('phoneResend')}
            variant="secondary"
            disabled={busy}
            onPress={() => void start(true)}
          />
          <Button label={t('phoneOther')} variant="ghost" onPress={() => setSent(null)} />
        </>
      ) : (
        <>
          <Field
            label={t('signUpPhoneLabel')}
            hint={t('phoneHint')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={30}
            testID="phone"
          />
          {/* TODO [LEGAL REVIEW] purpose of the mobile number (escalation SMS) and privacy note. */}
          <P muted>{t('phonePrivacy')}</P>
          <Button
            label={t('signUpPhoneSend')}
            busy={busy}
            disabled={phone.trim().length < 6}
            onPress={() => void start()}
            testID="phone-send"
          />
        </>
      )}
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      {onCancel && <Button label={t('lockCancel')} variant="ghost" onPress={onCancel} />}
    </View>
  );
}

/**
 * „Handynummer“ on the notification settings: the verified number (masked), when the SMS comes, the
 * monthly SMS cap, and „Nummer ändern“ (a new code each time). Without a number (old accounts) the
 * form is shown at once.
 */
export function PhoneCard({
  phone,
  usage,
  onChanged,
}: {
  phone: string | null;
  usage?: Usage;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const sms = usage?.sms;
  const capReached = Boolean(sms && (sms.capReached ?? (sms.limit > 0 && sms.used >= sms.limit)));
  return (
    <Card>
      <Title>{t('phoneTitle')}</Title>
      {phone && !editing ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <P style={{ fontWeight: '700' }}>{phone}</P>
            <Badge tone="ok">{t('phoneVerified')}</Badge>
          </View>
          <P muted>{t('phoneSmsRule')}</P>
          {sms && sms.limit > 0 && !capReached && (
            <P muted>{t('smsUsage', { used: sms.used, limit: sms.limit })}</P>
          )}
          {capReached && sms && (
            <Banner tone="warn" testID="sms-cap">
              {t('smsCapReached', { used: sms.used, limit: sms.limit })}
            </Banner>
          )}
          {saved && <Banner tone="ok">{t('phoneSaved')}</Banner>}
          <Button
            label={t('phoneChange')}
            variant="secondary"
            onPress={() => {
              setSaved(false);
              setEditing(true);
            }}
            testID="phone-change"
          />
        </>
      ) : (
        <>
          {phone ? (
            <P muted>{t('phoneChangeHint')}</P>
          ) : (
            <>
              <Banner tone="warn">{t('phoneMissing')}</Banner>
              <P muted>{t('phoneIntro')}</P>
            </>
          )}
          <PhoneVerify
            onVerified={async () => {
              await onChanged();
              setEditing(false);
              setSaved(true);
            }}
            onCancel={phone ? () => setEditing(false) : undefined}
          />
        </>
      )}
    </Card>
  );
}
