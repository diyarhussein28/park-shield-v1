'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Heading,
  Input,
  Notice,
  Select,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import { errorCode, fmt } from '@/lib/format';
import type { StaffMe } from '@/lib/server';

interface Setting {
  key: string;
  group: string;
  killSwitch: boolean;
  value: unknown;
  default: unknown;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}
interface AlertType {
  code: string;
  severity: 'info' | 'normal' | 'urgent';
  escalates: boolean;
  labelDe: string;
  labelEn: string;
  active: boolean;
}
export interface SettingsData {
  settings: Setting[];
  alertTypes: AlertType[];
}
interface History {
  history: {
    id: number;
    at: string;
    by: string | null;
    old: unknown;
    new: unknown;
    version: number;
    reason: string | null;
  }[];
}

const GROUPS = [
  'escalation',
  'limits',
  'abuse',
  'refunds',
  'health',
  'reminders',
  'general',
] as const;
const label = (key: string) => `opsSettings.k_${key.replace(/\./g, '_')}` as MessageKey;
const show = (v: unknown) =>
  Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? '✓' : '✕') : String(v);

/** US-41 / AD-14 / AD-15: settings and kill switches, live within seconds, every change audited. */
export function SettingsView({ me, initial }: { me: StaffMe; initial: SettingsData | null }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(initial);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const reload = async () => setData(await opsApi<SettingsData>('/ops/v1/settings'));

  async function save(s: Setting, value: unknown, reason?: string) {
    setMsg(null);
    try {
      await opsApi(`/ops/v1/settings/${s.key}`, {
        method: 'PUT',
        body: { value, version: s.version, reason },
      });
      setMsg({ tone: 'success', text: t('opsSettings.saved', { name: t(label(s.key)) }) });
      await reload();
      return true;
    } catch (err) {
      const code = errorCode(err);
      setMsg({
        tone: 'danger',
        text:
          code === 'version_conflict'
            ? t('opsSettings.conflict')
            : code === 'invalid_value'
              ? t('opsSettings.invalid')
              : t('ops.error'),
      });
      if (code === 'version_conflict') await reload();
      return false;
    }
  }

  if (!data) {
    return (
      <OpsShell me={me}>
        <Notice tone="danger">{t('ops.forbidden')}</Notice>
      </OpsShell>
    );
  }
  const switches = data.settings.filter((s) => s.killSwitch);

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsSettings.title')}</Heading>
          <Text muted>{t('opsSettings.intro')}</Text>
          <Link href="/einstellungen/anbieter" className="text-primary underline">
            {t('opsSettings.toHealth')}
          </Link>
        </div>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsSettings.killSwitches')}
            </Heading>
            <Text muted>{t('opsSettings.killIntro')}</Text>
            <ul className="flex flex-col gap-3" aria-label={t('opsSettings.killSwitches')}>
              {switches.map((s) => (
                <KillSwitch key={s.key} s={s} onSave={save} />
              ))}
            </ul>
          </Stack>
        </Card>

        {GROUPS.map((g) => (
          <Card key={g}>
            <Stack gap={3}>
              <Heading level={2} className="text-xl">
                {t(`opsSettings.group_${g}` as MessageKey)}
              </Heading>
              <ul
                className="flex flex-col gap-3"
                aria-label={t(`opsSettings.group_${g}` as MessageKey)}
              >
                {data.settings
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <SettingRow key={s.key} s={s} locale={locale} onSave={save} />
                  ))}
              </ul>
            </Stack>
          </Card>
        ))}

        <Card>
          <Stack gap={3}>
            <Heading level={2} className="text-xl">
              {t('opsSettings.alertTypes')}
            </Heading>
            <Text muted>{t('opsSettings.alertTypesIntro')}</Text>
            <ul className="flex flex-col gap-3" aria-label={t('opsSettings.alertTypes')}>
              {data.alertTypes.map((a) => (
                <AlertTypeRow
                  key={a.code}
                  a={a}
                  onSaved={async (ok) => {
                    setMsg(
                      ok
                        ? { tone: 'success', text: t('opsSettings.saved', { name: a.labelDe }) }
                        : { tone: 'danger', text: t('ops.error') },
                    );
                    await reload();
                  }}
                />
              ))}
            </ul>
          </Stack>
        </Card>
      </Stack>
    </OpsShell>
  );
}

