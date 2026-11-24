import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AddressForm } from '@/components/vehicle-forms';
import { Banner, Button, Card, Chip, Loading, P, Screen, Title, useTheme } from '@/components/ui';
import { api, authHeaders } from '@/lib/api';
import { decalChanged, decalPreviewUrl, printDecalPdf, shareDecalPdf } from '@/lib/decal';
import { lang, t } from '@/lib/i18n';
import {
  errorText,
  newCodeDate,
  payInApp,
  shortEuro,
  type NewCodeOptions,
  type PortalVehicle,
  type PrintOptions,
} from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { type as typeScale } from '@/theme/tokens';

type Phase = 'confirm' | 'paying' | 'done' | 'later' | 'canceled';

/** Waits for the payment webhook: the vehicle's code changes once the 3 € have arrived. */
export async function waitForNewCode(
  vehicleId: string,
  previousTokenId: string | null,
  tries = 10,
  delayMs = 1500,
): Promise<PortalVehicle | null> {
  for (let i = 0; i < tries; i++) {
    const v = await api<PortalVehicle>(`/v1/vehicles/${vehicleId}`);
    if (v.decal && v.decal.tokenId !== previousTokenId) return v;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * „Neuer Code + gedruckter Aufkleber (3 €)“ (owner decision 2026-11-24): one confirmation step like the
 * 3 € print (B1: design and vehicle label are frozen, personalised goods have no right of withdrawal,
 * postal address), then Stripe's page inside the app — never an in-app purchase (a physical product).
 * The payment issues the new code on the server; this screen then shows it with „Drucken“ and the PDF.
 * Within the 10-day wait the API refuses before any payment page opens; the screen shows the date.
 */
export default function PaidNewCode() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useTheme();
  const [v, setV] = useState<PortalVehicle | null>(null);
  const [print, setPrint] = useState<PrintOptions | null>(null);
  const [options, setOptions] = useState<NewCodeOptions | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [phase, setPhase] = useState<Phase>('confirm');
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [vehicle, p, o] = await Promise.all([
        api<PortalVehicle>(`/v1/vehicles/${id}`),
        api<PrintOptions>(`/v1/vehicles/${id}/print-options`).catch(() => null),
        api<NewCodeOptions>(`/v1/vehicles/${id}/new-code`),
      ]);
      setV(vehicle);
      setPrint(p);
      setOptions(o);
    } catch (err) {
      setError(errorText(err));
    }
  }, [id]);

  useEffect(() => {
    void authHeaders().then(setHeaders);
  }, []);
  // Again when coming back from the design screen (a changed design is printed).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!v || !options)
    return error ? (
      <Screen>
        <Banner tone="err">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );

  const price = shortEuro(options.priceCents, lang());
  const p = print?.personalization;
  const label = p?.label ?? v.nickname;
  const labelValid = p?.labelValid ?? true;
  const template = p?.template ?? v.decal?.template;
  const preview = headers && decalPreviewUrl(v);

  const run = async (what: 'print' | 'share') => {
    setBusy(what);
    setError(null);
    try {
      await (what === 'print' ? printDecalPdf(v.id) : shareDecalPdf(v.id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  if (phase === 'done' || phase === 'paying' || phase === 'later')
    return (
      <Screen>
        <Title>{t('newCodePaidTitle')}</Title>
        {phase === 'paying' && <Banner tone="info">{t('newCodePaying')}</Banner>}
        {phase === 'later' && <Banner tone="info">{t('newCodePaidLater')}</Banner>}
        {phase === 'done' && (
          <Card>
            <View testID="new-code-done">
              <Banner tone="ok">{t('newCodePaidDone')}</Banner>
            </View>
            {preview && (
              <View style={[s.preview, { borderColor: c.border }]}>
                <Image
                  testID="new-code-preview"
                  source={{ uri: preview, headers: headers! }}
                  contentFit="contain"
                  style={s.previewImage}
                  accessibilityLabel={pt('portal.qrHeroTitle')}
                />
              </View>
            )}
            <Button
              label={t('decalPrint')}
              onPress={() => void run('print')}
              busy={busy === 'print'}
              testID="new-code-print"
            />
            <Button
              label={t('decalShare')}
              variant="secondary"
              onPress={() => void run('share')}
              busy={busy === 'share'}
              testID="new-code-pdf"
            />
          </Card>
        )}
        <Button
          variant="ghost"
          label={t('back')}
          onPress={() => router.replace({ pathname: '/fahrzeug/[id]', params: { id: v.id } })}
        />
        {error && <Banner tone="err">{error}</Banner>}
      </Screen>
    );

  return (
    <Screen>
      <View style={s.head}>
        <Text accessibilityRole="header" style={[typeScale.title, { color: c.fg, flexShrink: 1 }]}>
          {t('newCodePaidTitle')}
        </Text>
        <Chip tone="info">{price}</Chip>
      </View>
      {phase === 'canceled' && <Banner tone="info">{t('payCanceled')}</Banner>}
      {!options.paidAvailable ? (
        <Card>
          {options.reason === 'cooldown' && options.nextEligibleAt ? (
            <View testID="new-code-paid-wait">
              <Banner tone="info">
                {t('newCodeWait', { date: newCodeDate(options.nextEligibleAt, lang()) })}
              </Banner>
            </View>
          ) : (
            <P>{t('newCodeNoPlan')}</P>
          )}
          <P muted>{t('newCodeLimit', { days: options.cooldownDays })}</P>
          <Button variant="ghost" label={t('back')} onPress={() => router.back()} />
        </Card>
      ) : (
        <Card>
          <P>{t('newCodePaidIntro')}</P>
          <P muted>{t('newCodeLimit', { days: options.cooldownDays })}</P>
          {preview && (
            <View style={[s.preview, { borderColor: c.border }]}>
              <Image
                source={{ uri: preview, headers: headers! }}
                contentFit="contain"
                style={s.previewImage}
                accessible={false}
              />
            </View>
          )}
          <P>{t('printConfirmLabel', { label })}</P>
          {template && (
            <P>
              {t('printConfirmDesign', {
                design: pt(`decal.template_${template}` as MessageKey),
              })}
            </P>
          )}
          <Button
            variant="secondary"
            label={t('printChangeDesign')}
            onPress={() => router.push({ pathname: '/fahrzeug/design/[id]', params: { id: v.id } })}
          />
          {!labelValid && <Banner tone="err">{t('printLabelInvalid', { label })}</Banner>}
          <Text accessibilityRole="header" style={[typeScale.heading, { color: c.fg }]}>
            {t('printAddressTitle')}
          </Text>
          {/* TODO [LEGAL REVIEW] LEGAL_REVIEW.md §14: withdrawal for the bundle (code + sticker). */}
          <View testID="new-code-notice">
            <Banner tone="info">{t('printPersonalNotice')}</Banner>
          </View>
          <AddressForm
            intro={t('printShipText')}
            initial={print?.addressPrefill ?? null}
            disabled={!labelValid}
            submitLabel={t('printConfirmPaid', { price })}
            onSubmit={async (address) => {
              setError(null);
              const before = v.decal?.tokenId ?? null;
              try {
                const pay = await payInApp((appReturn) =>
                  api<{ id: string; url: string }>(`/v1/vehicles/${v.id}/new-code/order`, {
                    body: { address, personalizationConfirmed: true, appReturn },
                  }),
                );
                if (pay.result !== 'success') {
                  // Closed by hand: the payment may still have gone through (the webhook decides).
                  const fresh =
                    pay.result === 'closed' ? await waitForNewCode(v.id, before, 1) : null;
                  if (fresh) {
                    setV(fresh);
                    setPhase('done');
                    decalChanged();
                  } else setPhase('canceled');
                  return;
                }
                setPhase('paying');
                const fresh = await waitForNewCode(v.id, before);
                if (fresh) {
                  setV(fresh);
                  setPhase('done');
                  decalChanged();
                } else setPhase('later');
              } catch (err) {
                setError(errorText(err));
                await load();
              }
            }}
          />
        </Card>
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  preview: { borderWidth: 1, borderRadius: 16, padding: 12, alignItems: 'center' },
  previewImage: { width: '100%', aspectRatio: 1 },
});
