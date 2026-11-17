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
import { PageShell } from '@/components/site-chrome';
import { api, errorText } from '@/lib/api-client';

/**
 * § 356a BGB online withdrawal: "Vertrag widerrufen" → this page with exactly three fields (no reason)
 * → "Widerruf bestätigen" → receipt page and receipt e-mail with date and time.
 * TODO [LEGAL REVIEW]: wording of the page.
 */
export function WithdrawFlow({
  prefill,
}: {
  prefill: { contractRef: string; email: string } | null;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const [contractRef, setContractRef] = useState(prefill?.contractRef ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState<Date | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ receivedAt: string }>(
        prefill ? '/v1/portal/withdrawals' : '/v1/legal/withdrawals',
        { body: { name, contractRef, email, locale } },
      );
      setReceivedAt(new Date(r.receivedAt));
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (receivedAt) {
    return (
      <PageShell>
        <Container className="max-w-2xl py-10">
          <Card>
            <Stack gap={4}>
              <Heading level={1} className="text-2xl">
                {t('withdraw.receivedTitle')}
              </Heading>
              <Notice tone="success">{t('withdraw.receivedText', { date: receivedAt })}</Notice>
              <Text muted>{t('cancel.receivedSave')}</Text>
              <Button
                variant="secondary"
                className="w-fit print:hidden"
                onClick={() => window.print()}
              >
                {t('cancel.print')}
              </Button>
            </Stack>
          </Card>
        </Container>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Container className="max-w-2xl py-10">
        <Card>
          <form onSubmit={submit} className="flex flex-col gap-5">
            <Heading level={1} className="text-2xl">
              {t('withdraw.title')}
            </Heading>
            <Text>{t('withdraw.intro')}</Text>
            <Field label={t('withdraw.nameLabel')}>
              {({ id }) => (
                <Input
                  id={id}
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('withdraw.contractLabel')} hint={t('withdraw.contractHint')}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  required
                  minLength={4}
                  maxLength={254}
                  value={contractRef}
                  onChange={(e) => setContractRef(e.target.value)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <Field label={t('withdraw.emailLabel')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="danger" size="lg" busy={busy}>
              {t('withdraw.submit')}
            </Button>
          </form>
        </Card>
      </Container>
    </PageShell>
  );
}
