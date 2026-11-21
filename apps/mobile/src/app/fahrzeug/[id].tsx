import { ADDON_PRICES_CENTS } from '@parkshield/shared/plans';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Badge, Choice, H3 } from '@/components/form';
import { WindscreenArt } from '@/components/art';
import { Collapsible, Group, Row } from '@/components/list';
import { NoCodeCard } from '@/components/no-code';
import { VehicleForm } from '@/components/vehicle-forms';
import { Banner, Button, Card, Loading, P, Screen, Title, useTheme } from '@/components/ui';
import { api, authHeaders } from '@/lib/api';
import {
  decalChanged,
  decalPreviewUrl,
  onDecalChange,
  printDecalPdf,
  shareDecalPdf,
} from '@/lib/decal';
import { lang, t } from '@/lib/i18n';
import {
  errorText,
  euro,
  type PortalVehicle,
  type PrintOptions,
  type VehicleMode,
  type VehicleModeKind,
  type VehicleProtection,
} from '@/lib/portal';
import { pt, type MessageKey } from '@/lib/portal-i18n';

/**
 * One vehicle, like the website's vehicle page: its QR code (print PDF, test) or „Kein aktiver Code“,
 * the decal design, the print options (own screen, prices first), vehicle modes, Protected Mode,
 * details, „Sperren“ (no new code is created; that is an explicit, free action), and deleting it.
 */
export default function VehicleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [v, setV] = useState<PortalVehicle | null>(null);
  const [options, setOptions] = useState<PrintOptions | null>(null);
  const [created, setCreated] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [mode, setMode] = useState<VehicleMode | null>(null);
  const [protection, setProtection] = useState<VehicleProtection | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [vehicle, o, m, p] = await Promise.all([
        api<PortalVehicle>(`/v1/vehicles/${id}`),
        api<PrintOptions>(`/v1/vehicles/${id}/print-options`).catch(() => null),
        api<{ mode: VehicleMode | null }>(`/v1/vehicles/${id}/mode`).catch(() => ({ mode: null })),
        api<VehicleProtection>(`/v1/vehicles/${id}/protection`).catch(() => null),
      ]);
      setV(vehicle);
      setOptions(o);
      setMode(m.mode);
      setProtection(p ?? { active: false, source: null, activeUntil: null });
    } catch (err) {
      setError(errorText(err));
    }
  }, [id]);

  useEffect(() => {
    void authHeaders().then(setHeaders);
  }, []);
  // Again when coming back from the design screen, and at once on any decal change (Stage 4.3).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => onDecalChange(() => void load()), [load]);

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
      {revoked && !v.decal && <Banner tone="ok">{t('revokeDone')}</Banner>}
      {!v.decal && (
        <NoCodeCard
          vehicle={v}
          onCreated={async (fresh) => {
            if (fresh) setV(fresh);
            else await load();
            setRevoked(false);
            setCreated(true);
          }}
        />
      )}
      {created && v.decal && <Banner tone="ok">{t('newCodeDone')}</Banner>}
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
            icon="printer"
            iconTone="accent"
            title={t('printOpen')}
            detail={
              options?.shipped.free
                ? options.shipped.welcomePrint
                  ? t('printShipWelcome')
                  : t('printShipFree')
                : undefined
            }
            onPress={() =>
              router.push({ pathname: '/fahrzeug/drucken/[id]', params: { id: v.id } })
            }
            testID="print-open"
          />
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

      <ModeCard vehicleId={v.id} initial={mode} />
      {protection && <ProtectionCard vehicleId={v.id} initial={protection} />}

      <Details vehicle={v} onSaved={setV} />

      {v.decal && (
        <RevokeCard
          vehicle={v}
          shipPriceCents={
            options && !options.shipped.free
              ? options.shipped.priceCents
              : ADDON_PRICES_CENTS.printShipped
          }
          onRevoked={(fresh) => {
            setCreated(false);
            setRevoked(true);
            setV(fresh);
          }}
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
            source={{ uri: decalPreviewUrl(vehicle)!, headers }}
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

/**
 * „Sperren“ (2026-11-21): the code stops working at once and NO new code is created. The dialog says
 * exactly that, and what comes next costs: a new code is free, self-printing is free, printing and
 * shipping costs 3 € (after the free welcome print). Afterwards the vehicle shows „Kein aktiver Code“.
 */
function RevokeCard({
  vehicle,
  shipPriceCents,
  onRevoked,
}: {
  vehicle: PortalVehicle;
  shipPriceCents: number;
  onRevoked: (v: PortalVehicle) => void;
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number]>('leaked');
  const [error, setError] = useState<string | null>(null);
  const price = euro(shipPriceCents, lang());

  const revoke = () =>
    Alert.alert(
      t('revokeConfirmTitle'),
      [
        t('revokeConfirm1'),
        t('revokeConfirm2'),
        t('revokeConfirm3'),
        t('revokeConfirm4', { price }),
      ]
        .map((line) => `• ${line}`)
        .join('\n'),
      [
        { text: pt('common.cancel'), style: 'cancel' },
        {
          text: t('revokeButton'),
          style: 'destructive',
          onPress: () =>
            void api<PortalVehicle>(`/v1/vehicles/${vehicle.id}/tokens/revoke`, {
              body: { confirm: true, reason },
            })
              .then((v) => {
                onRevoked(v);
                decalChanged();
              })
              .catch((err) => setError(errorText(err))),
        },
      ],
    );

  return (
    <Card>
      <Title>{t('revokeTitle')}</Title>
      <P muted>{t('revokeIntro')}</P>
      <Choice
        legend={t('revokeReason')}
        options={REASONS}
        value={reason}
        onChange={setReason}
        label={(r) => t(`revokeReason_${r}`)}
      />
      <Button label={t('revokeButton')} variant="danger" onPress={revoke} testID="revoke" />
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
