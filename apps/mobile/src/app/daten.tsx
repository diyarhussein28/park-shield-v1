import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Check } from '@/components/form';
import { Banner, Button, Card, P, Screen, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadAndShare, errorText } from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';

/**
 * „Meine Daten“ (web: /konto/daten, OW-12 / US-32): documents, export (JSON + PDF) and account
 * deletion, both after a fresh sign-in. Deleting the account in the app is also an App Store rule.
 */
export default function Privacy() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [reauth, setReauth] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deletedAt, setDeletedAt] = useState<Date | null>(null);
  const [letter, setLetter] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void api<{ welcomeLetter: boolean }>('/v1/portal/documents')
        .then((r) => setLetter(r.welcomeLetter))
        .catch(() => setLetter(false));
    }, []),
  );

  const handle = (err: unknown) => {
    const body =
      err instanceof ApiError ? (err.body as { error?: string; minutes?: number } | null) : null;
    if (body?.error === 'reauth_required') setReauth(body.minutes ?? 15);
    else setError(errorText(err));
  };

  const download = async (kind: 'json' | 'pdf' | 'letter') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'letter')
        await downloadAndShare(
          '/v1/portal/documents/welcome-letter',
          'parkshield-willkommensbrief.pdf',
          'application/pdf',
        );
      else
        await downloadAndShare(
          kind === 'json' ? '/v1/me/export' : '/v1/me/export.pdf',
          kind === 'json' ? 'parkshield-daten.json' : 'parkshield-daten.pdf',
          kind === 'json' ? 'application/json' : 'application/pdf',
          'POST',
        );
    } catch (err) {
      handle(err);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      const r = await api<{ deletionDueAt: string }>('/v1/me', {
        method: 'DELETE',
        body: { confirm: true },
      });
      setDeletedAt(new Date(r.deletionDueAt));
    } catch (err) {
      handle(err);
    } finally {
      setBusy(null);
    }
  };

  const signInAgain = () => void signOut().then(() => router.replace('/anmelden'));

  return (
    <Screen>
      <P muted>{pt('privacy.intro')}</P>
      {deletedAt ? (
        <Banner tone="info">{pt('privacy.deleteRequested', { date: deletedAt })}</Banner>
      ) : (
        <>
          {reauth !== null && (
            <Banner tone="warn">
              <P>{pt('privacy.reauth', { minutes: reauth })}</P>
              <Button label={pt('privacy.reauthButton')} onPress={signInAgain} />
            </Banner>
          )}
          {error && <Banner tone="err">{error}</Banner>}
          {letter && (
            <Card>
              <Title>{pt('privacy.documentsTitle')}</Title>
              <P>{pt('privacy.documentsIntro')}</P>
              <Button
                label={pt('privacy.welcomeLetter')}
                variant="secondary"
                busy={busy === 'letter'}
                onPress={() => void download('letter')}
              />
            </Card>
          )}
          <Card>
            <Title>{pt('privacy.exportTitle')}</Title>
            <P>{pt('privacy.exportIntro')}</P>
            <Button
              label={pt('privacy.exportJson')}
              busy={busy === 'json'}
              onPress={() => void download('json')}
            />
            <Button
              label={pt('privacy.exportPdf')}
              variant="secondary"
              busy={busy === 'pdf'}
              onPress={() => void download('pdf')}
            />
          </Card>
          <Card>
            <Title>{pt('privacy.deleteTitle')}</Title>
            <P>{pt('privacy.deleteIntro')}</P>
            <Check label={pt('privacy.deleteConfirm')} checked={confirm} onChange={setConfirm} />
            <Button
              label={pt('privacy.deleteButton')}
              variant="danger"
              disabled={!confirm}
              busy={busy === 'delete'}
              onPress={() => void remove()}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}
