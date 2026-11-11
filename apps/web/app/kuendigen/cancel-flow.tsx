'use client';

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
import { useState, type FormEvent } from 'react';
import { Captcha } from '@/components/captcha';
import { PageShell } from '@/components/site-chrome';
import { api, errorText } from '@/lib/api-client';

/** §312k BGB cancellation: button → this page → "Jetzt kündigen" → receipt page + e-mail confirmation. */
export function CancelFlow({ signedInContract }: { signedInContract: string | null }) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<'ordinary' | 'extraordinary'>('ordinary');
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [captcha, setCaptcha] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState<Date | null>(null);
  const signedIn = signedInContract !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const details = {
      kind,
      ...(kind === 'extraordinary' && reason.trim() ? { reason: reason.trim() } : {}),
    };
    try {
      const r = signedIn
        ? await api<{ receivedAt: string }>('/v1/billing/cancel', { body: details })
        : await api<{ receivedAt: string }>('/v1/billing/cancel-request', {
            body: { ...details, email, contractNo, captcha, locale },
          });
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
                {t('cancel.receivedTitle')}
              </Heading>
              <Notice tone="success">{t('cancel.receivedText', { date: receivedAt })}</Notice>
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
              {t('cancel.title')}
            </Heading>
            <Text>{t('cancel.intro')}</Text>
            {signedIn && (
              <Notice tone="info">
                {t('cancel.signedInHint', { contractNo: signedInContract })}
              </Notice>
            )}

            <Field label={t('cancel.kindLabel')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="ordinary">{t('cancel.ordinary')}</option>
                  <option value="extraordinary">{t('cancel.extraordinary')}</option>
                </Select>
              )}
            </Field>
            {kind === 'extraordinary' && (
              <Field label={t('cancel.reasonLabel')}>
                {({ id }) => (
                  <Textarea
                    id={id}
                    value={reason}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </Field>
            )}
            <Field label={t('cancel.dateLabel')}>
              {({ id }) => (
                <Select id={id} defaultValue="next">
                  <option value="next">{t('cancel.dateNext')}</option>
                </Select>
              )}
            </Field>

            {!signedIn && (
              <>
                <Field label={t('cancel.emailLabel')}>
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
                <Field label={t('cancel.contractLabel')} hint={t('cancel.contractHint')}>
                  {({ id, describedBy }) => (
                    <Input
                      id={id}
                      required
                      autoCapitalize="characters"
                      value={contractNo}
                      maxLength={12}
                      onChange={(e) => setContractNo(e.target.value)}
                      aria-describedby={describedBy}
                    />
                  )}
                </Field>
                <Captcha onSolved={setCaptcha} />
              </>
            )}

            {error && <Notice tone="danger">{error}</Notice>}
            <Button
              type="submit"
              variant="danger"
              size="lg"
              busy={busy}
              disabled={!signedIn && !captcha}
            >
              {t('cancel.submit')}
            </Button>
          </form>
        </Card>
      </Container>
    </PageShell>
  );
}
