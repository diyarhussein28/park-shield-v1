'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Badge,
  Button,
  Card,
  Field,
  Heading,
  Input,
  Notice,
  Stack,
  Text,
  Textarea,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi, OpsApiError } from '@/lib/api';
import { fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

export interface DsrData {
  request: {
    id: string;
    type: string;
    status: string;
    customerId: string | null;
    email: string | null;
    accountStatus: string | null;
    deletionDueAt: string | null;
    dueAt: string;
    daysLeft: number;
    verifiedAt: string | null;
    verificationMethod: string | null;
    note: string | null;
  };
  steps: {
    processor: string;
    status: string;
    automated: boolean;
    evidence: string | null;
    completedAt: string | null;
  }[];
}

/** One request: identity first, then one step per processor; closes only when nothing is open. */
export function DsrDetail({ me, initial }: { me: StaffMe; initial: DsrData }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(initial);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const r = data.request;
  const closed = r.status === 'completed' || r.status === 'rejected';
  const reload = async () => setData(await opsApi<DsrData>(`/ops/v1/dsr/${r.id}`));
  const act = async (path: string, body: unknown = {}) => {
    setMessage(null);
    try {
      await opsApi(`/ops/v1/dsr/${r.id}${path}`, { body });
      await reload();
      return true;
    } catch (err) {
      const b =
        err instanceof OpsApiError
          ? (err.body as { error?: string; steps?: string[] } | null)
          : null;
      setMessage({
        tone: 'danger',
        text: b?.steps ? t('opsDsr.closeBlocked', { steps: b.steps.join(', ') }) : t('ops.error'),
      });
      return false;
    }
  };

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Link href="/datenschutz" className="text-primary underline">
            {t('opsDsr.back')}
          </Link>
          <Heading level={1} className="mt-2">
            {t(`opsDsr.type_${r.type}` as MessageKey)} · {r.email ?? t('opsDsr.accountGone')}
          </Heading>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{t(`opsDsr.status_${r.status}` as MessageKey)}</Badge>
            <Badge tone={r.daysLeft <= 7 && !closed ? 'warning' : 'info'}>
              {t('opsDsr.due', { date: new Date(r.dueAt) })}
            </Badge>
            {r.customerId && (
              <Link href={`/kunden/${r.customerId}`} className="text-primary underline">
                {t('opsDsr.account')}
              </Link>
            )}
          </div>
          {r.deletionDueAt && (
            <Text className="mt-2">
              {t('opsCustomers.deletionDue')}: {fmt(r.deletionDueAt, locale)}
            </Text>
          )}
          {r.note && (
            <Text muted className="mt-2">
              {r.note}
            </Text>
          )}
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsDsr.identity')}
            </Heading>
            {r.verifiedAt ? (
              <Text>
                {t('opsDsr.verified', { method: r.verificationMethod ?? '?' })} ·{' '}
                {fmt(r.verifiedAt, locale)}
              </Text>
            ) : (
              <>
                <Text>{t('opsDsr.notVerified')}</Text>
                {!closed && (
                  <Verify
                    onResend={(email) => act('/resend', { email })}
                    onManual={(note) => act('/verify', { note })}
                  />
                )}
              </>
            )}
          </Stack>
        </Card>

        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsDsr.stepsTitle')}
            </Heading>
            <ul className="flex flex-col gap-3" aria-label={t('opsDsr.stepsTitle')}>
              {data.steps.map((s) => (
                <li key={s.processor} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{s.processor}</span>
                    <Badge
                      tone={
                        s.status === 'done' || s.status === 'not_applicable'
                          ? 'success'
                          : s.status === 'failed'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {t(`opsDsr.step_${s.status}` as MessageKey)}
                    </Badge>
                    <span className="text-sm text-muted">
                      {s.automated ? t('opsDsr.automated') : t('opsDsr.manual')}
                    </span>
                  </div>
                  {s.evidence && (
                    <Text className="text-sm">
                      {t('opsDsr.evidence')}: {s.evidence}
                    </Text>
                  )}
                  {!closed &&
                    r.verifiedAt &&
                    (s.status === 'pending' || s.status === 'failed') &&
                    s.processor !== 'parkshield_db' && (
                      <StepForm
                        processor={s.processor}
                        onSave={(status, evidence) =>
                          act(`/steps/${s.processor}`, { status, evidence })
                        }
                      />
                    )}
                </li>
              ))}
            </ul>
            {!closed && (
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => act('/close')} disabled={!r.verifiedAt}>
                  {t('opsDsr.close')}
                </Button>
                {!r.verifiedAt && <Reject onReject={(note) => act('/reject', { note })} />}
              </div>
            )}
          </Stack>
        </Card>
      </Stack>
    </OpsShell>
  );
}

function StepForm({
  processor,
  onSave,
}: {
  processor: string;
  onSave: (status: 'done' | 'not_applicable', evidence: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [evidence, setEvidence] = useState('');
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="sm:min-w-64 sm:flex-1">
        <Field label={`${t('opsDsr.evidence')} (${processor})`}>
          {({ id }) => (
            <Input
              id={id}
              maxLength={200}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Button
        variant="secondary"
        disabled={evidence.trim().length < 3}
        onClick={() => onSave('done', evidence)}
      >
        {t('opsDsr.markDone')}
      </Button>
      <Button
        variant="ghost"
        disabled={evidence.trim().length < 3}
        onClick={() => onSave('not_applicable', evidence)}
      >
        {t('opsDsr.markNa')}
      </Button>
    </div>
  );
}

function Verify({
  onResend,
  onManual,
}: {
  onResend: (email: string) => Promise<boolean>;
  onManual: (note: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void onResend(email);
        }}
      >
        <Field label={t('opsDsr.email')}>
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
        <Button type="submit" variant="secondary" className="w-fit">
          {t('opsDsr.resend')}
        </Button>
      </form>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void onManual(note);
        }}
      >
        <Field label={t('opsDsr.verifyNote')}>
          {({ id }) => (
            <Textarea
              id={id}
              required
              minLength={5}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" className="w-fit">
          {t('opsDsr.verifyManual')}
        </Button>
      </form>
    </div>
  );
}

function Reject({ onReject }: { onReject: (note: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {t('opsDsr.reject')}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onReject(note);
      }}
    >
      <Field label={t('opsDsr.rejectNote')}>
        {({ id }) => (
          <Input
            id={id}
            required
            minLength={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" variant="danger">
        {t('opsDsr.reject')}
      </Button>
    </form>
  );
}
