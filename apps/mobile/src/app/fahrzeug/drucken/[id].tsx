import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NoCodeCard } from '@/components/no-code';
import { AddressForm } from '@/components/vehicle-forms';
import { Banner, Button, Card, Chip, Loading, P, Screen, Title, useTheme } from '@/components/ui';
import { api, authHeaders } from '@/lib/api';
import { decalPreviewUrl, printDecalPdf, shareDecalFile, type DecalFile } from '@/lib/decal';
import { lang, t } from '@/lib/i18n';
import {
  appReturnUrl,
  errorText,
  euro,
  payInApp,
  shortEuro,
  type OrderSummary,
  type PortalVehicle,
  type PrintOptions,
} from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { type as typeScale } from '@/theme/tokens';

type OrderResult = { id?: string; url: string; free: boolean };

/** The price of „Drucken und zusenden lassen“ as the owner sees it before confirming. */
function shipPriceText(o: PrintOptions): string {
  if (o.shipped.free) return o.shipped.welcomePrint ? t('printShipWelcome') : t('printShipFree');
  return t('printShipPrice', { price: euro(o.shipped.priceCents, lang()) });
}

/**
 * The print options (2026-11-21), one screen with the price on each option before anything is
 * confirmed: „Selbst drucken – kostenlos“ (PDF 80 × 80 mm with cut marks, PNG, SVG; always free) and
 * „Drucken und zusenden lassen“ (free once as the welcome print, then 3 € incl. VAT, paid on Stripe's
 * page inside the app). Below: this vehicle's print orders and their status.
 */
