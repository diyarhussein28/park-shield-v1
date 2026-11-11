'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Badge,
  Button,
  Card,
  Container,
  Field,
  Heading,
  Notice,
  Select,
  Stack,
  Text,
  Textarea,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api, errorText } from '@/lib/api-client';
import type { HistoryAlert } from '@/lib/api-server';

const REASONS = ['harassment', 'spam', 'false_alarm', 'other'] as const;

/** OW-08 / US-31: the last 90 days, muted alerts included, with "report abuse". */
export function HistoryView({ initial }: { initial: HistoryAlert[] }) {
  const { t } = useI18n();
  const [alerts, setAlerts] = useState(initial);

  return (
    <PageShell>
      <Container className="py-10">
        <Stack gap={6}>
          <div>
            <Link href="/konto" className="text-primary underline">
              {t('channels.toAccount')}
            </Link>
            <Heading level={1} className="mt-2">
              {t('history.title')}
            </Heading>
            <Text muted>{t('history.intro')}</Text>
            <Link href="/konto/zustellung" className="mt-2 inline-block text-primary underline">
              {t('deliveryHelp.link')}
            </Link>
          </div>
          {alerts.length === 0 ? (
            <Text>{t('history.none')}</Text>
          ) : (
            <ol className="flex flex-col gap-4" aria-label={t('history.title')}>
              {alerts.map((a) => (
                <li key={a.id}>
                  <AlertCard
                    alert={a}
                    onReported={() =>
                      setAlerts((list) =>
                        list.map((x) => (x.id === a.id ? { ...x, reported: true } : x)),
                      )
                    }
                  />
                </li>
              ))}
            </ol>
          )}
        </Stack>
      </Container>
    </PageShell>
  );
}

function AlertCard({ alert: a, onReported }: { alert: HistoryAlert; onReported: () => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number]>('harassment');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const statusKey = `history.status_${a.status}` as MessageKey;

  async function report(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ blocked: boolean }>(`/v1/alerts/${a.id}/report`, {
        body: { reason, note: note.trim() || undefined },
      });
      setResult({
        tone: 'success',
        text: r.blocked
          ? t('history.reportedBlocked', { nickname: a.vehicle.nickname })
          : t('history.reportedOnly'),
      });
      setOpen(false);
      onReported();
    } catch (err) {
      setResult({ tone: 'danger', text: errorText(err, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Stack gap={2}>
        <div className="flex flex-wrap items-center gap-2">
          <Heading level={2} className="text-lg">
            {locale === 'en' ? a.type.en : a.type.de} · „{a.vehicle.nickname}“
          </Heading>
          {a.isTest && <Badge tone="info">{t('history.test')}</Badge>}
          {a.severity === 'urgent' && !a.isTest && <Badge tone="warning">!</Badge>}
        </div>
        <Text muted className="text-sm">
          {t('history.at', { date: new Date(a.createdAt) })}
        </Text>
        <p className="font-semibold">
          {a.muted ? t(`history.muted_${a.muted}`) : t(statusKey)}
          {a.ownerReply && (
            <span className="font-normal"> · {t(`history.reply_${a.ownerReply}`)}</span>
          )}
        </p>
        {a.message && <Text>{t('history.message', { message: a.message })}</Text>}
        {a.deliveries.length > 0 && (
          <Text muted className="text-sm">
            {t('history.channels')}:{' '}
            {a.deliveries
              .map(
                (d) =>
                  `${t('channels.channelName', { channel: d.channel })} (${t(`deliveryHelp.s_${d.status}` as MessageKey)})`,
              )
              .join(', ')}
          </Text>
        )}
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        {!a.isTest &&
          (a.reported ? (
            !result && <Badge className="w-fit">{t('history.reported')}</Badge>
          ) : open ? (
            <form onSubmit={report} className="flex flex-col gap-3 border-t border-border pt-3">
              <Heading level={3} className="text-base">
                {t('history.reportTitle')}
              </Heading>
              {!a.canBlock && (
                <Text muted className="text-sm">
                  {t('history.reportOld')}
                </Text>
              )}
              <Field label={t('history.reportReason')}>
                {({ id }) => (
                  <Select
                    id={id}
                    className="max-w-sm"
                    value={reason}
                    onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
                  >
                    {REASONS.map((r) => (
                      <option key={r} value={r}>
                        {t(`history.reason_${r}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t('history.reportNote')}>
                {({ id }) => (
                  <Textarea
                    id={id}
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex gap-3">
                <Button type="submit" variant="danger" busy={busy}>
                  {t('history.reportSend')}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {t('history.reportCancel')}
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" className="w-fit px-0" onClick={() => setOpen(true)}>
              {t('history.report')}
            </Button>
          ))}
      </Stack>
    </Card>
  );
}
