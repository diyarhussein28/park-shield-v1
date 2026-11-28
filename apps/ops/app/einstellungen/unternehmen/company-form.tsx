'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Button, Checkbox, Field, Input, Notice, Stack, Textarea, useI18n } from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { OpsShell, Section } from '@/components/ops-shell';
import { OpsApiError, opsApi, opsUpload } from '@/lib/api';
import type { StaffMe } from '@/lib/server';

type Footer = {
  vatId: boolean;
  taxNumber: boolean;
  owner: boolean;
  register: boolean;
  bank: boolean;
};
// `nextSteps` is no longer printed (the welcome letter's four steps are fixed, 2026-11-28); a stored
// value is sent back unchanged.
type Texts = { greeting: string; welcome: string; nextSteps?: string; closing: string };
type TextField =
  | 'name'
  | 'legalForm'
  | 'street'
  | 'postalCode'
  | 'city'
  | 'country'
  | 'phone'
  | 'email'
  | 'website'
  | 'vatId'
  | 'taxNumber'
  | 'owner'
  | 'registerCourt'
  | 'registerNumber'
  | 'bankName'
  | 'iban'
  | 'bic'
  | 'brandColor'
  | 'signatureName';
type CompanyData = Record<TextField, string> & { footer: Footer; texts: Texts };

/** GET /ops/v1/settings/company (letters.manage). */
export interface CompanyView {
  version: number;
  data: CompanyData;
  hasLogo: boolean;
  hasSignature: boolean;
  updatedAt: string | null;
}

const GROUPS: { title: MessageKey; fields: TextField[] }[] = [
  {
    title: 'opsCompany.groupCompany',
    fields: ['name', 'legalForm', 'street', 'postalCode', 'city', 'country'],
  },
  { title: 'opsCompany.groupContact', fields: ['phone', 'email', 'website'] },
  {
    title: 'opsCompany.groupTax',
    fields: ['vatId', 'taxNumber', 'owner', 'registerCourt', 'registerNumber'],
  },
  { title: 'opsCompany.groupBank', fields: ['bankName', 'iban', 'bic'] },
];
const REQUIRED = new Set<TextField>(['name', 'street', 'postalCode', 'city', 'country', 'email']);
const FOOTER: (keyof Footer)[] = ['vatId', 'taxNumber', 'owner', 'register', 'bank'];
const TEXTS = ['greeting', 'welcome', 'closing'] as const;
const footerKey = (k: keyof Footer) =>
  `opsCompany.footer${k[0]!.toUpperCase()}${k.slice(1)}` as MessageKey;

type Msg = { tone: 'success' | 'danger'; text: string } | null;

