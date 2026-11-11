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
  useI18n,
} from '@parkshield/ui';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { PageShell } from '@/components/site-chrome';
import { api, ApiError, hasSession } from '@/lib/api-client';
import { clearPendingClaim, savePendingClaim, usePendingClaim } from '@/lib/pending-claim';
import { useBrowserValue, useFragmentSecret } from '@/lib/use-browser-value';

interface Info {
  partner: string | null;
  promoCode: string | null;
}
interface VehicleItem {
  id: string;
  nickname: string;
}

/**
 * AD-07: set up a pre-printed partner decal. The scanner page links here with the code in the URL
 * fragment (never sent to a server log). Not signed in or not subscribed yet: the code waits in this
 * browser, and the partner's promo code is filled in at checkout.
 */
export function ClaimFlow() {
  const { t } = useI18n();
  const fromLink = useFragmentSecret('c');
  const pending = usePendingClaim();
  const signedIn = useBrowserValue(hasSession, false);
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<'idle' | 'checking' | 'invalid' | 'done'>('idle');
  const [vehicles, setVehicles] = useState<VehicleItem[] | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [vehicleId, setVehicleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);

  async function check(raw: string) {
    setState('checking');
    setError(null);
    try {
      const i = await api<Info>(`/v1/claim/${encodeURIComponent(raw.trim())}`);
      setCode(raw.trim().toUpperCase());
      setInfo(i);
      setState('idle');
      savePendingClaim({
        code: raw.trim().toUpperCase(),
        partner: i.partner,
        promoCode: i.promoCode,
      });
    } catch {
      setState('invalid');
    }
  }

  // The code from the link, or the one remembered before signing in.
  const start = fromLink ?? pending?.code ?? null;
  useEffect(() => {
    if (!start || code || state !== 'idle') return;
    // Deferred: the check sets state, which must not happen synchronously inside the effect.
    const timer = setTimeout(() => void check(start), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  useEffect(() => {
    if (!signedIn || !code) return;
    void (async () => {
      const [sub, list] = await Promise.all([
        api<{ subscription: unknown }>('/v1/billing/subscription').catch(() => ({
          subscription: null,
        })),
        api<{ vehicles: VehicleItem[] }>('/v1/vehicles').catch(() => ({ vehicles: [] })),
      ]);
      setSubscribed(Boolean(sub.subscription));
      setVehicles(list.vehicles);
      setVehicleId((v) => v || list.vehicles[0]?.id || '');
    })();
  }, [signedIn, code]);

  async function claim(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api(`/v1/vehicles/${vehicleId}/claim`, { body: { code } });
      clearPendingClaim();
      setDoneId(vehicleId);
      setState('done');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404 ? t('claim.invalid') : t('auth.genericError'),
      );
    }
  }

  return (
    <PageShell>
      <Container className="max-w-xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('claim.title')}
            </Heading>
            {state === 'done' && doneId ? (
              <>
                <Notice tone="success">{t('claim.done')}</Notice>
                <Link
                  href={`/konto/fahrzeuge/${doneId}`}
                  className="font-semibold text-primary underline"
                >
                  {t('claim.testNow')}
                </Link>
              </>
            ) : !code ? (
              <>
                <Text>{t('claim.intro')}</Text>
                {state === 'invalid' && <Notice tone="danger">{t('claim.invalid')}</Notice>}
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void check(typed);
                  }}
                >
                  <Field label={t('claim.codeLabel')} hint={t('claim.codeHint')}>
                    {({ id, describedBy }) => (
                      <Input
                        id={id}
                        aria-describedby={describedBy}
                        required
                        minLength={10}
                        maxLength={16}
                        autoComplete="off"
                        className="font-mono uppercase"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                      />
                    )}
                  </Field>
                  <Button type="submit" className="w-fit" busy={state === 'checking'}>
                    {t('claim.check')}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Notice tone="info">
                  {info?.partner
                    ? t('claim.fromPartner', { partner: info.partner })
                    : t('claim.valid')}
                  {info?.promoCode && ` ${t('claim.promo', { code: info.promoCode })}`}
                </Notice>
                {!signedIn ? (
                  <>
                    <Text>{t('claim.signInFirst')}</Text>
                    <Link
                      href="/anmelden"
                      className="inline-flex min-h-12 w-fit items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
                    >
                      {t('claim.signIn')}
                    </Link>
                  </>
                ) : subscribed === false ? (
                  <>
                    <Text>{t('claim.subscribeFirst')}</Text>
                    <Link
                      href="/konto"
                      className="inline-flex min-h-12 w-fit items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
                    >
                      {t('claim.subscribe')}
                    </Link>
                  </>
                ) : vehicles && vehicles.length === 0 ? (
                  <>
                    <Text>{t('claim.addVehicleFirst')}</Text>
                    <Link href="/konto/fahrzeuge" className="font-semibold text-primary underline">
                      {t('claim.addVehicle')}
                    </Link>
                  </>
                ) : vehicles ? (
                  <form onSubmit={claim} className="flex flex-col gap-3">
                    <Field label={t('claim.vehicle')} hint={t('claim.replaces')}>
                      {({ id, describedBy }) => (
                        <Select
                          id={id}
                          aria-describedby={describedBy}
                          value={vehicleId}
                          onChange={(e) => setVehicleId(e.target.value)}
                        >
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.nickname}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    {error && <Notice tone="danger">{error}</Notice>}
                    <Button type="submit" className="w-fit">
                      {t('claim.submit')}
                    </Button>
                  </form>
                ) : (
                  <Text>{t('common.loading')}</Text>
                )}
              </>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