export default function PrintScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [v, setV] = useState<PortalVehicle | null>(null);
  const [options, setOptions] = useState<PrintOptions | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [vehicle, o, list] = await Promise.all([
        api<PortalVehicle>(`/v1/vehicles/${id}`),
        api<PrintOptions>(`/v1/vehicles/${id}/print-options`),
        api<{ orders: OrderSummary[] }>('/v1/orders').catch(() => ({ orders: [] })),
      ]);
      setV(vehicle);
      setOptions(o);
      setOrders(list.orders.filter((x) => x.vehicleId === id));
    } catch (err) {
      setError(errorText(err));
    }
  }, [id]);

  // Again on return from Stripe's page, so a paid order shows its new status.
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

  return (
    <Screen>
      <Title>{t('printTitle')}</Title>
      <P muted>{t('printIntro')}</P>
      {!v.decal ? (
        <>
          <NoCodeCard vehicle={v} onCreated={() => load()} />
          <P muted>{t('printNoCode')}</P>
        </>
      ) : (
        <>
          <SelfPrint vehicleId={v.id} />
          <Shipped vehicle={v} options={options} onOrdered={load} />
        </>
      )}
      {orders.length > 0 && (
        <Card>
          <Title>{t('printOrders')}</Title>
          {orders.map((o) => (
            <View key={o.id}>
              <P>
                {pt('order.orderLine', {
                  nickname: o.nickname ?? v.nickname,
                  date: new Date(o.createdAt),
                  status: pt(`order.status_${o.status}` as MessageKey),
                })}
              </P>
              {o.trackingNumber && (
                <P muted>{pt('order.tracking', { number: o.trackingNumber })}</P>
              )}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function PriceHead({ title, price, tone }: { title: string; price?: string; tone: 'ok' | 'info' }) {
  const c = useTheme();
  return (
    <View style={s.head}>
      <Text accessibilityRole="header" style={[typeScale.heading, { color: c.fg, flexShrink: 1 }]}>
        {title}
      </Text>
      {price && <Chip tone={tone}>{price}</Chip>}
    </View>
  );
}

/** „Selbst drucken – kostenlos“: the files, free at any time, with the paper notice. */
function SelfPrint({ vehicleId }: { vehicleId: string }) {
  const [busy, setBusy] = useState<'print' | DecalFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: 'print' | DecalFile) => {
    setBusy(what);
    setError(null);
    try {
      await (what === 'print' ? printDecalPdf(vehicleId) : shareDecalFile(vehicleId, what));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <View testID="print-self">
        <PriceHead title={t('printSelfTitle')} tone="ok" />
      </View>
      <P>{t('printSelfText')}</P>
      <Banner tone="warn">{t('printPaper')}</Banner>
      <Button
        label={t('decalPrint')}
        onPress={() => void run('print')}
        busy={busy === 'print'}
        testID="self-print"
      />
      <Button
        label={t('decalShare')}
        variant="secondary"
        onPress={() => void run('pdf')}
        busy={busy === 'pdf'}
        testID="self-pdf"
      />
      <View style={s.row}>
        <View style={s.half}>
          <Button
            label={t('printPng')}
            variant="secondary"
            onPress={() => void run('png')}
            busy={busy === 'png'}
            testID="self-png"
          />
        </View>
        <View style={s.half}>
          <Button
            label={t('printSvg')}
            variant="secondary"
            onPress={() => void run('svg')}
            busy={busy === 'svg'}
            testID="self-svg"
          />
        </View>
      </View>
      {error && <Banner tone="err">{error}</Banner>}
    </Card>
  );
}

// „3 €“ for whole euros: moved to lib/portal.ts (also used by the new-code screen).
export { shortEuro } from '@/lib/portal';

/**
 * „Drucken und zusenden lassen“ (B1): the price is on the card before anything is confirmed. One
 * confirmation step follows on the same screen: the preview with the chosen design and the vehicle
 * label (both printed on the decal, the plate never), „Design ändern“ back to the design screen, the
 * postal address (required, prefilled), the notice that personalised goods have no right of
 * withdrawal, and „Jetzt drucken und zusenden“ (welcome print) or „3 € bezahlen und zusenden“
 * (Stripe's page inside the app, never an in-app purchase). Only that confirmation places the order;
 * the API stores the design snapshot with it.
 */
function Shipped({
  vehicle,
  options,
  onOrdered,
}: {
  vehicle: PortalVehicle;
  options: PrintOptions;
  onOrdered: () => Promise<void>;
}) {
  const c = useTheme();
  const router = useRouter();
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [result, setResult] = useState<'done' | 'canceled' | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const free = options.shipped.free;
  const price = shortEuro(options.shipped.priceCents, lang());
  const p = options.personalization;
  const label = p?.label ?? vehicle.nickname;
  const labelValid = p?.labelValid ?? true;
  const template = p?.template ?? vehicle.decal?.template;
  // The generic QR + NFC sticker from our stock: no name, no design, a new code (2026-11-27).
  const stock = options.shipped.stock === true;
  const preview = decalPreviewUrl(vehicle, p ? { template: p.template, cta: p.cta } : {});

  useEffect(() => {
    void authHeaders().then(setHeaders);
  }, []);

  return (
    <Card>
      <View testID="print-ship">
        <PriceHead
          title={t('printShipTitle')}
          price={shipPriceText(options)}
          tone={free ? 'ok' : 'info'}
        />
      </View>
      {result === 'done' && <Banner tone="ok">{t('printShipDone')}</Banner>}
      {result === 'canceled' && <Banner tone="info">{t('payCanceled')}</Banner>}
      {step === 'choose' ? (
        <>
          <P>{t('printShipText')}</P>
          <Button
            label={t('printShipStart')}
            onPress={() => {
              setResult(null);
              setStep('confirm');
            }}
            testID="ship-start"
          />
        </>
      ) : (
        <View style={s.confirm} testID="ship-confirm">
          <Text accessibilityRole="header" style={[typeScale.heading, { color: c.fg }]}>
            {t('printConfirmTitle')}
          </Text>
          <P muted>{stock ? t('printConfirmIntro') : t('printConfirmIntroOwn')}</P>
          {stock && (
            <View testID="ship-new-code">
              <Banner tone="info">{t('printConfirmNewCode')}</Banner>
            </View>
          )}
          {!stock && preview && headers && (
            <View style={[s.preview, { borderColor: c.border }]}>
              <Image
                testID="ship-preview"
                source={{ uri: preview, headers }}
                contentFit="contain"
                style={s.previewImage}
                accessible={false}
              />
            </View>
          )}
          {!stock && <P>{t('printConfirmLabel', { label })}</P>}
          {!stock && template && (
            <P>
              {t('printConfirmDesign', {
                design: pt(`decal.template_${template}` as MessageKey),
              })}
            </P>
          )}
          {!stock && (
            <Button
              variant="secondary"
              label={t('printChangeDesign')}
              onPress={() =>
                router.push({ pathname: '/fahrzeug/design/[id]', params: { id: vehicle.id } })
              }
              testID="ship-design"
            />
          )}
          {!labelValid && (
            <>
              <Banner tone="err">{t('printLabelInvalid', { label })}</Banner>
              <Button
                variant="secondary"
                label={t('printEditName')}
                onPress={() =>
                  router.push({ pathname: '/fahrzeug/[id]', params: { id: vehicle.id } })
                }
                testID="ship-edit-name"
              />
            </>
          )}
          <Text accessibilityRole="header" style={[typeScale.heading, { color: c.fg }]}>
            {t('printAddressTitle')}
          </Text>
          {/* TODO [LEGAL REVIEW] LEGAL_REVIEW.md §16: the sticker's value on a withdrawal. */}
          <View testID="ship-notice">
            <Banner tone="info">{t('printPersonalNotice')}</Banner>
          </View>
          <AddressForm
            intro={t('printShipText')}
            initial={options.addressPrefill ?? null}
            disabled={!labelValid}
            submitLabel={free ? t('printConfirmFree') : t('printConfirmPaid', { price })}
            onSubmit={async (address) => {
              setResult(null);
              const order = await api<OrderResult>(`/v1/vehicles/${vehicle.id}/order-print`, {
                body: { address, personalizationConfirmed: true, appReturn: appReturnUrl() },
              });
              if (order.free) setResult('done');
              else {
                // The order exists unpaid; Stripe's page with the price opens inside the app.
                const pay = await payInApp(async () => order);
                setResult(pay.result === 'success' ? 'done' : 'canceled');
              }
              setStep('choose');
              await onOrdered();
            }}
          />
          <Button variant="ghost" label={t('back')} onPress={() => setStep('choose')} />
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  confirm: { gap: 12 },
  preview: {
    alignSelf: 'center',
    width: 180,
    height: 180,
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
  },
  previewImage: { width: '100%', height: '100%' },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});
