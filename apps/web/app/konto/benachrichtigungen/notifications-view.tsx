'use client';

import {
  Button,
  Card,
  Checkbox,
  Container,
  Field,
  Heading,
  Input,
  Notice,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api, ApiError, errorText } from '@/lib/api-client';
import type {
  ChannelsOverview,
  OrderableChannel,
  PushDevice,
  QuietHours,
  Usage,
} from '@/lib/api-server';
import { QuietHoursCard } from './quiet-hours';
import { useBrowserValue } from '@/lib/use-browser-value';

type Message = { tone: 'success' | 'danger' | 'warning'; text: string } | null;

export function NotificationsView({
  initial,
  quiet,
  usage,
}: {
  initial: ChannelsOverview;
  quiet: QuietHours;
  usage: Usage;
}) {
  const { t } = useI18n();
  const [data, setData] = useState(initial);
  const reload = async () => setData(await api<ChannelsOverview>('/v1/channels'));

  return (
    <PageShell>
      <Container className="py-10">
        <Stack gap={6}>
          <div>
            <Link href="/konto" className="text-primary underline">
              {t('channels.toAccount')}
            </Link>
            <Heading level={1} className="mt-2">
              {t('channels.title')}
            </Heading>
            <Text muted>{t('channels.intro')}</Text>
          </div>
          <PushCard publicKey={data.push.publicKey} devices={data.push.devices} reload={reload} />
          <WhatsAppCard linked={data.whatsapp} reload={reload} usage={usage.whatsapp} />
          <Card>
            <Stack gap={2}>
              <Heading level={2} className="text-xl">
                {t('channels.emailTitle')}
              </Heading>
              <Text>{t('channels.emailText', { email: data.email.address })}</Text>
            </Stack>
          </Card>
          <OrderCard
            order={data.order}
            setUp={{
              webpush: data.push.devices.length > 0,
              email: true,
              whatsapp: Boolean(data.whatsapp),
            }}
            onSaved={(order) => setData((d) => ({ ...d, order }))}
          />
          <QuietHoursCard initial={quiet} />
        </Stack>
      </Container>
    </PageShell>
  );
}

