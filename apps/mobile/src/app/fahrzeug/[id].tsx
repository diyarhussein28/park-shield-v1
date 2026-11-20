import { ADDON_PRICES_CENTS } from '@parkshield/shared/plans';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Badge, Choice, Field, H3 } from '@/components/form';
import { WindscreenArt } from '@/components/art';
import { Collapsible, Group, Row } from '@/components/list';
import { AddressForm, VehicleForm } from '@/components/vehicle-forms';
import { Banner, Button, Card, Loading, P, Screen, Title, useTheme } from '@/components/ui';
import { api, ApiError, authHeaders } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { printDecalPdf, shareDecalPdf } from '@/lib/decal';
import { lang, t } from '@/lib/i18n';
import {
  errorText,
  euro,
  payInApp,
  type OrderSummary,
  type PortalVehicle,
  type VehicleMode,
  type VehicleModeKind,
  type VehicleProtection,
} from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';

const svg = (id: string, q: Record<string, string>) =>
  `${API_URL}/v1/vehicles/${id}/decal.svg?${new URLSearchParams(q)}`;

/**
 * One vehicle, exactly like the website's vehicle page: its QR code (print PDF, test), the decal
 * design, the printed decal order, vehicle modes, Protected Mode, details, a new code with an optional
 * replacement decal (paid on Stripe's page inside the app), and deleting the vehicle.
 */
export default function VehicleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [v, setV] = useState<PortalVehicle | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [canOrder, setCanOrder] = useState(false);
  const [freeReplacements, setFree] = useState(0);
  const [mode, setMode] = useState<VehicleMode | null>(null);
  const [protection, setProtection] = useState<VehicleProtection | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [vehicle, o, m, p] = await Promise.all([
        api<PortalVehicle>(`/v1/vehicles/${id}`),
        api<{ orders: OrderSummary[]; includedAvailable: boolean; freeReplacements: number }>(
          '/v1/orders',
        ),
        api<{ mode: VehicleMode | null }>(`/v1/vehicles/${id}/mode`).catch(() => ({ mode: null })),
        api<VehicleProtection>(`/v1/vehicles/${id}/protection`).catch(() => null),
      ]);
      setV(vehicle);
      setOrders(o.orders.filter((x) => x.vehicleId === id));
      setCanOrder(o.includedAvailable);
      setFree(o.freeReplacements);
      setMode(m.mode);
      setProtection(p ?? { active: false, source: null, activeUntil: null });
    } catch (err) {
      setError(errorText(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
    void authHeaders().then(setHeaders);
  }, [load]);

  if (!v || !headers)
    return error ? (
      <Screen>
        <Banner tone="err">{error}</Banner>
      </Screen>
    ) : (
      <Loading />
    );

  const remove = () =>
    Alert.alert(pt('vehicles.delete'), pt('vehicles.deleteConfirm'), [
      { text: pt('common.cancel'), style: 'cancel' },
      {
        text: pt('vehicles.delete'),
        style: 'destructive',
        onPress: () =>
          void api(`/v1/vehicles/${v.id}`, { method: 'DELETE' })
            .then(() => router.back())
            .catch((err) => setError(errorText(err))),
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: v.nickname }} />
      <P muted>{[v.plate, v.color, v.makeModel].filter(Boolean).join(' · ')}</P>
      {v.decal && (
        <QrHero
          key={`${v.decal.tokenId}-${v.decal.template}-${v.decal.cta}`}
          vehicle={v}
          headers={headers}
        />
      )}
      {v.decal && (
        <Group>
          <Row
            icon="palette"
            iconTone="accent"
            title={t('designOpen')}
            detail={pt(`decal.template_${v.decal.template}` as MessageKey)}
            onPress={() => router.push({ pathname: '/fahrzeug/design/[id]', params: { id: v.id } })}
            testID="design-open"
          />
        </Group>
      )}

      <Orders
        vehicle={v}
        orders={orders}
        canOrder={canOrder}
        onOrdered={(o) => {
          setOrders((list) => [o, ...list]);
          setCanOrder(false);
        }}
      />
      <ModeCard vehicleId={v.id} initial={mode} />
      {protection && <ProtectionCard vehicleId={v.id} initial={protection} />}

      <Details vehicle={v} onSaved={setV} />

      {v.decal && (
        <RevokeAndReplace
          vehicle={v}
          onReissued={setV}
          onPaid={load}
          freeReplacement={freeReplacements > 0}
          showReplacement={!canOrder}
        />
      )}

      <Card>
        <Title>{pt('vehicles.delete')}</Title>
        <P muted>{pt('portal.deleteIntro')}</P>
        <Button label={pt('vehicles.delete')} variant="danger" onPress={remove} />
      </Card>
      {error && <Banner tone="err">{error}</Banner>}
    </Screen>
  );
}

