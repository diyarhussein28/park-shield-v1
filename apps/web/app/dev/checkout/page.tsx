'use client';

import { Button, Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { useBrowserValue } from '@/lib/use-browser-value';

const readSessionId = () => new URLSearchParams(window.location.search).get('session');

interface FakeSession {
  title: string;
  amountCents: number;
  cancelUrl: string;
}

/** Local stand-in for Stripe Checkout; the API only serves it while STRIPE_SECRET_KEY is empty. */
export default function DevCheckout() {
  const { t, locale } = useI18n();
  const id = useBrowserValue<string | null | undefined>(readSessionId, undefined);
  const [loaded, setLoaded] = useState<FakeSession | 'gone' | null>(null);
  const [busy, setBusy] = useState(false);
  const session = id === null ? 'gone' : loaded;

  useEffect(() => {
    if (!id) return;
    api<FakeSession>(`/v1/dev/payments/sessions/${encodeURIComponent(id)}`).then(setLoaded, () =>
      setLoaded('gone'),
    );
  }, [id]);

  async function pay() {
    setBusy(true);
    const { redirectUrl } = await api<{ redirectUrl: string }>('/v1/dev/payments/complete', {
      body: { sessionId: id },
    });
    window.location.assign(redirectUrl);
  }

  const euro = (cents: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);

  return (
    <main id="main">
      <Container className="max-w-lg py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('dev.checkoutTitle')}
            </Heading>
            <Notice tone="warning">{t('dev.checkoutIntro')}</Notice>
            {session === 'gone' && <Notice tone="danger">{t('dev.sessionGone')}</Notice>}
            {session && session !== 'gone' && (
              <>
                <Text className="text-lg font-semibold">
                  {session.title} · {t('dev.amount', { amount: euro(session.amountCents) })}
                </Text>
                <Button size="lg" onClick={pay} busy={busy}>
                  {t('dev.pay')}
                </Button>
                <a className="text-center text-primary underline" href={session.cancelUrl}>
                  {t('dev.cancel')}
                </a>
              </>
            )}
          </Stack>
        </Card>
      </Container>
    </main>
  );
}
