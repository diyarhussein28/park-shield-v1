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
import { useState, type FormEvent } from 'react';
import { Captcha } from '@/components/captcha';
import { PageShell } from '@/components/site-chrome';
import { api, errorText } from '@/lib/api-client';

export function WaitlistForm() {
  const { t, locale } = useI18n();
  const [form, setForm] = useState({ companyName: '', email: '', fleetSize: '', industry: '' });
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    setError(null);
    try {
      await api('/v1/business-waitlist', {
        body: {
          ...form,
          fleetSize: Number(form.fleetSize),
          industry: form.industry || undefined,
          captcha,
          locale,
        },
      });
      setState('sent');
    } catch (err) {
      setError(errorText(err, t));
      setState('idle');
    }
  }

  return (
    <PageShell>
      <Container className="max-w-2xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('business.title')}
            </Heading>
            <Text>{t('business.intro')}</Text>
            {state === 'sent' ? (
              <Notice tone="success">{t('business.sent')}</Notice>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-4">
                <Field label={t('business.companyLabel')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      required
                      autoComplete="organization"
                      value={form.companyName}
                      onChange={set('companyName')}
                    />
                  )}
                </Field>
                <Field label={t('business.emailLabel')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="email"
                      required
                      autoComplete="email"
                      value={form.email}
                      onChange={set('email')}
                    />
                  )}
                </Field>
                <Field label={t('business.fleetLabel')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      required
                      value={form.fleetSize}
                      onChange={set('fleetSize')}
                    />
                  )}
                </Field>
                <Field label={t('business.industryLabel')} optionalLabel={t('common.optional')}>
                  {({ id }) => <Input id={id} value={form.industry} onChange={set('industry')} />}
                </Field>
                <Text muted className="text-sm">
                  {t('business.doiNotice')}
                </Text>
                <Captcha onSolved={setCaptcha} />
                {error && <Notice tone="danger">{error}</Notice>}
                <Button type="submit" busy={state === 'busy'} disabled={!captcha}>
                  {t('business.submit')}
                </Button>
              </form>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
