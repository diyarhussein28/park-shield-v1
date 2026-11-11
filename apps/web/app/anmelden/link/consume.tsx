'use client';

import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api } from '@/lib/api-client';
import { useFragmentSecret } from '@/lib/use-browser-value';

/**
 * The token arrives in the URL fragment, which is never sent to a server, and is used up only when the
 * person taps "Anmelden": mail scanners that open links cannot consume it (OW-01).
 */
export function ConsumeLink() {
  const { t } = useI18n();
  const router = useRouter();
  const token = useFragmentSecret('t');
  const [state, setState] = useState<'idle' | 'busy' | 'invalid'>('idle');

  async function signIn() {
    if (!token) return;
    setState('busy');
    try {
      await api('/v1/auth/magic-link/consume', { body: { token } });
      router.push('/konto');
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
              {t('auth.linkTitle')}
            </Heading>
            {token === null && <Notice tone="danger">{t('auth.linkMissing')}</Notice>}
            {state === 'invalid' && <Notice tone="danger">{t('auth.linkInvalid')}</Notice>}
            {token && state !== 'invalid' && (
              <>
                <Text>{t('auth.linkIntro')}</Text>
                <Button size="lg" onClick={signIn} busy={state === 'busy'}>
                  {t('auth.signIn')}
                </Button>
              </>
            )}
            {(token === null || state === 'invalid') && (
              <Link href="/anmelden" className="font-semibold text-primary underline">
                {t('auth.newLink')}
              </Link>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
