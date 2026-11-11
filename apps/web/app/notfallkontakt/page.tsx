'use client';

import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useEffect, useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api } from '@/lib/api-client';
import { useFragmentSecret } from '@/lib/use-browser-value';

interface Invitation {
  contactName: string;
  ownerName: string | null;
  vehicleNickname: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'revoked';
}
type Outcome = 'accepted' | 'declined' | 'withdrawn';

/** US-24: the invited person decides here, without an account. Nothing happens on opening the link. */
export default function InvitationPage() {
  const { t } = useI18n();
  const token = useFragmentSecret('t');
  const [inv, setInv] = useState<Invitation | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!token) return;
    api<Invitation>('/v1/emergency-contact-invitations/view', { body: { token } }).then(
      setInv,
      () => setInvalid(true),
    );
  }, [token]);

  async function decide(decision: 'accept' | 'decline' | 'withdraw') {
    setBusy(true);
    try {
      await api('/v1/emergency-contact-invitations/decide', { body: { token, decision } });
      setOutcome(
        decision === 'accept' ? 'accepted' : decision === 'decline' ? 'declined' : 'withdrawn',
      );
    } catch {
      setInvalid(true);
    } finally {
      setBusy(false);
    }
  }

  const owner = inv?.ownerName ?? 'ParkShield';
  return (
    <PageShell>
      <Container className="max-w-xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('invitation.title')}
            </Heading>
            {(invalid || token === null) && (
              <Notice tone="danger">{t('invitation.invalid')}</Notice>
            )}
            {inv && !invalid && outcome && (
              <Notice tone="success">{t(`invitation.${outcome}`, { owner })}</Notice>
            )}
            {inv && !invalid && !outcome && inv.status === 'pending' && (
              <>
                <Text className="text-lg font-semibold">{t('invitation.ask', { owner })}</Text>
                <Text>
                  {t('invitation.explain1', { owner, vehicle: inv.vehicleNickname ?? 'all' })}
                </Text>
                <Text>{t('invitation.explain2')}</Text>
                <Text muted>{t('invitation.explain3')}</Text>
                <div className="flex flex-wrap gap-3">
                  <Button size="lg" busy={busy} onClick={() => decide('accept')}>
                    {t('invitation.accept')}
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => decide('decline')}
                  >
                    {t('invitation.decline')}
                  </Button>
                </div>
              </>
            )}
            {inv && !invalid && !outcome && inv.status === 'confirmed' && (
              <>
                <Notice tone="success">{t('invitation.confirmedState', { owner })}</Notice>
                <Button
                  variant="secondary"
                  className="w-fit"
                  busy={busy}
                  onClick={() => decide('withdraw')}
                >
                  {t('invitation.withdraw')}
                </Button>
              </>
            )}
            {inv && !invalid && !outcome && inv.status === 'declined' && (
              <Notice tone="info">{t('invitation.declined')}</Notice>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