/**
 * The vehicle's QR code first (P10): the decal, then „Drucken“ and „Teilen oder sichern“ right
 * under it, how to put it on folded away, and „Aufkleber testen“.
 */
function QrHero({ vehicle, headers }: { vehicle: PortalVehicle; headers: Record<string, string> }) {
  const c = useTheme();
  const decal = vehicle.decal!;
  const [open, setOpen] = useState<{ until: string; scanUrl: string } | null>(null);
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    try {
      setOpen(
        await api<{ until: string; scanUrl: string }>(`/v1/vehicles/${vehicle.id}/test-window`, {
          body: {},
        }),
      );
    } catch (err) {
      setError(errorText(err));
    }
  };
  const run = async (what: 'print' | 'share') => {
    setBusy(what);
    setError(null);
    try {
      await (what === 'print' ? printDecalPdf(vehicle.id) : shareDecalPdf(vehicle.id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card style={{ borderColor: c.primary, borderWidth: 2 }}>
      <Title>{pt('portal.qrHeroTitle')}</Title>
      <Badge tone={decal.status === 'assigned' ? 'ok' : 'info'}>
        {pt('vehicles.decalStatus', {
          hint: decal.codeHint,
          status: pt(`vehicles.status_${decal.status}` as MessageKey),
        })}
      </Badge>
      {decal.status !== 'revoked' && (
        <View style={[s.decal, { borderColor: c.border }]}>
          <Image
            source={{ uri: svg(vehicle.id, { template: decal.template, cta: decal.cta }), headers }}
            contentFit="contain"
            style={s.square}
            accessibilityLabel={pt('portal.qrAlt', { nickname: vehicle.nickname })}
          />
        </View>
      )}
      <View style={s.actions}>
        <View style={s.action}>
          <Button
            label={t('decalPrint')}
            onPress={() => void run('print')}
            busy={busy === 'print'}
            testID="decal-print"
          />
        </View>
        <View style={s.action}>
          <Button
            label={t('decalShare')}
            variant="secondary"
            onPress={() => void run('share')}
            busy={busy === 'share'}
            testID="decal-share"
          />
        </View>
      </View>
      <P muted>{pt('decal.homePdfHint')}</P>
      <Collapsible title={t('decalGuideTitle')} testID="decal-guide">
        <WindscreenArt width={220} />
        {(['decalGuideStep1', 'decalGuideStep2', 'decalGuideStep3'] as const).map((k, i) => (
          <P key={k}>
            {i + 1}. {t(k)}
          </P>
        ))}
      </Collapsible>
      <H3>{pt('decalTest.title')}</H3>
      <P>{pt('decalTest.intro')}</P>
      <P muted>
        {decal.lastTestAt
          ? pt('decalTest.lastTest', { date: new Date(decal.lastTestAt) })
          : pt('decalTest.never')}
      </P>
      {open ? (
        <>
          <Banner tone="info">{pt('decalTest.open', { time: new Date(open.until) })}</Banner>
          <Button
            label={pt('decalTest.openHere')}
            variant="secondary"
            onPress={() => void Linking.openURL(open.scanUrl)}
          />
        </>
      ) : (
        <Button label={pt('decalTest.button')} variant="secondary" onPress={() => void start()} />
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </Card>
  );
}

/** The decal included in the plan (address in Germany) and every order with its status. */
function Orders({
  vehicle,
  orders,
  canOrder,
  onOrdered,
}: {
  vehicle: PortalVehicle;
  orders: OrderSummary[];
  canOrder: boolean;
  onOrdered: (o: OrderSummary) => void;
}) {
  const [justOrdered, setJustOrdered] = useState(false);
  return (
    <Card>
      <Title>{pt('order.title')}</Title>
      {justOrdered && <Banner tone="ok">{pt('order.submitted')}</Banner>}
      {canOrder ? (
        <AddressForm
          intro={pt('order.includedIntro')}
          submitLabel={pt('order.submit')}
          onSubmit={async (address) => {
            onOrdered(
              await api<OrderSummary>(`/v1/vehicles/${vehicle.id}/order-included`, {
                body: { address },
              }),
            );
            setJustOrdered(true);
          }}
        />
      ) : (
        orders.length === 0 && <P muted>{pt('order.used')}</P>
      )}
      {orders.map((o) => (
        <View key={o.id}>
          <P>
            {pt('order.orderLine', {
              nickname: o.nickname ?? vehicle.nickname,
              date: new Date(o.createdAt),
              status: pt(`order.status_${o.status}` as MessageKey),
            })}
          </P>
          {o.trackingNumber && <P muted>{pt('order.tracking', { number: o.trackingNumber })}</P>}
        </View>
      ))}
    </Card>
  );
}

const MODES: VehicleModeKind[] = ['sensitive_spot', 'short_stop'];
const DURATIONS = [30, 60, 120, 240, 480, 720];

/** OW-17 / US-26: „Sensibler Ort“ (urgent only) or „Kurzer Halt“ (return time shown), up to 12 h. */
function ModeCard({ vehicleId, initial }: { vehicleId: string; initial: VehicleMode | null }) {
  const [active, setActive] = useState(initial);
  const [mode, setMode] = useState<VehicleModeKind>('short_stop');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setActive(
        (
          await api<{ mode: VehicleMode | null }>(`/v1/vehicles/${vehicleId}/mode`, {
            body: { mode, minutes },
          })
        ).mode,
      );
    } catch (err) {
      setMessage({ tone: 'err', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };
  const end = async () => {
    setBusy(true);
    try {
      await api(`/v1/vehicles/${vehicleId}/mode`, { method: 'DELETE' });
      setActive(null);
      setMessage({ tone: 'ok', text: pt('modes.ended') });
    } catch (err) {
      setMessage({ tone: 'err', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Title>{pt('modes.title')}</Title>
      <P>{pt('modes.intro')}</P>
      {active ? (
        <>
          <Banner tone="info">
            {pt('modes.active', {
              mode: pt(`modes.${active.mode}`),
              until: new Date(active.endsAt),
            })}
          </Banner>
          <Button
            label={pt('modes.end')}
            variant="secondary"
            busy={busy}
            onPress={() => void end()}
          />
        </>
      ) : (
        <>
          <Choice
            options={MODES}
            value={mode}
            onChange={setMode}
            label={(m) => pt(`modes.${m}`)}
            hint={(m) => pt(`modes.${m}Hint`)}
          />
          <Choice
            legend={pt('modes.duration')}
            options={DURATIONS}
            value={minutes}
            onChange={setMinutes}
            label={(d) => pt('modes.minutes', { minutes: d, hours: d / 60 })}
          />
          <Button label={pt('modes.start')} busy={busy} onPress={() => void start()} />
        </>
      )}
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
    </Card>
  );
}

/** Abuse protection §4: Protected Mode per vehicle. */
function ProtectionCard({ vehicleId, initial }: { vehicleId: string; initial: VehicleProtection }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (active: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setState(
        await api<VehicleProtection>(`/v1/vehicles/${vehicleId}/protection`, {
          method: 'PUT',
          body: { active },
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Title>{pt('protectedMode.title')}</Title>
      <P muted>{pt('protectedMode.intro')}</P>
      {state.active ? (
        <Banner tone="info">
          {state.activeUntil
            ? pt(
                state.source === 'auto' ? 'protectedMode.activeAuto' : 'protectedMode.activeUntil',
                {
                  until: new Date(state.activeUntil),
                },
              )
            : pt('protectedMode.activeManual')}
        </Banner>
      ) : (
        <P muted>{pt('protectedMode.off')}</P>
      )}
      <Button
        label={state.active ? pt('protectedMode.turnOff') : pt('protectedMode.turnOn')}
        variant={state.active ? 'secondary' : 'primary'}
        busy={busy}
        onPress={() => void toggle(!state.active)}
      />
      {error && <Banner tone="err">{error}</Banner>}
    </Card>
  );
}

function Details({
  vehicle,
  onSaved,
}: {
  vehicle: PortalVehicle;
  onSaved: (v: PortalVehicle) => void;
}) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <Title>{pt('vehicles.details')}</Title>
      {saved && <Banner tone="ok">{pt('vehicles.saved')}</Banner>}
      <VehicleForm
        initial={vehicle}
        submitLabel={pt('vehicles.save')}
        onSubmit={async (input) => {
          setError(null);
          try {
            onSaved(
              await api<PortalVehicle>(`/v1/vehicles/${vehicle.id}`, {
                method: 'PATCH',
                body: input,
              }),
            );
            setSaved(true);
          } catch (err) {
            setError(errorText(err));
          }
        }}
      />
      {error && <Banner tone="err">{error}</Banner>}
    </Card>
  );
}

const REASONS = ['leaked', 'car_sold', 'damaged', 'other'] as const;

/** US-13: revoke the code (a new one is issued at once) and order a replacement decal. */
function RevokeAndReplace({
  vehicle,
  onReissued,
  onPaid,
  freeReplacement,
  showReplacement,
}: {
  vehicle: PortalVehicle;
  onReissued: (v: PortalVehicle) => void;
  onPaid: () => Promise<void>;
  freeReplacement: boolean;
  showReplacement: boolean;
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number]>('leaked');
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<'paid' | 'canceled' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const price = freeReplacement
    ? pt('replacement.free')
    : euro(ADDON_PRICES_CENTS.replacementDecal, lang());

  const revoke = () =>
    Alert.alert(pt('revoke.title'), pt('revoke.confirm'), [
      { text: pt('common.cancel'), style: 'cancel' },
      {
        text: pt('revoke.button'),
        style: 'destructive',
        onPress: () =>
          void api<PortalVehicle>(`/v1/vehicles/${vehicle.id}/tokens`, {
            body: { confirm: true, reason },
          })
            .then((v) => {
              onReissued(v);
              setDone(true);
            })
            .catch((err) => setError(errorText(err))),
      },
    ]);

  return (
    <Card>
      <Title>{pt('revoke.title')}</Title>
      <P muted>{pt('revoke.intro')}</P>
      {done && <Banner tone="ok">{pt('revoke.done')}</Banner>}
      <Choice
        legend={pt('revoke.reason')}
        options={REASONS}
        value={reason}
        onChange={setReason}
        label={(r) => pt(`revoke.reason_${r}` as MessageKey)}
      />
      <Button label={pt('revoke.button')} variant="danger" onPress={revoke} />
      {showReplacement && (
        <>
          <H3>{pt('replacement.title')}</H3>
          {result === 'paid' && <Banner tone="ok">{pt('replacement.paid')}</Banner>}
          {result === 'canceled' && <Banner tone="warn">{pt('replacement.canceled')}</Banner>}
          <AddressForm
            intro={
              freeReplacement ? pt('replacement.freeIntro') : pt('replacement.intro', { price })
            }
            submitLabel={pt('replacement.submit', { price })}
            onSubmit={async (address) => {
              const r = await payInApp((appReturn) =>
                api<{ url: string }>(`/v1/vehicles/${vehicle.id}/order-replacement`, {
                  body: { address, appReturn },
                }),
              );
              setResult(
                r.result === 'success' ? 'paid' : r.result === 'canceled' ? 'canceled' : null,
              );
              await onPaid();
            }}
          />
        </>
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </Card>
  );
}

const s = StyleSheet.create({
  decal: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    padding: 8,
  },
  square: { width: '100%', aspectRatio: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  action: { flexGrow: 1, flexBasis: 140 },
});
