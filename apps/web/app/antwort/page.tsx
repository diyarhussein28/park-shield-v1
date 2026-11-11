'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useEffect, useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api, ApiError } from '@/lib/api-client';
import { useBrowserValue, useFragmentSecret } from '@/lib/use-browser-value';

type Reply = 'coming' | 'in_30_min' | 'not_nearby';
const REPLIES: Reply[] = ['coming', 'in_30_min', 'not_nearby'];

interface Preview {
  nickname: string;
  type: { de: string; en: string };
  isTest: boolean;
  createdAt: string;
  answered: boolean;
  reply: Reply | null;
  expired: boolean;
  escalated: boolean;
}

const DONE: Record<Reply, MessageKey> = {
  coming: 'reply.doneComing',
  in_30_min: 'reply.doneIn30',
  not_nearby: 'reply.doneNotNearby',
};

/**
 * NT-02: opening this page changes nothing (mail scanners open links); only a tap on a reply does.
 * The token comes in the URL fragment and is posted, never put in a URL.
 */
export default function ReplyPage() {
  const { t, locale } = useI18n();
  const token = useFragmentSecret('t');
  const suggested = useBrowserValue<Reply | null>(() => {
    const r = new URLSearchParams(window.location.search).get('r');
    return REPLIES.includes(r as Reply) ? (r as Reply) : null;
  }, null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState<Reply | null>(null);
  const [result, setResult] = useState<{ reply: Reply; escalating: boolean } | null>(null);
  const [already, setAlready] = useState<Reply | null | undefined>(undefined);

  useEffect(() => {
    if (!token) return;
    api<Preview>('/v1/ack/preview', { body: { token } }).then(setPreview, () => setInvalid(true));
  }, [token]);

  async function reply(r: Reply) {
    setBusy(r);
    try {
      setResult(
        await api<{ reply: Reply; escalating: boolean }>('/v1/ack', { body: { token, reply: r } }),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAlready(((err.body as { reply?: Reply | null } | null)?.reply ?? null) as Reply | null);
      } else if (err instanceof ApiError && err.status === 410) {
        setPreview((p) => (p ? { ...p, expired: true } : p));
      } else setInvalid(true);
    } finally {
      setBusy(null);
    }
  }

  const answered = already !== undefined || preview?.answered;
  const shownReply = already !== undefined ? already : preview?.reply;

  return (
    <PageShell>
      <Container className="max-w-xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('reply.title')}
            </Heading>
            {(invalid || token === null) && <Notice tone="danger">{t('reply.invalid')}</Notice>}
            {token && !preview && !invalid && <Text muted>{t('reply.loading')}</Text>}
            {preview && (
              <>
                <p className="text-lg font-semibold">
                  {t('reply.alertLine', {
                    type: locale === 'en' ? preview.type.en : preview.type.de,
                    nickname: preview.nickname,
                    time: new Date(preview.createdAt),
                  })}
                </p>
                {preview.isTest && <Notice tone="info">{t('reply.testNote')}</Notice>}
                {result ? (
                  <Notice tone="success">
                    {result.escalating ? t('reply.doneNotNearbyEscalating') : t(DONE[result.reply])}
                  </Notice>
                ) : answered ? (
                  <Notice tone="info">{t('reply.already', { reply: shownReply ?? 'none' })}</Notice>
                ) : preview.expired ? (
                  <Notice tone="warning">{t('reply.expired')}</Notice>
                ) : (
                  <>
                    <Text>{t('reply.intro')}</Text>
                    {preview.escalated && <Notice tone="warning">{t('reply.escalated')}</Notice>}
                    <div className="flex flex-col gap-3">
                      {REPLIES.map((r) => (
                        <Button
                          key={r}
                          size="lg"
                          block
                          variant={suggested === null || suggested === r ? 'primary' : 'secondary'}
                          busy={busy === r}
                          disabled={busy !== null}
                          onClick={() => reply(r)}
                        >
                          {t(`reply.${r}`)}
                        </Button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