function KillSwitch({
  s,
  onSave,
}: {
  s: Setting;
  onSave: (s: Setting, v: unknown, reason?: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const on = s.value === true;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{t(label(s.key))}</span>
        <Badge tone={on ? 'success' : 'danger'}>
          {on ? t('opsSettings.on') : t('opsSettings.off')}
        </Badge>
        {s.updatedAt && (
          <span className="text-sm text-muted">
            {t('opsSettings.changedBy', { by: s.updatedBy ?? '–' })}
          </span>
        )}
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          if (await onSave(s, !on, reason)) setReason('');
        }}
      >
        <div className="sm:min-w-80">
          <Field label={t('opsSettings.reason', { name: t(label(s.key)) })}>
            {({ id }) => (
              <Input
                id={id}
                required
                minLength={3}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant={on ? 'danger' : 'primary'}>
          {on ? t('opsSettings.switchOff') : t('opsSettings.switchOn')}
          <span className="sr-only">: {t(label(s.key))}</span>
        </Button>
      </form>
    </li>
  );
}

function SettingRow({
  s,
  locale,
  onSave,
}: {
  s: Setting;
  locale: string;
  onSave: (s: Setting, v: unknown) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(Array.isArray(s.value) ? s.value.join(', ') : String(s.value));
  const [flag, setFlag] = useState(s.value === true);
  const [history, setHistory] = useState<History['history'] | null>(null);
  const isBool = typeof s.default === 'boolean';
  const isNum = typeof s.default === 'number';
  const parse = () =>
    isBool
      ? flag
      : Array.isArray(s.default)
        ? text
            .split(',')
            .map((x) => Number(x.trim()))
            .filter((n) => !Number.isNaN(n))
        : isNum
          ? Number(text.replace(',', '.'))
          : text.trim();

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          await onSave(s, parse());
        }}
      >
        <div className="sm:min-w-80 sm:flex-1">
          {isBool ? (
            <Checkbox
              label={t(label(s.key))}
              checked={flag}
              onChange={(e) => setFlag(e.target.checked)}
            />
          ) : (
            <Field
              label={t(label(s.key))}
              hint={t('opsSettings.defaultIs', { value: show(s.default) })}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  inputMode={isNum ? 'decimal' : undefined}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
        <Button type="submit" variant="secondary">
          {t('ops.save')}
          <span className="sr-only">: {t(label(s.key))}</span>
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span className="min-w-0 font-mono wrap-anywhere">{s.key}</span>
        <span>{t('opsSettings.version', { version: s.version })}</span>
        {s.updatedAt && (
          <span>
            {t('opsSettings.changedAt', { date: fmt(s.updatedAt, locale), by: s.updatedBy ?? '–' })}
          </span>
        )}
        <Button
          variant="ghost"
          className="min-h-0 px-0 text-sm"
          aria-expanded={history !== null}
          onClick={async () =>
            setHistory(
              history ? null : (await opsApi<History>(`/ops/v1/settings/${s.key}/history`)).history,
            )
          }
        >
          {t('opsSettings.history')}
          <span className="sr-only">: {t(label(s.key))}</span>
        </Button>
      </div>
      {history && (
        <ul className="text-sm" aria-label={t('opsSettings.historyOf', { name: t(label(s.key)) })}>
          {history.length === 0 && <li>{t('opsSettings.noHistory')}</li>}
          {history.map((h) => (
            <li key={h.id}>
              {fmt(h.at, locale)} · {h.by ?? '–'} · {show(h.old)} → {show(h.new)}
              {h.reason ? ` · „${h.reason}“` : ''}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AlertTypeRow({ a, onSaved }: { a: AlertType; onSaved: (ok: boolean) => Promise<void> }) {
  const { t } = useI18n();
  const [v, setV] = useState(a);
  return (
    <li className="rounded-xl border border-border p-3">
      <form
        className="grid gap-3 md:grid-cols-2"
        aria-label={a.labelDe}
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          try {
            await opsApi(`/ops/v1/alert-types/${a.code}`, {
              method: 'PATCH',
              body: {
                active: v.active,
                severity: v.severity,
                escalates: v.escalates,
                labelDe: v.labelDe,
                labelEn: v.labelEn,
              },
            });
            await onSaved(true);
          } catch {
            await onSaved(false);
          }
        }}
      >
        <Field label={t('opsSettings.labelDe', { code: a.code })}>
          {({ id }) => (
            <Input
              id={id}
              required
              minLength={2}
              maxLength={80}
              value={v.labelDe}
              onChange={(e) => setV({ ...v, labelDe: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('opsSettings.labelEn', { code: a.code })}>
          {({ id }) => (
            <Input
              id={id}
              required
              minLength={2}
              maxLength={80}
              value={v.labelEn}
              onChange={(e) => setV({ ...v, labelEn: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('opsSettings.severity', { code: a.code })}>
          {({ id }) => (
            <Select
              id={id}
              value={v.severity}
              onChange={(e) => setV({ ...v, severity: e.target.value as AlertType['severity'] })}
            >
              {(['info', 'normal', 'urgent'] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`opsSettings.severity_${s}` as MessageKey)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-wrap gap-x-6">
          <Checkbox
            label={t('opsSettings.escalates')}
            checked={v.escalates}
            onChange={(e) => setV({ ...v, escalates: e.target.checked })}
          />
          <Checkbox
            label={t('opsSettings.typeActive')}
            checked={v.active}
            disabled={a.code === 'custom'}
            onChange={(e) => setV({ ...v, active: e.target.checked })}
          />
        </div>
        <Button type="submit" variant="secondary" className="w-fit">
          {t('ops.save')}
          <span className="sr-only">: {a.labelDe}</span>
        </Button>
      </form>
    </li>
  );
}
