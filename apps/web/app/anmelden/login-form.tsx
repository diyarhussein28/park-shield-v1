'use client';

import {
  Button,
  Card,
  Container,
  Field,
  Heading,
  Input,
  Notice,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Captcha } from '@/components/captcha';
import { PageShell } from '@/components/site-chrome';
import { api, errorText } from '@/lib/api-client';
import { useBrowserValue } from '@/lib/use-browser-value';

export function LoginForm() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const passkeys = useBrowserValue(browserSupportsWebAuthn, false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    setError(null);
    try {
      await api('/v1/auth/magic-link', { body: { email, locale, captcha } });
      setState('sent');
    } catch (err) {
      setError(errorText(err, t));
      setState('idle');
    }
  }

  async function passkeyLogin() {
    setError(null);
    try {
      const { challengeId, options } = await api<{ challengeId: string; options: never }>(
        '/v1/auth/passkey/login/options',
        { body: {} },
      );
      const response = await startAuthentication({ optionsJSON: options });
      await api('/v1/auth/passkey/login/verify', { body: { challengeId, response } });
      router.push('/konto');
    } catch {
      setError(t('auth.passkeyFailed'));
    }
  }

  return (
    <PageShell>
      <Container className="max-w-xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('auth.loginTitle')}
            </Heading>
            <Text muted>{t('auth.loginIntro')}</Text>
            {state === 'sent' ? (
              <Notice tone="success">{t('auth.sent')}</Notice>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-4" noValidate={false}>
                <Field label={t('auth.emailLabel')}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      type="email"
                      required
                      autoComplete="email webauthn"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-describedby={describedBy}
                    />
                  )}
                </Field>
                <Captcha onSolved={setCaptcha} />
                <Button type="submit" busy={state === 'busy'} disabled={!captcha}>
                  {t('auth.sendLink')}
                </Button>
              </form>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            {passkeys && state !== 'sent' && (
              <>
                <Text muted className="text-center">
                  {t('auth.or')}
                </Text>
                <Button variant="secondary" onClick={passkeyLogin}>
                  {t('auth.passkeyLogin')}
                </Button>
              </>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
