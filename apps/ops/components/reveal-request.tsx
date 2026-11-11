'use client';

import { Button, Checkbox, Field, Input, Notice, Textarea, useI18n } from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { opsApi } from '@/lib/api';

/** AD-06: ask for one masked field; a second person approves on the break-glass page. */
export function RevealRequest({
  target,
  targetId,
  label,
}: {
  target: string;
  targetId: string;
  label: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [notify, setNotify] = useState(true);
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    try {
      await opsApi('/ops/v1/break-glass', {
        body: { target, targetId, reason, ticketRef: ticket, notifyCustomer: notify },
      });
      setState('done');
      setOpen(false);
    } catch {
      setState('error');
    }
  }

  if (state === 'done') return <Notice tone="info">{t('opsCustomers.requested')}</Notice>;
  if (!open) {
    return (
      <Button variant="ghost" className="px-0" onClick={() => setOpen(true)}>
        {t('opsCustomers.reveal')}
        <span className="sr-only">: {label}</span>
      </Button>
    );
  }
  return (
    <form
      onSubmit={submit}
      className="mt-2 flex flex-col gap-3 rounded-xl border border-border p-3"
    >
      <p className="font-semibold">{t('opsCustomers.revealFor', { field: label })}</p>
      <Field label={t('opsCustomers.reason')}>
        {({ id }) => (
          <Textarea
            id={id}
            required
            minLength={10}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('opsCustomers.ticket')}>
        {({ id }) => (
          <Input
            id={id}
            required
            minLength={3}
            maxLength={40}
            value={ticket}
            onChange={(e) => setTicket(e.target.value)}
          />
        )}
      </Field>
      <Checkbox
        label={t('opsCustomers.notify')}
        checked={notify}
        onChange={(e) => setNotify(e.target.checked)}
      />
      {state === 'error' && <Notice tone="danger">{t('ops.error')}</Notice>}
      <div className="flex gap-3">
        <Button type="submit" busy={state === 'busy'}>
          {t('opsCustomers.requestSend')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('ops.cancel')}
        </Button>
      </div>
    </form>
  );
}
