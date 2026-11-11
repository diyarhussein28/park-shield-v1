'use client';

import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api } from '@/lib/api-client';
import { useFragmentSecret } from '@/lib/use-browser-value';

/** AD-11: the person confirms a request that reached support by e-mail, letter or phone. */
export default function ConfirmPrivacyRequest() {
  const { t } = useI18n();
  const token = useFragmentSecret('t');
  const [state, setState] = useState<'idle' | 'busy' | 'invalid'>('idle');
  const [type, setType] = useState<string | null>(null);

  async function confirm() {
    setState('busy');
    try {
      setType((await api<{ type: string }>('/v1/me/dsr/confirm', { body: { token } })).type);
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
              {t('privacy.confirmTitle')}
            </Heading>
            {type ? (
              <Notice tone="success">{t('privacy.confirmed', { type })}</Notice>
            ) : state === 'invalid' || token === null ? (
              <Notice tone="danger">{t('privacy.confirmInvalid')}</Notice>
            ) : (
              token && (
                <>
                  <Text>{t('privacy.confirmIntro')}</Text>
                  <Button size="lg" busy={state === 'busy'} onClick={confirm}>
                    {t('privacy.confirmButton')}
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
