'use client';

import {
  Badge,
  Button,
  Card,
  Field,
  Heading,
  Input,
  Notice,
  Select,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { KontoShell } from '@/components/konto-shell';
import { api, ApiError, errorText } from '@/lib/api-client';
import type { EmergencyContact, EmergencyContactList } from '@/lib/api-server';

const PLAN_LABEL: Record<string, string> = { plus: 'Plus', premium: 'Premium' };

export function ContactsView({
  initial,
  vehicles,
  plan,
}: {
  initial: EmergencyContactList;
  vehicles: { id: string; nickname: string }[];
  plan: 'plus' | 'premium' | null;
}) {
  const { t } = useI18n();
  const [data, setData] = useState(initial);
  // Lives here, not in the form: after the last allowed invitation the form is replaced.
  const [invited, setInvited] = useState<string | null>(null);
  const active = data.contacts.filter((c) => c.status === 'pending' || c.status === 'confirmed');

  async function remove(id: string) {
    await api(`/v1/emergency-contacts/${id}`, { method: 'DELETE' });
    setData(await api<EmergencyContactList>('/v1/emergency-contacts'));
  }

  return (
    <KontoShell title={t('contacts.title')} intro={t('contacts.intro')}>
      <div>
        <Text muted className="mt-2 text-sm">
          {t('contacts.howItWorks')}
        </Text>
      </div>

      {data.contacts.length === 0 ? (
        <Text>{t('contacts.none')}</Text>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label={t('contacts.title')}>
          {data.contacts.map((c) => (
            <li key={c.id}>
              <ContactCard contact={c} onRemove={() => remove(c.id)} />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <Stack gap={4}>
          <Heading level={2} className="text-xl">
            {t('contacts.addTitle')}
          </Heading>
          {invited && <Notice tone="success">{t('contacts.invited', { name: invited })}</Notice>}
          {!plan ? (
            <Notice tone="info">{t('contacts.noSubscription')}</Notice>
          ) : plan !== 'premium' ? (
            // Trusted contacts and escalation are PREMIUM only.
            <Notice tone="info">{t('contacts.premiumOnly')}</Notice>
          ) : active.length >= data.limit ? (
            <Notice tone="info">
              {t('contacts.limitReached', {
                plan: PLAN_LABEL[plan] ?? plan,
                limit: data.limit,
              })}
            </Notice>
          ) : (
            <InviteForm
              vehicles={vehicles}
              ownerName={data.ownerName ?? ''}
              onInvited={(d, name) => {
                setData(d);
                setInvited(name);
              }}
            />
          )}
        </Stack>
      </Card>

      {plan === 'premium' && (
        <>
          <EscalationCard
            enabled={data.escalationEnabled}
            confirmed={data.contacts.some((c) => c.status === 'confirmed')}
          />
          <DelayCard
            value={data.escalationMinutes}
            defaultMinutes={data.defaultEscalationMinutes}
          />
        </>
      )}
    </KontoShell>
  );
}

/** Escalation on/off (PREMIUM). Off until the owner switches it on, also after a contact confirmed. */
function EscalationCard({ enabled, confirmed }: { enabled: boolean; confirmed: boolean }) {
  const { t } = useI18n();
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOn(enabled), [enabled]);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ enabled: boolean }>('/v1/escalation', {
        method: 'PUT',
        body: { enabled: !on },
      });
      setOn(r.enabled);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('contacts.escalationTitle')}
        </Heading>
        <Text>{on ? t('contacts.escalationOn') : t('contacts.escalationOff')}</Text>
        {!on && confirmed && <Notice tone="info">{t('contacts.escalationSuggest')}</Notice>}
        <Button
          variant={on ? 'secondary' : 'primary'}
          className="w-fit"
          busy={busy}
          aria-pressed={on}
          onClick={() => void toggle()}
        >
          {on ? t('contacts.escalationDisable') : t('contacts.escalationEnable')}
        </Button>
        {error && <Notice tone="danger">{error}</Notice>}
      </Stack>
    </Card>
  );
}

const DELAYS = [3, 5, 7, 10, 15, 20, 30];

/** OW-07: how long we wait for the owner before the emergency contact is told (3–30 min). */
function DelayCard({ value, defaultMinutes }: { value: number | null; defaultMinutes: number }) {
  const { t } = useI18n();
  const [minutes, setMinutes] = useState(value === null ? '' : String(value));
  const [status, setStatus] = useState<string | null>(null);

  async function save(next: string) {
    setMinutes(next);
    setStatus(null);
    try {
      await api('/v1/me', {
        method: 'PATCH',
        body: { escalationMinutes: next === '' ? null : Number(next) },
      });
      setStatus(t('contacts.delaySaved'));
    } catch (err) {
      setStatus(errorText(err, t));
    }
  }

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('contacts.delayTitle')}
        </Heading>
        <Field label={t('contacts.delayLabel')}>
          {({ id }) => (
            <Select
              id={id}
              className="max-w-xs"
              value={minutes}
              onChange={(e) => void save(e.target.value)}
            >
              <option value="">{t('contacts.delayDefault', { minutes: defaultMinutes })}</option>
              {DELAYS.map((d) => (
                <option key={d} value={d}>
                  {t('contacts.delayOption', { minutes: d })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      </Stack>
    </Card>
  );
}

function ContactCard({
  contact: c,
  onRemove,
}: {
  contact: EmergencyContact;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <Card className="flex h-full flex-col gap-2">
      <Heading level={2} className="text-xl">
        {c.name}
      </Heading>
      <Text muted>
        {[c.phone, c.email].filter(Boolean).join(' · ')} ·{' '}
        {c.vehicleNickname
          ? t('contacts.forVehicle', { nickname: c.vehicleNickname })
          : t('contacts.allVehicles')}
      </Text>
      <Badge
        className="w-fit"
        tone={c.status === 'confirmed' ? 'success' : c.status === 'pending' ? 'info' : 'warning'}
      >
        {c.status === 'confirmed'
          ? t('contacts.statusConfirmed')
          : c.status === 'pending'
            ? t('contacts.statusPending', { date: new Date(c.expiresAt!) })
            : c.status === 'deactivated'
              ? t('contacts.statusDeactivated', { date: new Date(c.expiresAt!) })
              : t('contacts.statusDeclined')}
      </Badge>
      <Button
        variant="ghost"
        className="mt-auto w-fit px-0"
        onClick={onRemove}
        aria-label={t('contacts.removeLabel', { name: c.name })}
      >
        {t('contacts.remove')}
      </Button>
    </Card>
  );
}

function InviteForm({
  vehicles,
  ownerName,
  onInvited,
}: {
  vehicles: { id: string; nickname: string }[];
  ownerName: string;
  onInvited: (d: EmergencyContactList, name: string) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', phone: '', email: '', vehicleId: '', ownerName });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const data = await api<EmergencyContactList>('/v1/emergency-contacts', {
        body: {
          name: form.name,
          phone: form.phone,
          ...(form.email.trim() ? { email: form.email.trim() } : {}),
          ownerName: form.ownerName,
          vehicleId: form.vehicleId || null,
        },
      });
      const name = form.name;
      setForm((f) => ({ ...f, name: '', phone: '', email: '', vehicleId: '' }));
      onInvited(data, name);
    } catch (err) {
      const code = err instanceof ApiError ? err.body?.error : undefined;
      setMessage(
        code === 'contact_exists'
          ? t('contacts.exists')
          : code === 'contact_is_self'
            ? t('contacts.self')
            : code === 'phone_invalid'
              ? t('contacts.phoneInvalid')
              : errorText(err, t),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('contacts.name')}>
          {({ id }) => (
            <Input id={id} required maxLength={60} value={form.name} onChange={set('name')} />
          )}
        </Field>
        <Field label={t('contacts.phone')} hint={t('contacts.phoneHint')}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              required
              type="tel"
              autoComplete="off"
              maxLength={30}
              value={form.phone}
              onChange={set('phone')}
              aria-describedby={describedBy}
            />
          )}
        </Field>
        <Field label={t('contacts.email')}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoComplete="off"
              maxLength={254}
              value={form.email}
              onChange={set('email')}
            />
          )}
        </Field>
      </div>
      {vehicles.length > 1 && (
        <Field label={t('contacts.vehicle')}>
          {({ id }) => (
            <Select id={id} value={form.vehicleId} onChange={set('vehicleId')}>
              <option value="">{t('contacts.allVehicles')}</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nickname}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label={t('contacts.ownerName')} hint={t('contacts.ownerNameHint')}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            required
            maxLength={60}
            autoComplete="name"
            value={form.ownerName}
            onChange={set('ownerName')}
            aria-describedby={describedBy}
          />
        )}
      </Field>
      {message && <Notice tone="danger">{message}</Notice>}
      <Button type="submit" busy={busy} className="w-fit">
        {t('contacts.invite')}
      </Button>
    </form>
  );
}