/** US-22 / OW-05: the order normal alerts follow. Up/down buttons rather than drag and drop (a11y). */
function OrderCard({
  order,
  setUp,
  onSaved,
}: {
  order: OrderableChannel[];
  setUp: Record<OrderableChannel, boolean>;
  onSaved: (order: OrderableChannel[]) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<string | null>(null);
  const name = (channel: OrderableChannel) => t('channels.channelName', { channel });

  async function move(index: number, by: -1 | 1) {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    setStatus(null);
    try {
      const saved = await api<{ order: OrderableChannel[] }>('/v1/channels/order', {
        method: 'PUT',
        body: { order: next },
      });
      onSaved(saved.order);
      setStatus(t('channels.orderSaved'));
    } catch (err) {
      setStatus(errorText(err, t));
    }
  }

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('channels.orderTitle')}
        </Heading>
        <Text>{t('channels.orderIntro')}</Text>
        <ol className="flex flex-col gap-2" aria-label={t('channels.orderTitle')}>
          {order.map((c, i) => (
            <li
              key={c}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-2"
            >
              <span>
                <span className="font-semibold">
                  {i + 1}. {name(c)}
                </span>
                {!setUp[c] && <span className="text-muted"> ({t('channels.orderNotSetUp')})</span>}
              </span>
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={t('channels.orderUp', { channel: name(c) })}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={t('channels.orderDown', { channel: name(c) })}
                >
                  ↓
                </Button>
              </span>
            </li>
          ))}
        </ol>
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
        <Text muted className="text-sm">
          {t('channels.orderUrgent')}
        </Text>
      </Stack>
    </Card>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function PushCard({
  publicKey,
  devices,
  reload,
}: {
  publicKey: string;
  devices: PushDevice[];
  reload: () => Promise<void>;
}) {
  const { t } = useI18n();
  const supported = useBrowserValue(pushSupported, true);
  const ios = useBrowserValue(isIos, false);
  const standalone = useBrowserValue(isStandalone, false);
  const [here, setHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    if (!pushSupported()) return;
    void navigator.serviceWorker
      .getRegistration('/')
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setHere(Boolean(sub)))
      .catch(() => setHere(false));
  }, [devices]);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage({ tone: 'warning', text: t('channels.pushDenied') });
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const json = sub.toJSON();
      await api('/v1/push-subscriptions', {
        body: { endpoint: json.endpoint, keys: json.keys },
      });
      await reload();
      setHere(true);
      setMessage({ tone: 'success', text: t('channels.pushAdded') });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/v1/push-subscriptions/${id}`, { method: 'DELETE' });
    await reload();
  }

  const deviceText = (d: PushDevice) =>
    d.label ??
    t('channels.pushDevice', { platform: d.platform ?? 'desktop', date: new Date(d.createdAt) });

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('channels.pushTitle')}
        </Heading>
        <Text>{t('channels.pushIntro')}</Text>

        {ios && !standalone ? (
          <IosGuide />
        ) : !supported ? (
          <Text muted>{ios ? t('channels.iosOld') : t('channels.pushUnsupported')}</Text>
        ) : here ? (
          <Notice tone="success">{t('channels.pushEnabledHere')}</Notice>
        ) : (
          <Button onClick={enable} busy={busy} className="w-fit">
            {t('channels.pushEnable')}
          </Button>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <Heading level={3} className="text-lg">
          {t('channels.pushDevices')}
        </Heading>
        {devices.length === 0 ? (
          <Text muted>{t('channels.pushNoDevices')}</Text>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t('channels.pushDevices')}>
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{deviceText(d)}</span>
                <Button
                  variant="ghost"
                  onClick={() => remove(d.id)}
                  aria-label={t('channels.pushRemoveLabel', { device: deviceText(d) })}
                >
                  {t('channels.pushRemove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Stack>
    </Card>
  );
}

function IosGuide() {
  const { t } = useI18n();
  return (
    <Notice tone="info" title={t('channels.iosTitle')}>
      <p className="mb-2">{t('channels.iosIntro')}</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>{t('channels.iosStep1')}</li>
        <li>{t('channels.iosStep2')}</li>
        <li>{t('channels.iosStep3')}</li>
        <li>{t('channels.iosStep4')}</li>
      </ol>
    </Notice>
  );
}

function WhatsAppCard({
  linked,
  reload,
  usage,
}: {
  linked: ChannelsOverview['whatsapp'];
  reload: () => Promise<void>;
  usage: Usage['whatsapp'];
}) {
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  async function start(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setPhoneError(null);
    if (!consent) {
      setMessage({ tone: 'danger', text: t('channels.waConsentRequired') });
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ phone: string }>('/v1/channels/whatsapp', {
        body: { phone, consent: true },
      });
      setSentTo(r.phone);
      setCode('');
    } catch (err) {
      if (err instanceof ApiError && (err.body?.error === 'phone_invalid' || err.status === 400)) {
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
      await api('/v1/channels/whatsapp/verify', { body: { code: code.trim() } });
      setSentTo(null);
      setPhone('');
      setConsent(false);
      await reload();
      setMessage({ tone: 'success', text: t('channels.waLinkedNow') });
    } catch (err) {
      const body =
        err instanceof ApiError ? (err.body as { error?: string; attemptsLeft?: number }) : null;
      if (body?.error === 'code_wrong') {
        setMessage({
          tone: 'danger',
          text: t('channels.waCodeWrong', { left: body.attemptsLeft ?? 0 }),
        });
        if (!body.attemptsLeft) setSentTo(null);
      } else if (body?.error === 'code_expired') {
        setMessage({ tone: 'danger', text: t('channels.waCodeExpired') });
        setSentTo(null);
      } else setMessage({ tone: 'danger', text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await api('/v1/channels/whatsapp', { method: 'DELETE' });
      await reload();
      setMessage({ tone: 'success', text: t('channels.waUnlinked') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('channels.waTitle')}
        </Heading>
        <Text>{t('channels.waIntro')}</Text>
        {linked && usage.limit > 0 && (
          <Text muted className="text-sm">
            {t('channels.waUsage', usage)}
          </Text>
        )}
        {linked ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text className="font-semibold">{t('channels.waLinked', { phone: linked.phone })}</Text>
            <Button variant="secondary" onClick={unlink} busy={busy}>
              {t('channels.waUnlink')}
            </Button>
          </div>
        ) : sentTo ? (
          <form onSubmit={verify} className="flex flex-col gap-4">
            <Notice tone="info">{t('channels.waCodeSent', { phone: sentTo })}</Notice>
            <Field label={t('channels.waCode')}>
              {({ id }) => (
                <Input
                  id={id}
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" busy={busy}>
                {t('channels.waVerify')}
              </Button>
              <Button variant="ghost" onClick={() => setSentTo(null)}>
                {t('channels.waOtherNumber')}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={start} className="flex flex-col gap-4">
            <Field
              label={t('channels.waPhone')}
              hint={t('channels.waPhoneHint')}
              error={phoneError}
            >
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
                />
              )}
            </Field>
            <Checkbox
              label={t('channels.waConsent')}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <Button type="submit" busy={busy} className="w-fit">
              {t('channels.waSendCode')}
            </Button>
          </form>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </Stack>
    </Card>
  );
}