/** Company data and texts on customer letters; every save is a new version (letters.manage). */
export function CompanyForm({ me, initial }: { me: StaffMe; initial: CompanyView | null }) {
  const { t } = useI18n();
  const [view, setView] = useState(initial);
  const [data, setData] = useState(initial?.data ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [imgMsg, setImgMsg] = useState<Msg>(null);

  if (!view || !data) {
    return (
      <OpsShell me={me} title={t('opsCompany.title')}>
        <Notice tone="danger">{t('ops.forbidden')}</Notice>
      </OpsShell>
    );
  }

  const set = (k: TextField, v: string) => setData({ ...data, [k]: v });

  function failure(err: unknown): string {
    if (err instanceof OpsApiError && err.status === 409) return t('opsCompany.conflict');
    if (err instanceof OpsApiError && err.status === 400) return t('opsCompany.invalid');
    return t('ops.error');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMsg(null);
    try {
      const r = await opsApi<CompanyView>('/ops/v1/settings/company', {
        method: 'PUT',
        body: { version: view!.version, data },
      });
      setView(r);
      setData(r.data);
      setMsg({ tone: 'success', text: t('opsCompany.saved', { version: r.version }) });
    } catch (err) {
      setMsg({ tone: 'danger', text: failure(err) });
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: 'logo' | 'signature', file: File | undefined) {
    if (!file) return;
    setBusy(kind);
    setImgMsg(null);
    try {
      const form = new FormData();
      form.append('version', String(view!.version));
      form.append('file', file);
      const r = await opsUpload<CompanyView>(`/ops/v1/settings/company/images/${kind}`, form);
      setView(r);
      setImgMsg({ tone: 'success', text: t('opsCompany.saved', { version: r.version }) });
    } catch (err) {
      setImgMsg({
        tone: 'danger',
        text:
          err instanceof OpsApiError && err.status === 409
            ? t('opsCompany.conflict')
            : t('opsCompany.imageError'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function removeImage(kind: 'logo' | 'signature') {
    setBusy(`rm-${kind}`);
    setImgMsg(null);
    try {
      const r = await opsApi<CompanyView>(
        `/ops/v1/settings/company/images/${kind}?version=${view!.version}`,
        { method: 'DELETE' },
      );
      setView(r);
      setImgMsg({ tone: 'success', text: t('opsCompany.saved', { version: r.version }) });
    } catch (err) {
      setImgMsg({ tone: 'danger', text: failure(err) });
    } finally {
      setBusy(null);
    }
  }

  const image = (kind: 'logo' | 'signature', has: boolean) => (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">
        {t(kind === 'logo' ? 'opsCompany.logo' : 'opsCompany.signature')}
      </p>
      {has ? (
        <img
          src={`/ops/v1/settings/company/${kind}.png?v=${view.version}`}
          alt={t('opsCompany.imageAlt', {
            name: t(kind === 'logo' ? 'opsCompany.logo' : 'opsCompany.signature'),
          })}
          className="max-h-20 w-fit max-w-full rounded border border-border bg-white p-2"
        />
      ) : (
        <p className="text-sm text-muted">{t('opsCompany.noImage')}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-border bg-surface px-4 font-semibold text-primary focus-within:outline focus-within:outline-2 focus-within:outline-primary">
          {t('opsCompany.upload')}
          <span className="sr-only">
            : {t(kind === 'logo' ? 'opsCompany.logo' : 'opsCompany.signature')}
          </span>
          <input
            type="file"
            accept="image/svg+xml,image/png"
            className="sr-only"
            disabled={busy !== null}
            onChange={(e) => {
              void upload(kind, e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {has && (
          <Button
            variant="secondary"
            busy={busy === `rm-${kind}`}
            onClick={() => void removeImage(kind)}
          >
            {t('opsCompany.remove')}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <OpsShell
      me={me}
      back={{ href: '/einstellungen', label: t('ops.navSettings') }}
      title={t('opsCompany.title')}
      intro={t('opsCompany.intro')}
    >
      <Stack gap={6}>
        <p className="text-sm text-muted">
          {view.version === 0
            ? t('opsCompany.defaults')
            : t('opsCompany.version', { version: view.version })}
        </p>

        <Section title={t('opsCompany.groupBrand')} icon="card">
          <div className="grid gap-6 lg:grid-cols-2">
            {image('logo', view.hasLogo)}
            {image('signature', view.hasSignature)}
          </div>
          {imgMsg && (
            <Notice tone={imgMsg.tone} className="mt-4">
              {imgMsg.text}
            </Notice>
          )}
        </Section>

        <form onSubmit={save} className="flex flex-col gap-6">
          {GROUPS.map((g) => (
            <Section key={g.title} title={t(g.title)}>
              <div className="grid gap-4 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <Field key={f} label={t(`opsCompany.${f}` as MessageKey)}>
                    {({ id }) => (
                      <Input
                        id={id}
                        required={REQUIRED.has(f)}
                        type={f === 'email' ? 'email' : 'text'}
                        value={data[f]}
                        onChange={(e) => set(f, e.target.value)}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </Section>
          ))}

          <Section title={t('opsCompany.groupTexts')}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('opsCompany.brandColor')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      pattern="#[0-9a-fA-F]{6}"
                      value={data.brandColor}
                      onChange={(e) => set('brandColor', e.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('opsCompany.signatureName')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      value={data.signatureName}
                      onChange={(e) => set('signatureName', e.target.value)}
                    />
                  )}
                </Field>
              </div>
              {TEXTS.map((k) => (
                <Field key={k} label={t(`opsCompany.${k}` as MessageKey)}>
                  {({ id }) =>
                    k === 'greeting' || k === 'closing' ? (
                      <Input
                        id={id}
                        required
                        value={data.texts[k]}
                        onChange={(e) =>
                          setData({ ...data, texts: { ...data.texts, [k]: e.target.value } })
                        }
                      />
                    ) : (
                      <Textarea
                        id={id}
                        required
                        rows={4}
                        value={data.texts[k]}
                        onChange={(e) =>
                          setData({ ...data, texts: { ...data.texts, [k]: e.target.value } })
                        }
                      />
                    )
                  }
                </Field>
              ))}
            </div>
          </Section>

          <Section title={t('opsCompany.groupFooter')} intro={t('opsCompany.legalHint')}>
            <div className="flex flex-col">
              {FOOTER.map((k) => (
                <Checkbox
                  key={k}
                  label={t(footerKey(k))}
                  checked={data.footer[k]}
                  onChange={(e) =>
                    setData({ ...data, footer: { ...data.footer, [k]: e.target.checked } })
                  }
                />
              ))}
            </div>
          </Section>

          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button type="submit" className="w-fit" busy={busy === 'save'}>
            {t('opsCompany.save')}
          </Button>
        </form>
      </Stack>
    </OpsShell>
  );
}
