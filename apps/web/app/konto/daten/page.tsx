'use client';

import {
  Button,
  Card,
  Checkbox,
  Container,
  Heading,
  Notice,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api, ApiError, downloadPost, errorText } from '@/lib/api-client';

/** OW-12 / US-32: export (JSON + PDF) and account deletion, both after a fresh sign-in. */
export default function PrivacyPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [reauth, setReauth] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deletedAt, setDeletedAt] = useState<Date | null>(null);

  const handle = (err: unknown) => {
    const body =
      err instanceof ApiError ? (err.body as { error?: string; minutes?: number } | null) : null;
    if (body?.error === 'reauth_required') setReauth(body.minutes ?? 15);
    else if (err instanceof ApiError && err.status === 401 && !body?.error?.startsWith('reauth'))
      router.push('/anmelden');
    else setError(errorText(err, t));
  };

  async function download(kind: 'json' | 'pdf') {
    setBusy(kind);
    setError(null);
    try {
      await downloadPost(
        kind === 'json' ? '/v1/me/export' : '/v1/me/export.pdf',
        kind === 'json' ? 'parkshield-daten.json' : 'parkshield-daten.pdf',
      );
    } catch (err) {
      handle(err);
    } finally {
      setBusy(null);
    }
  }

  async function signInAgain() {
    await api('/v1/auth/logout', { body: {} }).catch(() => {});
    router.push('/anmelden');
    router.refresh();
  }

  async function remove() {
    setBusy('delete');
    setError(null);
    try {
      const r = await api<{ deletionDueAt: string }>('/v1/me', {
        method: 'DELETE',
        body: { confirm: true },
      });
      setDeletedAt(new Date(r.deletionDueAt));
      router.refresh();
    } catch (err) {
      handle(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell>
      <Container className="max-w-3xl py-10">
        <Stack gap={6}>
          <div>
            {!deletedAt && (
              <Link href="/konto" className="text-primary underline">
                {t('channels.toAccount')}
              </Link>
            )}
            <Heading level={1} className="mt-2">
              {t('privacy.title')}
            </Heading>
            <Text muted>{t('privacy.intro')}</Text>
          </div>

          {deletedAt ? (
            <Notice tone="info">{t('privacy.deleteRequested', { date: deletedAt })}</Notice>
          ) : (
            <>
              {reauth !== null && (
                <Notice tone="warning">
                  <p className="mb-3">{t('privacy.reauth', { minutes: reauth })}</p>
                  <Button onClick={signInAgain}>{t('privacy.reauthButton')}</Button>
                </Notice>
              )}
              {error && <Notice tone="danger">{error}</Notice>}

              <Card>
                <Stack gap={3}>
                  <Heading level={2} className="text-xl">
                    {t('privacy.exportTitle')}
                  </Heading>
                  <Text>{t('privacy.exportIntro')}</Text>
                  <div className="flex flex-wrap gap-3">
                    <Button busy={busy === 'json'} onClick={() => download('json')}>
                      {t('privacy.exportJson')}
                    </Button>
                    <Button
                      variant="secondary"
                      busy={busy === 'pdf'}
                      onClick={() => download('pdf')}
                    >
                      {t('privacy.exportPdf')}
                    </Button>
                  </div>
                </Stack>
              </Card>

              <Card>
                <Stack gap={3}>
                  <Heading level={2} className="text-xl">
                    {t('privacy.deleteTitle')}
                  </Heading>
                  <Text>{t('privacy.deleteIntro')}</Text>
                  <Checkbox
                    label={t('privacy.deleteConfirm')}
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  <Button
                    variant="danger"
                    className="w-fit"
                    disabled={!confirm}
                    busy={busy === 'delete'}
                    onClick={remove}
                  >
                    {t('privacy.deleteButton')}
                  </Button>
                </Stack>
              </Card>
            </>
          )}
        </Stack>
      </Container>
    </PageShell>
  );
}
