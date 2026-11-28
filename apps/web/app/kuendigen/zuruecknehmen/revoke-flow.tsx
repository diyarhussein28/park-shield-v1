'use client';

import { Button, Card, Container, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api } from '@/lib/api-client';

/** One click from the cancellation e-mail. The token stays in the page, never in a server log. */
export function RevokeFlow() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; contractNo: string } | { ok: false } | null>(
    null,
  );

  async function revoke() {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    setBusy(true);
    try {
      const r = await api<{ contractNo: string | null }>('/v1/legal/cancellations/revoke', {
        body: { token },
      });
      setResult({ ok: true, contractNo: r.contractNo ?? '' });
    } catch {
      setResult({ ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title={t('cancel.revokeTitle')}>
      <Container className="max-w-2xl py-10">
        <Card>
          <Stack gap={4}>
            {result === null && (
              <>
                <Text>{t('cancel.revokeText')}</Text>
                <Button size="lg" className="w-fit" busy={busy} onClick={() => void revoke()}>
                  {t('cancel.revokeSubmit')}
                </Button>
              </>
            )}
            {result?.ok && (
              <Notice tone="success">
                {t('cancel.revokeDone', { contractNo: result.contractNo })}
              </Notice>
            )}
            {result && !result.ok && <Notice tone="danger">{t('cancel.revokeInvalid')}</Notice>}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
