'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useCallback, useEffect, useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api } from '@/lib/api-client';
import { useBrowserValue } from '@/lib/use-browser-value';

type Reply = 'coming' | 'in_30_min' | 'not_nearby';
const REPLIES: Reply[] = ['coming', 'in_30_min', 'not_nearby'];
const DONE: Record<Reply, MessageKey> = {
  coming: 'reply.doneComing',
  in_30_min: 'reply.doneIn30',
  not_nearby: 'reply.doneNotNearby',
};

interface ViewData {
  type: { code: string; de: string; en: string };
  nickname: string;
  createdAt: string;
  isTest: boolean;
  status: string;
  ownerReply: Reply | null;
  contentHidden: boolean;
  revealed: boolean;
  message: string | null;
  photoCount: number;
  photos: { id: string; position: number; width: number; height: number }[];
  photosGone: 'retention' | 'abuse_report' | null;
  reported: boolean;
  replyToken: string | null;
}

/**
 * The owner's page for an alert with photos. Photos are streamed by the API (decrypted on the fly,
 * no-store); nothing is cached here. "Missbrauch melden" deletes them at once and blocks the sender.
 */
export function AlertView({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const fromMail = useBrowserValue(
    () => new URLSearchParams(window.location.search).get('melden') === '1',
    false,
  );
  const [data, setData] = useState<ViewData | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState(false);
  const [busy, setBusy] = useState<Reply | null>(null);
  const [replied, setReplied] = useState<{ reply: Reply; escalating: boolean } | null>(null);

  const load = useCallback(
    (reveal: boolean) =>
      api<ViewData>(
        `/v1/alerts/view/${encodeURIComponent(token)}${reveal ? '?reveal=1' : ''}`,
      ).then(setData, () => setInvalid(true)),
    [token],
  );
  useEffect(() => {
    void load(false);
  }, [load]);

  async function report() {
    setReporting(true);
    setReportError(false);
    try {
      await api(`/v1/alerts/view/${encodeURIComponent(token)}/report-abuse`, {
        body: { source: fromMail ? 'email_link' : 'view_page' },
      });
      setReportDone(true);
      setConfirming(false);
      await load(false);
    } catch {
      setReportError(true);
    } finally {
      setReporting(false);
    }
  }

  async function reply(r: Reply) {
    if (!data?.replyToken) return;
    setBusy(r);
    try {
      setReplied(
        await api<{ reply: Reply; escalating: boolean }>('/v1/ack', {
          body: { token: data.replyToken, reply: r },
        }),
      );
    } catch {
      // Already answered (409) or expired: the reloaded data shows the current state.
      await load(data.revealed && data.contentHidden);
    } finally {
      setBusy(null);
    }
  }

  // From the e-mail's "Missbrauch melden" link the confirmation is open right away.
  const showConfirm = (confirming || (fromMail && !dismissed)) && !reportDone;

  return (
    <PageShell>
      <Container className="max-w-2xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('alertView.title')}
            </Heading>
            {invalid && <Notice tone="warning">{t('alertView.invalid')}</Notice>}
            {!data && !invalid && <Text muted>{t('reply.loading')}</Text>}
            {data && (
              <>
                <p className="text-lg font-semibold">
                  {t('reply.alertLine', {
                    type: locale === 'en' ? data.type.en : data.type.de,
                    nickname: data.nickname,
                    time: new Date(data.createdAt),
                  })}
                </p>
                <Text muted>{t('alertView.date', { date: new Date(data.createdAt) })}</Text>
                {data.isTest && <Notice tone="info">{t('reply.testNote')}</Notice>}
                {reportDone && <Notice tone="success">{t('alertView.reportDone')}</Notice>}

                {data.contentHidden && !data.revealed ? (
                  <Notice tone="info">
                    <Stack gap={3}>
                      <span>{t('alertView.hidden', { count: data.photoCount })}</span>
                      <Button variant="secondary" onClick={() => void load(true)}>
                        {t('alertView.reveal')}
                      </Button>
                    </Stack>
                  </Notice>
                ) : (
                  data.message && (
                    <blockquote className="border-border rounded-xl border-l-4 px-4 py-2 wrap-anywhere">
                      {data.message}
                    </blockquote>
                  )
                )}

                {data.photosGone === 'retention' && (
                  <Notice tone="info">{t('alertView.goneRetention')}</Notice>
                )}
                {data.photosGone === 'abuse_report' && !reportDone && (
                  <Notice tone="info">{t('alertView.goneAbuse')}</Notice>
                )}

                {data.photos.length > 0 && (
                  <ul className="grid gap-4 sm:grid-cols-2" aria-label={t('alertView.photos')}>
                    {data.photos.map((p) => {
                      const src = `/v1/alerts/media/${p.id}?t=${encodeURIComponent(token)}`;
                      const alt = t('alertView.photoAlt', { n: p.position });
                      return (
                        <li key={p.id} className="flex min-w-0 flex-col gap-2">
                          {/* Streamed and decrypted by the API on request; no image optimizer cache. */}
                          <img
                            src={src}
                            alt={alt}
                            width={p.width}
                            height={p.height}
                            className="border-border h-auto w-full rounded-xl border"
                            referrerPolicy="no-referrer"
                          />
                          <a
                            href={src}
                            download={`parkshield-foto-${p.position}.jpg`}
                            className="text-primary min-h-12 content-center font-semibold underline"
                          >
                            {t('alertView.download', { n: p.position })}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* The same reply buttons as the reply page (NT-02), so one link does both. */}
                {replied ? (
                  <Notice tone="success">{t(DONE[replied.reply])}</Notice>
                ) : data.replyToken ? (
                  <Stack gap={3}>
                    <Text>{t('reply.intro')}</Text>
                    {REPLIES.map((r) => (
                      <Button
                        key={r}
                        size="lg"
                        block
                        busy={busy === r}
                        disabled={busy !== null}
                        onClick={() => void reply(r)}
                      >
                        {t(`reply.${r}`)}
                      </Button>
                    ))}
                  </Stack>
                ) : data.ownerReply ? (
                  <Notice tone="info">{t('reply.already', { reply: data.ownerReply })}</Notice>
                ) : null}

                {!data.reported && !reportDone && (
                  <section aria-labelledby="abuse-h" className="border-border border-t pt-4">
                    <Heading level={2} id="abuse-h" className="text-lg">
                      {t('alertView.abuseTitle')}
                    </Heading>
                    {showConfirm ? (
                      <Stack gap={3}>
                        <Text>{t('alertView.abuseConfirm')}</Text>
                        {reportError && <Notice tone="danger">{t('auth.genericError')}</Notice>}
                        <Button variant="danger" busy={reporting} onClick={() => void report()}>
                          {t('alertView.abuseSend')}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setConfirming(false);
                            setDismissed(true);
                          }}
                        >
                          {t('alertView.abuseCancel')}
                        </Button>
                      </Stack>
                    ) : (
                      <Button variant="secondary" onClick={() => setConfirming(true)}>
                        {t('alertView.abuseButton')}
                      </Button>
                    )}
                  </section>
                )}
                {data.reported && !reportDone && (
                  <Notice tone="info">{t('alertView.alreadyReported')}</Notice>
                )}
              </>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
