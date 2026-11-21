import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NoCodeCard } from '@/components/no-code';
import { AddressForm } from '@/components/vehicle-forms';
import { Banner, Button, Card, Chip, Loading, P, Screen, Title, useTheme } from '@/components/ui';
import { api } from '@/lib/api';
import { printDecalPdf, shareDecalFile, type DecalFile } from '@/lib/decal';
import { lang, t } from '@/lib/i18n';
import {
  appReturnUrl,
  errorText,
  euro,
  payInApp,
  type OrderSummary,
  type PortalVehicle,
  type PrintOptions,
} from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';
import { type as typeScale } from '@/theme/tokens';

type OrderResult = { id?: string; url: string; free: boolean };

/** The price of „Drucken und zusenden lassen“ as the owner sees it before confirming. */
export function shipPriceText(o: PrintOptions): string {
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

  useEffect(() => {
    void load();
  }, [load]);

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
          <Shipped vehicleId={v.id} options={options} onOrdered={load} />
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

/**
 * „Drucken und zusenden lassen“: the price is on the card and on the button before the owner confirms.
 * Free (welcome print or a replacement granted by support): ordered at once. Otherwise Stripe's page
 * opens in the app (back through /app/zurueck, like the subscription).
 */
function Shipped({
  vehicleId,
  options,
  onOrdered,
}: {
  vehicleId: string;
  options: PrintOptions;
  onOrdered: () => Promise<void>;
}) {
  const [result, setResult] = useState<'done' | 'canceled' | null>(null);
  const free = options.shipped.free;
  const price = euro(options.shipped.priceCents, lang());
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
      {/* TODO [LEGAL REVIEW] withdrawal right for the paid print order (decal with a personal code). */}
      <AddressForm
        intro={t('printShipText')}
        submitLabel={free ? t('printShipSubmitFree') : t('printShipSubmitPaid', { price })}
        onSubmit={async (address) => {
          setResult(null);
          const order = await api<OrderResult>(`/v1/vehicles/${vehicleId}/order-print`, {
            body: { address, appReturn: appReturnUrl() },
          });
          if (order.free) setResult('done');
          else {
            // The order exists unpaid; Stripe's page with the price opens inside the app.
            const pay = await payInApp(async () => order);
            setResult(pay.result === 'success' ? 'done' : 'canceled');
          }
          await onOrdered();
        }}
      />
    </Card>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});
