'use client';

import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useCallback, useEffect, useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api, ApiError } from '@/lib/api-client';
import { useBrowserValue } from '@/lib/use-browser-value';

interface Preview {
  type: { de: string; en: string };
  nickname: string;
  createdAt: string;
  expired: boolean;
  acknowledged: boolean;
  acknowledgedByMe: boolean;
  subscribed: boolean;
}

/**
 * The trusted contact's side of an escalation. Opening the link changes nothing (mail scanners open
 * links); only a tap does. Shows the alert type and the vehicle label only: no plate, no message.
 */
export function ContactAlert({ token }: { token: string }) {
  const { t, locale } = useI18n();
  const wantsOptOut = useBrowserValue(
    () => new URLSearchParams(window.location.search).get('abmelden') === '1',
    false,
  );
  const [data, setData] = useState<Preview | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState<'ack' | 'optout' | null>(null);
  const [error, setError] = useState(false);
  const [done, setDone] = useState<'ack' | 'already' | 'optout' | null>(null);
  const [confirmOptOut, setConfirmOptOut] = useState(false);

  const load = useCallback(
    () =>
      api<Preview>('/v1/contacts/alert/preview', { body: { token } }).then(setData, () =>
        setInvalid(true),
      ),
    [token],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function acknowledge() {
    setBusy('ack');
    setError(false);
    try {
      await api('/v1/contacts/alert/ack', { body: { token } });
      setDone('ack');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setDone('already');
      else setError(true);
    } finally {
      setBusy(null);
    }
  }

  async function optOut() {
    setBusy('optout');
    setError(false);
    try {
      await api('/v1/contacts/opt-out', { body: { token } });
      setDone('optout');
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  const showConfirm = (confirmOptOut || wantsOptOut) && done !== 'optout';

  return (
    <PageShell>
      <Container className="max-w-2xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('contactAlert.title')}
            </Heading>
            {invalid && <Notice tone="warning">{t('contactAlert.invalid')}</Notice>}
            {data && (
              <>
                <p className="text-lg font-semibold">
                  {t('contactAlert.lead', {
                    type: locale === 'en' ? data.type.en : data.type.de,
                    nickname: data.nickname,
                  })}
                </p>
                <Text muted>{t('contactAlert.privacy')}</Text>
                {error && <Notice tone="danger">{t('contactAlert.error')}</Notice>}
                {done === 'ack' || data.acknowledgedByMe ? (
                  <Notice tone="success">{t('contactAlert.doneComing')}</Notice>
                ) : done === 'already' || data.acknowledged ? (
                  <Notice tone="info">{t('contactAlert.already')}</Notice>
                ) : data.expired ? (
                  <Notice tone="info">{t('contactAlert.expired')}</Notice>
                ) : (
                  <Stack gap={2}>
                    <Button
                      size="lg"
                      block
                      busy={busy === 'ack'}
                      onClick={() => void acknowledge()}
                    >
                      {t('contactAlert.coming')}
                    </Button>
                    <Text muted>{t('contactAlert.comingHint')}</Text>
                  </Stack>
                )}

                {done === 'optout' ? (
                  <Notice tone="success">{t('contactAlert.optOutDone')}</Notice>
                ) : (
                  data.subscribed &&
                  (showConfirm ? (
                    <Notice tone="warning">
                      <Stack gap={3}>
                        <span>{t('contactAlert.optOutConfirm')}</span>
                        <Button
                          variant="secondary"
                          busy={busy === 'optout'}
                          onClick={() => void optOut()}
                        >
                          {t('contactAlert.optOutYes')}
                        </Button>
                      </Stack>
                    </Notice>
                  ) : (
                    <button
                      type="button"
                      className="text-primary min-h-12 self-start font-semibold underline"
                      onClick={() => setConfirmOptOut(true)}
                    >
                      {t('contactAlert.optOut')}
                    </button>
                  ))
                )}
              </>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
