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
import { PageShell } from '@/components/site-chrome';
import { api, errorText } from '@/lib/api-client';

/**
 * § 312k BGB: "Verträge hier kündigen" → this confirmation page → "Jetzt kündigen" → receipt page and
 * confirmation e-mail with the end date. The portal opens the same page pre-filled. No captcha, no login
 * and no extra step before the cancellation takes effect. TODO [LEGAL REVIEW]: wording of the page.
 */
export function CancelFlow({ signedInContract }: { signedInContract: string | null }) {
  const { t, locale } = useI18n();
  const [type, setType] = useState<'ordinary' | 'extraordinary'>('ordinary');
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [by, setBy] = useState<'contract' | 'plate'>('contract');
  const [contractNo, setContractNo] = useState('');
  const [plate, setPlate] = useState('');
  const [effective, setEffective] = useState<'next' | 'date'>('next');
  const [date, setDate] = useState('');
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receivedAt: Date; endsAt: Date | null } | null>(null);
  const signedIn = signedInContract !== null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const common = {
      type,
      ...(type === 'extraordinary' && reason.trim() ? { reason: reason.trim() } : {}),
      effective,
      ...(effective === 'date' && date ? { date } : {}),
      ...(confirmationEmail.trim() ? { confirmationEmail: confirmationEmail.trim() } : {}),
    };
    try {
      const r: { receivedAt: string; endsAt?: string } = signedIn
        ? await api<{ receivedAt: string; endsAt: string }>('/v1/portal/cancellations', {
            body: common,
          })
        : await api<{ receivedAt: string }>('/v1/legal/cancellations', {
            body: {
              ...common,
              name,
              email,
              ...(by === 'contract' ? { contractNo } : { plate }),
              locale,
            },
          });
      setDone({
        receivedAt: new Date(r.receivedAt),
        endsAt: r.endsAt ? new Date(r.endsAt) : null,
      });
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <PageShell>
        <Container className="max-w-2xl py-10">
          <Card>
            <Stack gap={4}>
              <Heading level={1} className="text-2xl">
                {t('cancel.receivedTitle')}
              </Heading>
              <Notice tone="success">{t('cancel.receivedText', { date: done.receivedAt })}</Notice>
              {done.endsAt && <Text>{t('cancel.endsText', { date: done.endsAt })}</Text>}
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
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                >
                  <option value="ordinary">{t('cancel.ordinary')}</option>
                  <option value="extraordinary">{t('cancel.extraordinary')}</option>
                </Select>
              )}
            </Field>
            {type === 'extraordinary' && (
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

            {!signedIn && (
              <>
                <Field label={t('cancel.nameLabel')}>
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
                <Field label={t('cancel.identifyBy')}>
                  {({ id }) => (
                    <Select id={id} value={by} onChange={(e) => setBy(e.target.value as typeof by)}>
                      <option value="contract">{t('cancel.byContract')}</option>
                      <option value="plate">{t('cancel.byPlate')}</option>
                    </Select>
                  )}
                </Field>
                {by === 'contract' ? (
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
                ) : (
                  <Field label={t('cancel.plateLabel')}>
                    {({ id }) => (
                      <Input
                        id={id}
                        required
                        autoCapitalize="characters"
                        value={plate}
                        maxLength={16}
                        onChange={(e) => setPlate(e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </>
            )}

            <Field label={t('cancel.dateLabel')}>
              {({ id }) => (
                <Select
                  id={id}
                  value={effective}
                  onChange={(e) => setEffective(e.target.value as typeof effective)}
                >
                  <option value="next">{t('cancel.dateNext')}</option>
                  <option value="date">{t('cancel.dateOn')}</option>
                </Select>
              )}
            </Field>
            {effective === 'date' && (
              <Field label={t('cancel.dateValue')} hint={t('cancel.dateHint')}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    aria-describedby={describedBy}
                    className="max-w-xs"
                  />
                )}
              </Field>
            )}
            <Field
              label={t('cancel.confirmLabel')}
              hint={t('cancel.confirmHint')}
              optionalLabel={t('common.optional')}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  type="email"
                  autoComplete="email"
                  value={confirmationEmail}
                  onChange={(e) => setConfirmationEmail(e.target.value)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>

            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="danger" size="lg" busy={busy}>
              {t('cancel.submit')}
            </Button>
          </form>
        </Card>
      </Container>
    </PageShell>
  );
}
