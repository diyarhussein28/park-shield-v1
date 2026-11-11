'use client';

import {
  Button,
  Card,
  Container,
  Heading,
  LanguageSwitch,
  Notice,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { startAuthentication } from '@simplewebauthn/browser';
import { useSyncExternalStore, useState } from 'react';
import { opsApi } from '@/lib/api';

const noSubscribe = () => () => {};

/** AD-01: passkey only. The browser offers the staff passkeys of this ops domain. */
export default function SignIn() {
  const { t } = useI18n();
  const timedOut = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).has('abgelaufen'),
    () => false,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(false);
    try {
      const { challengeId, options } = await opsApi<{ challengeId: string; options: never }>(
        '/ops/v1/auth/login/options',
        { body: {} },
      );
      const response = await startAuthentication({ optionsJSON: options });
      await opsApi('/ops/v1/auth/login/verify', { body: { challengeId, response } });
      window.location.assign('/');
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <main id="main">
      <Container className="max-w-md py-16">
        <Card>
          <Stack gap={4}>
            <div className="flex items-center justify-between">
              <Heading level={1} className="text-2xl">
                {t('ops.signInTitle')}
              </Heading>
              <LanguageSwitch />
            </div>
            <Text muted>{t('ops.vpnOnly')}</Text>
            {timedOut && <Notice tone="info">{t('ops.timedOut')}</Notice>}
            <Text>{t('ops.signInIntro')}</Text>
            {error && <Notice tone="danger">{t('ops.signInFailed')}</Notice>}
            <Button size="lg" busy={busy} onClick={signIn}>
              {t('ops.signIn')}
            </Button>
          </Stack>
        </Card>
      </Container>
    </main>
  );
}
