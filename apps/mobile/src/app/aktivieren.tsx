import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Choice, Field } from '@/components/form';
import { Banner, Button, Card, P, Screen, Title } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { decalChanged } from '@/lib/decal';
import {
  claimCodeFromLink,
  errorText,
  type PortalVehicle,
  type SubscriptionSummary,
} from '@/lib/portal';
import { pt } from '@/lib/portal-i18n';

interface ClaimInfo {
  partner: string | null;
  promoCode: string | null;
}

/**
 * „Aufkleber einrichten“ (AD-07; moved from the website into the app on 2026-11-24): a pre-printed
 * partner decal becomes the code of one of the owner's vehicles. The code comes from the scanner
 * page's link (`/app/aktivieren#c=…` or `parkshield://aktivieren#c=…`) or is typed in. Checked with
 * `GET /v1/claim/:code`, set up with `POST /v1/vehicles/:id/claim` (the vehicle's old code stops).
 */
export default function Claim() {
  const params = useLocalSearchParams<{ c?: string }>();
  const url = Linking.useURL();
  const router = useRouter();
  const [code, setCode] = useState(params.c ?? '');
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [vehicles, setVehicles] = useState<PortalVehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (raw: string) => {
    setInvalid(false);
    setInfo(null);
    setError(null);
    try {
      setInfo(await api<ClaimInfo>(`/v1/claim/${encodeURIComponent(raw.trim())}`));
    } catch {
      setInvalid(true);
    }
  }, []);

  // The code from the link (also parkshield://aktivieren#c=…, whose fragment the router drops).
  const fromLink = params.c ?? claimCodeFromLink(url);
  useEffect(() => {
    if (!fromLink) return;
    const timer = setTimeout(() => {
      setCode(fromLink);
      void check(fromLink);
    }, 0);
    return () => clearTimeout(timer);
  }, [fromLink, check]);

  useEffect(() => {
    if (!info) return;
    let live = true;
    void Promise.all([
      api<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
      api<{ vehicles: PortalVehicle[] }>('/v1/vehicles'),
    ])
      .then(([s, v]) => {
        if (!live) return;
        setSubscribed(Boolean(s.subscription));
        setVehicles(v.vehicles);
        setVehicleId(v.vehicles[0]?.id ?? null);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [info]);

  const claim = async () => {
    if (!vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      await api<PortalVehicle>(`/v1/vehicles/${vehicleId}/claim`, {
        body: { code: code.trim() },
      });
      decalChanged();
      setDone(vehicleId);
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'code_not_claimable') setInvalid(true);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Screen>
        <Title>{pt('claim.title')}</Title>
        <Banner tone="ok" testID="claim-done">
          {pt('claim.done')}
        </Banner>
        <Button
          label={pt('claim.testNow')}
          onPress={() => router.replace({ pathname: '/fahrzeug/[id]', params: { id: done } })}
        />
      </Screen>
    );

  return (
    <Screen>
      <Title>{pt('claim.title')}</Title>
      <P muted>{pt('claim.intro')}</P>
      <Card>
        <Field
          label={pt('claim.codeLabel')}
          hint={pt('claim.codeHint')}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          ltr
          testID="claim-code"
        />
        <Button
          label={pt('claim.check')}
          variant={info ? 'secondary' : 'primary'}
          disabled={code.trim().length < 6}
          onPress={() => void check(code)}
          testID="claim-check"
        />
        {invalid && <Banner tone="err">{pt('claim.invalid')}</Banner>}
      </Card>
      {info && (
        <Card>
          <Banner tone="info" testID="claim-valid">
            {info.partner ? pt('claim.fromPartner', { partner: info.partner }) : pt('claim.valid')}
          </Banner>
          {subscribed === false ? (
            <>
              <P>{pt('claim.subscribeFirst')}</P>
              <Button label={pt('claim.subscribe')} onPress={() => router.push('/tarif')} />
            </>
          ) : vehicles && vehicles.length === 0 ? (
            <>
              <P>{pt('claim.addVehicleFirst')}</P>
              <Button label={pt('claim.addVehicle')} onPress={() => router.push('/fahrzeuge')} />
            </>
          ) : vehicles ? (
            <>
              <Choice
                legend={pt('claim.vehicle')}
                options={vehicles.map((v) => v.id)}
                value={vehicleId}
                onChange={setVehicleId}
                label={(id) => vehicles.find((v) => v.id === id)?.nickname ?? id}
              />
              <P muted>{pt('claim.replaces')}</P>
              <Button
                label={pt('claim.submit')}
                busy={busy}
                disabled={!vehicleId}
                onPress={() => void claim()}
                testID="claim-submit"
              />
            </>
          ) : null}
        </Card>
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </Screen>
  );
}
