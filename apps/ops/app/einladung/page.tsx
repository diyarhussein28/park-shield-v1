'use client';

import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { opsApi } from '@/lib/api';

const noSubscribe = () => () => {};
let captured: string | null | undefined;

/** One-time link to register the staff passkey (72 h). The token is read from the fragment only. */
export default function Invitation() {
  const { t } = useI18n();
  const token = useSyncExternalStore(
    noSubscribe,
    () => {
      if (captured === undefined)
        captured = new URLSearchParams(window.location.hash.slice(1)).get('t');
      return captured;
    },
    () => undefined,
  );
  const [email, setEmail] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (token) history.replaceState(null, '', window.location.pathname);
    if (!token) return;
    opsApi<{ email: string }>('/ops/v1/auth/invite/view', { body: { token } }).then(
      (r) => setEmail(r.email),
      () => setInvalid(true),
    );
  }, [token]);

  async function setup() {
    setBusy(true);
    setFailed(false);
    try {
      const options = await opsApi<never>('/ops/v1/auth/invite/options', { body: { token } });
      const response = await startRegistration({ optionsJSON: options });
      await opsApi('/ops/v1/auth/invite/verify', {
        body: { token, response, label: navigator.platform || 'Passkey' },
      });
      window.location.assign('/');
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <main id="main">
      <Container className="max-w-md py-16">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('ops.inviteTitle')}
            </Heading>
            {(invalid || token === null) && <Notice tone="danger">{t('ops.inviteInvalid')}</Notice>}
            {email && !invalid && (
              <>
                <Text className="font-semibold">{t('ops.inviteFor', { email })}</Text>
                <Text>{t('ops.inviteIntro')}</Text>
                {failed && <Notice tone="danger">{t('ops.signInFailed')}</Notice>}
                <Button size="lg" busy={busy} onClick={setup}>
                  {t('ops.inviteSetup')}
                </Button>
              </>
            )}
          </Stack>
        </Card>
      </Container>
    </main>
  );
}
