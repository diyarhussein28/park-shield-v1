'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Button,
  Card,
  Container,
  Field,
  Heading,
  Input,
  Notice,
  Select,
  Stack,
  Text,
  Textarea,
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Captcha } from '@/components/captcha';
import { PageShell } from '@/components/site-chrome';
import { api, errorText, hasSession } from '@/lib/api-client';
import { useBrowserValue } from '@/lib/use-browser-value';

const TOPICS = ['alert_missing', 'decal', 'billing', 'privacy', 'abuse', 'other'] as const;

/** SP-01: the contact form opens a Zammad ticket. Signed in, the answer goes to the account address. */
export function ContactForm() {
  const { t, locale } = useI18n();
  const signedIn = useBrowserValue(hasSession, false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState<(typeof TOPICS)[number]>('other');
  const [message, setMessage] = useState('');
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ticket: string; replyHours: number | null } | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    api<{ email: string }>('/v1/me')
      .then((me) => setAccountEmail(me.email))
      .catch(() => setAccountEmail(null));
  }, [signedIn]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(
        await api('/v1/support/contact', {
          body: {
            email: accountEmail ?? email,
            name: name || undefined,
            topic,
            message,
            captcha,
            locale,
          },
        }),
      );
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <Container className="max-w-2xl py-10">
        <Stack gap={4}>
          <Link href="/hilfe" className="text-primary underline">
            {t('help.backToHelp')}
          </Link>
          <Heading level={1}>{t('support.title')}</Heading>
          <Text muted>{t('support.intro')}</Text>
          {done ? (
            <Notice tone="success" title={t('support.sentTitle')}>
              {t('support.sent', { ticket: done.ticket })}{' '}
              {done.replyHours
                ? t('support.replyPlus', { hours: done.replyHours })
                : t('support.replyDefault')}
            </Notice>
          ) : (
            <Card>
              <form onSubmit={submit} className="flex flex-col gap-4">
                {accountEmail ? (
                  <Text>{t('support.answerTo', { email: accountEmail })}</Text>
                ) : (
                  <Field label={t('support.email')}>
                    {({ id }) => (
                      <Input
                        id={id}
                        type="email"
                        required
                        autoComplete="email"
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    )}
                  </Field>
                )}
                <Field label={t('support.name')} optionalLabel={t('common.optional')}>
                  {({ id }) => (
                    <Input
                      id={id}
                      autoComplete="name"
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('support.topic')}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={topic}
                      onChange={(e) => setTopic(e.target.value as (typeof TOPICS)[number])}
                    >
                      {TOPICS.map((x) => (
                        <option key={x} value={x}>
                          {t(`support.topic_${x}` as MessageKey)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {topic === 'alert_missing' && (
                  <Notice tone="info">
                    {t('support.alertHint')}{' '}
                    <Link href="/konto/zustellung" className="font-semibold underline">
                      {t('deliveryHelp.link')}
                    </Link>
                  </Notice>
                )}
                <Field label={t('support.message')} hint={t('support.messageHint')}>
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      required
                      minLength={10}
                      maxLength={4000}
                      className="min-h-40"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  )}
                </Field>
                <Captcha onSolved={setCaptcha} />
                {error && <Notice tone="danger">{error}</Notice>}
                <Text className="text-sm">
                  {t('support.privacy')}{' '}
                  <Link href="/datenschutz" className="underline">
                    {t('common.footer.privacy')}
                  </Link>
                </Text>
                <Button type="submit" className="w-fit" busy={busy} disabled={!captcha}>
                  {t('support.send')}
                </Button>
              </form>
            </Card>
          )}
        </Stack>
      </Container>
    </PageShell>
  );
}
