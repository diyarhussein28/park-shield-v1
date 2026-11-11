'use client';

import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Heading,
  Input,
  Notice,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi, OpsApiError } from '@/lib/api';
import type { StaffMe } from '@/lib/server';

export interface StaffList {
  staff: {
    id: string;
    email: string;
    name: string | null;
    status: string;
    roles: string[];
    hasPasskey: boolean;
  }[];
  roles: { code: string; name: string; permissions: string[] }[];
}

function RolePicker({
  roles,
  value,
  onChange,
  legend,
}: {
  roles: StaffList['roles'];
  value: string[];
  onChange: (v: string[]) => void;
  legend: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1 font-semibold wrap-anywhere">{legend}</legend>
      <div className="flex flex-wrap gap-x-4">
        {roles.map((r) => (
          <Checkbox
            key={r.code}
            label={`${r.name} (${r.code})`}
            checked={value.includes(r.code)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, r.code] : value.filter((x) => x !== r.code))
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

/** staff.manage: invite staff and assign roles. The API checks the permission on every call. */
export function StaffView({ me, list: initial }: { me: StaffMe; list: StaffList | null }) {
  const { t } = useI18n();
  const [list, setList] = useState(initial);
  const reload = async () => setList(await opsApi<StaffList>('/ops/v1/staff'));

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('ops.staffTitle')}</Heading>
          <Text muted>{t('ops.staffIntro')}</Text>
          <Link href="/mitarbeitende/pruefung" className="text-primary underline">
            {t('opsAccess.link')}
          </Link>
        </div>
        {!list ? (
          <Notice tone="danger">{t('ops.forbidden')}</Notice>
        ) : (
          <>
            <ul className="flex flex-col gap-3" aria-label={t('ops.staffTitle')}>
              {list.staff.map((s) => (
                <li key={s.id}>
                  <StaffRow person={s} roles={list.roles} onSaved={reload} />
                </li>
              ))}
            </ul>
            <InviteForm roles={list.roles} onInvited={reload} />
          </>
        )}
      </Stack>
    </OpsShell>
  );
}

function StaffRow({
  person,
  roles,
  onSaved,
}: {
  person: StaffList['staff'][number];
  roles: StaffList['roles'];
  onSaved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(person.roles);
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function save() {
    setStatus(null);
    try {
      await opsApi(`/ops/v1/staff/${person.id}/roles`, { method: 'PUT', body: { roles: value } });
      setStatus({ tone: 'success', text: t('ops.staffSaved') });
      await onSaved();
    } catch (err) {
      setStatus({
        tone: 'danger',
        text:
          err instanceof OpsApiError && err.body?.error === 'last_manager'
            ? t('ops.staffLastManager')
            : t('ops.forbidden'),
      });
    }
  }

  return (
    <Card>
      <Stack gap={3}>
        <div className="flex flex-wrap items-center gap-2">
          <Heading level={2} className="text-lg">
            {person.name ?? person.email}
          </Heading>
          <Text muted className="min-w-0 wrap-anywhere">
            {person.email}
          </Text>
          <Badge tone={person.hasPasskey ? 'success' : 'warning'}>
            {person.hasPasskey ? t('ops.staffPasskey') : t('ops.staffNoPasskey')}
          </Badge>
        </div>
        <RolePicker
          roles={roles}
          value={value}
          onChange={setValue}
          legend={t('ops.staffEditRoles', { email: person.email })}
        />
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <Button variant="secondary" className="w-fit" disabled={!value.length} onClick={save}>
          {t('ops.staffSave')}
        </Button>
      </Stack>
    </Card>
  );
}

function InviteForm({
  roles,
  onInvited,
}: {
  roles: StaffList['roles'];
  onInvited: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>(['support']);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await opsApi<{ link: string }>('/ops/v1/staff', {
        body: { email, name, roles: picked },
      });
      setResult({ tone: 'success', text: t('ops.inviteSent', { link: r.link }) });
      setEmail('');
      setName('');
      await onInvited();
    } catch (err) {
      setResult({
        tone: 'danger',
        text:
          err instanceof OpsApiError && err.body?.error === 'email_is_customer'
            ? t('ops.inviteCustomer')
            : t('ops.forbidden'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Heading level={2} className="text-xl">
          {t('ops.inviteNew')}
        </Heading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('ops.inviteEmail')}>
            {({ id }) => (
              <Input
                id={id}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('ops.inviteName')}>
            {({ id }) => (
              <Input
                id={id}
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
        </div>
        <RolePicker
          roles={roles}
          value={picked}
          onChange={setPicked}
          legend={t('ops.inviteRoles')}
        />
        {result && (
          <Notice tone={result.tone}>
            <span className="break-all">{result.text}</span>
          </Notice>
        )}
        <Button type="submit" busy={busy} disabled={!picked.length} className="w-fit">
          {t('ops.inviteSend')}
        </Button>
      </form>
    </Card>
  );
}
