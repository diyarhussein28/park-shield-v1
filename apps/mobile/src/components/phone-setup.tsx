import { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '@/lib/api';
import { errorText, type ChannelsOverview, type Usage } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';
import { Badge, Check, Field } from './form';
import { Banner, Button, Card, P, Title } from './ui';

type Message = { tone: 'ok' | 'err' | 'warn' | 'info'; text: string } | null;

/**
 * The owner's mobile number (NT-07, web: PhoneSetup): typed once, confirmed with one SMS code, then
 * used for SMS alerts (PREMIUM). Nothing is pre-ticked: SMS is an explicit opt-in. Only offered while
 * SMS is switched on (kill switch).
 */
export function PhoneSetup({
  overview,
  usage,
  onChange,
}: {
  overview: Pick<ChannelsOverview, 'sms' | 'available'>;
  usage?: Usage;
  onChange: () => Promise<void>;
}) {
  const number = overview.sms?.phone ?? null;
  const available = overview.available.sms;
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [chosen, setChosen] = useState(false);
  const [sent, setSent] = useState<{ phone: string; via: 'sms' } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const name = pt('channels.channelName', { channel: 'sms' });

  const start = async (resend = false) => {
    setMessage(null);
    setPhoneError(null);
    if (!chosen) {
      setMessage({ tone: 'err', text: pt('channels.phoneChooseOne', { whatsapp: 'no' }) });
      return;
    }
    setBusy(true);
    try {
      setSent(
        await api<{ phone: string; via: 'sms' }>('/v1/channels/phone', {
          body: { phone, channels: ['sms'], consent: true },
        }),
      );
      setCode('');
      if (resend) setMessage({ tone: 'info', text: pt('channels.phoneResent') });
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'phone_invalid')
        setPhoneError(pt('channels.waPhoneInvalid'));
      else setMessage({ tone: 'err', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api('/v1/channels/phone/verify', { body: { code: code.trim() } });
      setSent(null);
      setEditing(false);
      setPhone('');
      setChosen(false);
      await onChange();
      setMessage({ tone: 'ok', text: pt('channels.phoneLinkedNow') });
    } catch (err) {
      const body =
        err instanceof ApiError
          ? (err.body as { error?: string; attemptsLeft?: number } | null)
          : null;
      if (body?.error === 'code_wrong') {
        setMessage({
          tone: 'err',
          text: pt('channels.waCodeWrong', { left: body.attemptsLeft ?? 0 }),
        });
        if (!body.attemptsLeft) setSent(null);
      } else if (body?.error === 'code_expired') {
        setMessage({ tone: 'err', text: pt('channels.waCodeExpired') });
        setSent(null);
      } else setMessage({ tone: 'err', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api('/v1/channels/sms', { method: 'DELETE' });
      await onChange();
      setMessage({ tone: 'ok', text: pt('channels.phoneRemoved', { channel: name }) });
    } catch (err) {
      setMessage({ tone: 'err', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const form = sent ? (
    <View style={{ gap: 12 }}>
      <Banner tone="info">
        {`${pt('channels.phoneCodeSent', { phone: phone.trim() || sent.phone, via: sent.via })} ${pt('channels.phoneCheckNumber')}`}
      </Banner>
      <Field
        label={pt('channels.waCode')}
        hint={pt('channels.phoneCodeHint')}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
      />
      <Button
        label={pt('channels.waVerify')}
        busy={busy}
        disabled={code.length !== 6}
        onPress={() => void verify()}
      />
      <Button
        label={pt('channels.phoneResend')}
        variant="secondary"
        busy={busy}
        onPress={() => void start(true)}
      />
      <Button
        label={pt('channels.waOtherNumber')}
        variant="secondary"
        onPress={() => setSent(null)}
      />
    </View>
  ) : (
    <View style={{ gap: 12 }}>
      <Field
        label={pt('channels.waPhone')}
        hint={pt('channels.waPhoneHint')}
        error={phoneError}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        maxLength={30}
      />
      <Check label={pt('channels.phoneVia_sms')} checked={chosen} onChange={setChosen} />
      <P muted>{pt('channels.phoneConsentNote')}</P>
      <Button
        label={pt('channels.phoneSendCode', { via: 'sms' })}
        busy={busy}
        disabled={phone.trim().length < 6}
        onPress={() => void start()}
      />
    </View>
  );

  return (
    <Card>
      <Title>{pt('channels.phoneTitle')}</Title>
      <P muted>{pt('channels.phoneIntro')}</P>
      {!available && !number ? (
        <P muted>{pt('channels.phoneNoneAvailable')}</P>
      ) : number && !editing ? (
        <>
          <P style={{ fontWeight: '700' }}>{pt('channels.phoneYours', { phone: number })}</P>
          <View style={{ gap: 6 }}>
            <Badge tone="ok">{`${name}: ${pt('channels.phoneOn')}`}</Badge>
            {usage && usage.sms.limit > 0 && (
              <P muted>
                {pt('channels.phoneUsage', { used: usage.sms.used, limit: usage.sms.limit })}
              </P>
            )}
          </View>
          <Button
            label={pt('channels.phoneRemove', { channel: name })}
            variant="secondary"
            busy={busy}
            onPress={() => void remove()}
          />
          <Button
            label={pt('channels.phoneChange')}
            variant="secondary"
            onPress={() => setEditing(true)}
          />
        </>
      ) : (
        <>
          {form}
          {number && (
            <Button
              label={pt('common.cancel')}
              variant="secondary"
              onPress={() => setEditing(false)}
            />
          )}
        </>
      )}
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
    </Card>
  );
}
