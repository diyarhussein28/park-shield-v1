'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Badge, Button, Checkbox, Field, Input, Notice, useI18n } from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { api, ApiError, errorText } from '@/lib/api-client';
import type { ChannelsOverview, Usage } from '@/lib/api-server';

type PhoneChannel = 'sms' | 'whatsapp';
type Message = { tone: 'success' | 'danger' | 'warning' | 'info'; text: string } | null;

const CHANNELS: PhoneChannel[] = ['sms', 'whatsapp'];

/**
 * The owner's mobile number (US-21, NT-07): typed once, confirmed with one code, then used for SMS
 * and/or WhatsApp. Nothing is pre-ticked: each channel is an explicit opt-in (Art. 6(1)(a) GDPR).
 * Only channels that are switched on (kill switch, AD-15) are offered.
 */
export function PhoneSetup({
  overview,
  usage,
  onChange,
  headingLevel = 2,
  embedded = false,
}: {
  overview: Pick<ChannelsOverview, 'sms' | 'whatsapp' | 'available'>;
  usage?: Usage;
  onChange: () => Promise<void>;
  headingLevel?: 2 | 3;
  /** Inside another card (the set-up guide): no own border and no visible title. */
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const H = `h${headingLevel}` as const;
  const linked: Record<PhoneChannel, ChannelsOverview['sms']> = {
    sms: overview.sms,
    whatsapp: overview.whatsapp,
  };
  const available = CHANNELS.filter((c) => overview.available[c]);
  const number = linked.sms?.phone ?? linked.whatsapp?.phone ?? null;
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [chosen, setChosen] = useState<Record<PhoneChannel, boolean>>({
    sms: false,
    whatsapp: false,
  });
  const [sent, setSent] = useState<{ phone: string; via: PhoneChannel } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const name = (channel: PhoneChannel) => t('channels.channelName', { channel });

  async function start(e?: FormEvent) {
    e?.preventDefault();
    setMessage(null);
    setPhoneError(null);
    const channels = available.filter((c) => chosen[c]);
    if (!channels.length) {
      setMessage({ tone: 'danger', text: t('channels.phoneChooseOne') });
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ phone: string; via: PhoneChannel }>('/v1/channels/phone', {
        body: { phone, channels, consent: true },
      });
      setSent(r);
      setCode('');
      if (!e) setMessage({ tone: 'info', text: t('channels.phoneResent') });
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'phone_invalid') {
        setPhoneError(t('channels.waPhoneInvalid'));
      } else setMessage({ tone: 'danger', text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api('/v1/channels/phone/verify', { body: { code: code.trim() } });
      setSent(null);
      setEditing(false);
      setPhone('');
      setChosen({ sms: false, whatsapp: false });
      await onChange();
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

  async function act(channel: PhoneChannel, on: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      if (on) await api('/v1/channels/phone/add', { body: { channel, consent: true } });
      else await api(`/v1/channels/${channel}`, { method: 'DELETE' });
      await onChange();
      setMessage({
        tone: 'success',
        text: t(on ? 'channels.phoneAdded' : 'channels.phoneRemoved', { channel: name(channel) }),
      });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  const form = sent ? (
    <form onSubmit={verify} className="flex flex-col gap-4">
      {/* The number as typed (only in this browser), so a typo is easy to spot. */}
      <Notice tone="info">
        {t('channels.phoneCodeSent', { phone: phone.trim() || sent.phone, via: sent.via })}{' '}
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
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className="max-w-sm"
          />
        )}
      </Field>
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 font-semibold">{t('channels.phoneHow')}</legend>
        {available.map((c) => (
          <Checkbox
            key={c}
            label={t(`channels.phoneVia_${c}` as MessageKey)}
            checked={chosen[c]}
            onChange={(e) => setChosen((s) => ({ ...s, [c]: e.target.checked }))}
          />
        ))}
        <p className="text-sm text-muted">{t('channels.phoneConsentNote')}</p>
      </fieldset>
      <Button type="submit" busy={busy} className="w-fit">
        {t('channels.phoneSendCode', {
          via: chosen.whatsapp && !chosen.sms ? 'whatsapp' : 'sms',
        })}
      </Button>
    </form>
  );

  return (
    <section
      aria-labelledby="phone-title"
      className={
        embedded ? 'min-w-0' : 'rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6'
      }
    >
      {embedded ? (
        // Inside the set-up guide the step title says it already: no second card.
        <>
          <H id="phone-title" className="sr-only">
            {t('channels.phoneTitle')}
          </H>
          <p className="text-muted">{t('channels.phoneIntro')}</p>
        </>
      ) : (
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-bg text-info-fg">
            <Icon name="phone" className="size-5" />
          </span>
          <div className="min-w-0">
            <H id="phone-title" className="text-xl font-bold tracking-tight">
              {t('channels.phoneTitle')}
            </H>
            <p className="mt-1 text-muted">{t('channels.phoneIntro')}</p>
          </div>
        </div>
      )}
      <div className={embedded ? 'mt-4 flex flex-col gap-4' : 'mt-5 flex flex-col gap-4'}>
        {available.length === 0 && !number ? (
          <p className="text-muted">{t('channels.phoneNoneAvailable')}</p>
        ) : number && !editing ? (
          <>
            <p className="text-lg font-semibold">{t('channels.phoneYours', { phone: number })}</p>
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {CHANNELS.filter((c) => linked[c] || overview.available[c]).map((c) => {
                const used = usage?.[c];
                return (
                  <li
                    key={c}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-2 font-semibold">
                        {name(c)}
                        <Badge tone={linked[c] ? 'success' : 'info'}>
                          {linked[c] ? t('channels.phoneOn') : t('channels.phoneOff')}
                        </Badge>
                      </span>
                      {linked[c] && used && used.limit > 0 && (
                        <span className="text-sm text-muted">
                          {t('channels.phoneUsage', { used: used.used, limit: used.limit })}
                        </span>
                      )}
                    </span>
                    {linked[c] ? (
                      <Button variant="ghost" onClick={() => act(c, false)} busy={busy}>
                        {t('channels.phoneRemove', { channel: name(c) })}
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => act(c, true)} busy={busy}>
                        {t('channels.phoneAdd', { channel: name(c) })}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <Button variant="ghost" className="w-fit" onClick={() => setEditing(true)}>
              {t('channels.phoneChange')}
            </Button>
          </>
        ) : (
          <>
            {form}
            {number && (
              <Button variant="ghost" className="w-fit" onClick={() => setEditing(false)}>
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
