'use client';

import { Button, Checkbox, Field, Input, Notice, Select, Textarea, useI18n } from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { Section } from '@/components/ops-shell';
import { OpsApiError, opsApi } from '@/lib/api';

type Msg = { tone: 'success' | 'danger' | 'info'; text: string } | null;

/** Account actions for staff with customer.manage. Every action is audited by the API. */
export function ManageAccount({
  customer,
}: {
  customer: { id: string; status: string; language: string; freeReplacements: number };
}) {
  const { t } = useI18n();
  const pending = customer.status === 'pending_deletion';
  const [status, setStatus] = useState(customer.status === 'suspended' ? 'suspended' : 'active');
  const [language, setLanguage] = useState(customer.language === 'en' ? 'en' : 'de');
  const [free, setFree] = useState(String(customer.freeReplacements));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'save' | 'link' | 'delete' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [delReason, setDelReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [delMsg, setDelMsg] = useState<Msg>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMsg(null);
    try {
      const r = await opsApi<{ changed: boolean }>(`/ops/v1/customers/${customer.id}`, {
        method: 'PATCH',
        body: { status, language, freeReplacements: Number(free), reason },
      });
      if (r.changed) {
        setMsg({ tone: 'success', text: t('opsCustomers.saved') });
        window.location.reload();
      } else setMsg({ tone: 'info', text: t('opsCustomers.nothingChanged') });
    } catch {
      setMsg({ tone: 'danger', text: t('ops.error') });
    } finally {
      setBusy(null);
    }
  }

  async function sendLink() {
    setBusy('link');
    setMsg(null);
    try {
      await opsApi(`/ops/v1/customers/${customer.id}/sign-in-link`, { body: {} });
      setMsg({ tone: 'success', text: t('opsCustomers.linkSent') });
    } catch (err) {
      setMsg({
        tone: 'danger',
        text:
          err instanceof OpsApiError && err.body?.error === 'not_active'
            ? t('opsCustomers.notActive')
            : t('ops.error'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy('delete');
    setDelMsg(null);
    try {
      await opsApi(`/ops/v1/customers/${customer.id}/delete`, { body: { reason: delReason } });
      setDelMsg({ tone: 'success', text: t('opsCustomers.deleted') });
      window.location.reload();
    } catch (err) {
      setDelMsg({
        tone: 'danger',
        text:
          err instanceof OpsApiError && err.status === 409
            ? t('opsCustomers.pendingDeletion')
            : t('ops.error'),
      });
      setBusy(null);
    }
  }

  if (pending) {
    return (
      <Section title={t('opsCustomers.manageTitle')} icon="userCog">
        <Notice tone="warning">{t('opsCustomers.pendingDeletion')}</Notice>
      </Section>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title={t('opsCustomers.manageTitle')}
        icon="userCog"
        intro={t('opsCustomers.manageIntro')}
      >
        <form onSubmit={save} className="flex flex-col gap-4">
          <Field label={t('opsCustomers.statusLabel')}>
            {({ id }) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">{t('opsCustomers.status_active')}</option>
                <option value="suspended">{t('opsCustomers.status_suspended')}</option>
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap gap-4">
            <Field label={t('opsCustomers.language')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="min-w-40"
                >
                  <option value="de">{t('opsCustomers.lang_de')}</option>
                  <option value="en">{t('opsCustomers.lang_en')}</option>
                </Select>
              )}
            </Field>
            <Field label={t('opsCustomers.freeReplacements')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={5}
                  required
                  value={free}
                  onChange={(e) => setFree(e.target.value)}
                  className="max-w-28"
                />
              )}
            </Field>
          </div>
          <Field label={t('opsCustomers.changeReason')}>
            {({ id }) => (
              <Input
                id={id}
                required
                minLength={5}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" busy={busy === 'save'}>
              {t('opsCustomers.save')}
            </Button>
            <Button
              variant="secondary"
              busy={busy === 'link'}
              disabled={customer.status !== 'active'}
              onClick={() => void sendLink()}
            >
              {t('opsCustomers.sendLink')}
            </Button>
          </div>
        </form>
      </Section>

      <Section
        title={t('opsCustomers.deleteTitle')}
        icon="info"
        intro={t('opsCustomers.deleteIntro')}
        className="border-danger/40"
      >
        <form onSubmit={remove} className="flex flex-col gap-4">
          <Field label={t('opsCustomers.deleteReason')}>
            {({ id }) => (
              <Textarea
                id={id}
                required
                minLength={10}
                maxLength={500}
                value={delReason}
                onChange={(e) => setDelReason(e.target.value)}
              />
            )}
          </Field>
          <Checkbox
            label={t('opsCustomers.deleteConfirm')}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {delMsg && <Notice tone={delMsg.tone}>{delMsg.text}</Notice>}
          <Button
            type="submit"
            variant="danger"
            className="w-fit"
            disabled={!confirmed}
            busy={busy === 'delete'}
          >
            {t('opsCustomers.deleteSubmit')}
          </Button>
        </form>
      </Section>
    </div>
  );
}
