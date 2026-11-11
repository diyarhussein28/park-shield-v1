'use client';

import { Button, Card, Container, Heading, Notice, Stack, useI18n } from '@parkshield/ui';
import { useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api } from '@/lib/api-client';
import { useFragmentSecret } from '@/lib/use-browser-value';

export default function ConfirmWaitlist() {
  const { t } = useI18n();
  const token = useFragmentSecret('t');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'invalid'>('idle');
  const invalid = state === 'invalid' || token === null;

  async function confirm() {
    setState('busy');
    try {
      await api('/v1/business-waitlist/confirm', { body: { token } });
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
              {t('business.confirmTitle')}
            </Heading>
            {state === 'done' && <Notice tone="success">{t('business.confirmed')}</Notice>}
            {invalid && <Notice tone="danger">{t('business.confirmInvalid')}</Notice>}
            {token && (state === 'idle' || state === 'busy') && (
              <Button size="lg" onClick={confirm} busy={state === 'busy'}>
                {t('business.confirmButton')}
              </Button>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
