'use client';

import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api } from '@/lib/api-client';
import { useFragmentSecret } from '@/lib/use-browser-value';

/** The link from the "account will be deleted" e-mail (24 h grace period, US-32). */
export default function CancelDeletion() {
  const { t } = useI18n();
  const token = useFragmentSecret('t');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'invalid'>('idle');

  async function cancel() {
    setState('busy');
    try {
      await api('/v1/me/deletion/cancel', { body: { token } });
      setState('done');
    } catch {
      setState('invalid');
    }
  }

  return (
    <PageShell>
      <Container className="max-w-xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('privacy.cancelTitle')}
            </Heading>
            {state === 'done' ? (
              <>
                <Notice tone="success">{t('privacy.canceled')}</Notice>
                <Link href="/anmelden" className="text-primary underline">
                  {t('nav.login')}
                </Link>
              </>
            ) : state === 'invalid' || token === null ? (
              <Notice tone="danger">{t('privacy.cancelInvalid')}</Notice>
            ) : (
              token && (
                <>
                  <Text>{t('privacy.cancelIntro')}</Text>
                  <Button size="lg" busy={state === 'busy'} onClick={cancel}>
                    {t('privacy.cancelButton')}
                  </Button>
                </>
              )
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
