import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Linking } from 'react-native';
import { shareDecalPdf } from '@/lib/decal';
import { lang, t } from '@/lib/i18n';
import { saveLang } from '@/lib/language';
import { pt } from '@/lib/portal-i18n';
import { euro, longDate, type PortalVehicle, type SubscriptionSummary } from '@/lib/portal';
import { setSession } from '@/lib/session';
import Privacy from '@/app/daten';
import VehicleDetail from '@/app/fahrzeug/[id]';
import Vehicles from '@/app/(tabs)/fahrzeuge';
import { HistoryList as History } from '@/components/history-list';
import Cancel from '@/app/kuendigen';
import Account from '@/app/abo';
import { ContractCard } from '@/components/subscription';
import Notifications from '@/app/benachrichtigungen';
import PrintScreen from '@/app/fahrzeug/drucken/[id]';
import Plans from '@/app/tarif';

const VEHICLE = '7c2e1f40-5b6a-4d3e-9f10-2a3b4c5d6e7f';
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockFiles: { uri: string; written?: Uint8Array; deleted: boolean }[] = [];

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '7c2e1f40-5b6a-4d3e-9f10-2a3b4c5d6e7f' }),
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: mockReplace,
    navigate: mockNavigate,
  }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cb, []);
  },
  Stack: { Screen: () => null },
}));
jest.mock('expo-image', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: (p: {
      source: { uri: string; headers: Record<string, string> };
      accessibilityLabel: string;
    }) => (
      <Text testID="decal-image">{`${p.source.uri}|${p.source.headers.authorization}|${p.accessibilityLabel}`}</Text>
    ),
  };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `exp://192.168.178.25:8082/--/${path}`,
  parse: (url: string) => ({
    queryParams: Object.fromEntries(new URL(url.replace('exp://', 'http://')).searchParams),
  }),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'cache' },
  File: jest.fn().mockImplementation((_dir: string, name: string) => {
    const f = {
      uri: `file:///cache/${name}`,
      deleted: false,
      written: undefined as Uint8Array | undefined,
      get exists() {
        return !f.deleted;
      },
      write(b: Uint8Array) {
        f.written = b;
      },
      delete() {
        f.deleted = true;
      },
    };
    mockFiles.push(f);
    return f;
  }),
}));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ signOut: jest.fn(async () => undefined) }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

const SESSION = 'session-token-0000000000000000000001';
const json = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
  } as unknown as Response);

const vehicle = (over: Partial<PortalVehicle> = {}): PortalVehicle => ({
  id: VEHICLE,
  nickname: 'Der Blaue',
  plate: 'K-AB 123',
  makeModel: 'VW Golf',
  color: 'Blau',
  createdAt: '2026-11-19T12:00:00Z',
  decal: {
    tokenId: 't1',
    codeHint: 'K3Q9',
    status: 'assigned',
    cta: 'Bitte scannen bei Problemen',
    template: 'classic',
    activatedAt: null,
    lastTestAt: null,
    testWindowUntil: null,
  } as PortalVehicle['decal'],
  ...over,
});

const subscription = (over: Partial<SubscriptionSummary> = {}): SubscriptionSummary => ({
  plan: 'standard',
  status: 'active',
  contractNo: 'PS-7K3Q9X2M',
  currentPeriodEnd: '2027-11-19T12:00:00Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  interval: 'year',
  renewalMode: 'annual',
  withdrawalOpenUntil: null,
  ...over,
});

const me = {
  email: 'kim@example.de',
  customerNo: 'PS-2026-000042',
  preferredLang: 'de',
  summaryFrequency: 'monthly',
  escalationMinutes: null,
  timezone: 'Europe/Berlin',
  passkeys: [],
};

type Handler = (init: RequestInit) => Promise<Response>;

/** Routes fetch by method + URL (query ignored), so each test only says what the API answers. */
function api(routes: Record<string, Handler>) {
  global.fetch = jest.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url.replace('https://api.test', '')}`;
    const handler = routes[key] ?? routes[key.split('?')[0]!];
    if (!handler) throw new Error(`unexpected ${key}`);
    return handler(init);
  }) as jest.Mock;
}
const sent = (method: string, path: string) => {
  const call = (global.fetch as jest.Mock).mock.calls.find(
    ([u, i]: [string, RequestInit | undefined]) =>
      u.split('?')[0]!.endsWith(path) && (i?.method ?? 'GET') === method,
  );
  return call ? JSON.parse(String(call[1].body)) : undefined;
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockFiles.length = 0;
  await setSession(SESSION);
});

describe('vehicles', () => {
  it('lists the vehicles; a tap opens the vehicle', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [vehicle()] }),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
    });
    await render(<Vehicles />);
    expect(await screen.findByText('Der Blaue')).toBeTruthy();
    expect(screen.getByText('K-AB 123 · Blau · VW Golf')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(`Der Blaue, ${pt('vehicles.open')}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/fahrzeug/[id]', params: { id: VEHICLE } });
  });

  it('adds a vehicle and opens it', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [] }),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
      'POST /v1/vehicles': () => json(vehicle()),
    });
    await render(<Vehicles />);
    await fireEvent.changeText(await screen.findByLabelText(pt('vehicles.nickname')), 'Der Blaue');
    await fireEvent.changeText(screen.getByLabelText(pt('vehicles.plate')), 'K-AB 123');
    await fireEvent.press(screen.getAllByLabelText(pt('vehicles.add')).at(-1)!);
    // The first QR code is a success moment (P8).
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/erfolg',
        params: { kind: 'qr', vehicleId: VEHICLE, nickname: 'Der Blaue' },
      }),
    );
    expect(sent('POST', '/v1/vehicles')).toEqual({
      nickname: 'Der Blaue',
      plate: 'K-AB 123',
      color: '',
      makeModel: '',
    });
  });

  it('an invalid plate says what to check, not „something went wrong“ (QA)', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [] }),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
      'POST /v1/vehicles': () => json({ error: 'invalid_request' }, 400),
    });
    await render(<Vehicles />);
    await fireEvent.changeText(await screen.findByLabelText(pt('vehicles.nickname')), 'Der Blaue');
    await fireEvent.changeText(screen.getByLabelText(pt('vehicles.plate')), 'BßQA 1');
    await fireEvent.press(screen.getAllByLabelText(pt('vehicles.add')).at(-1)!);
    expect(await screen.findByText(t('vehicleInvalid'))).toBeTruthy();
  });

  it('one vehicle per plan: „Fahrzeug hinzufügen“ is hidden at the limit, no upgrade prompt', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [vehicle()] }),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
    });
    await render(<Vehicles />);
    expect(await screen.findByText(t('vehicleLimitNote', { limit: 1 }))).toBeTruthy();
    expect(screen.queryByLabelText(pt('vehicles.plate'))).toBeNull();
    expect(screen.queryByText(/Premium|Plus/)).toBeNull();
  });

  it('a vehicle without an active code shows the warning with „Neuen Code erstellen“', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [vehicle({ decal: null })] }),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
      [`POST /v1/vehicles/${VEHICLE}/tokens`]: () => json(vehicle()),
    });
    await render(<Vehicles />);
    expect(await screen.findByText(t('noCodeTitle'))).toBeTruthy();
    expect(screen.getByText(t('noCodeChip'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('new-code'));
    await waitFor(() => expect(sent('POST', `/v1/vehicles/${VEHICLE}/tokens`)).toEqual({}));
  });

  it('without a subscription the form is replaced by the website notice', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [] }),
      'GET /v1/billing/subscription': () => json({ subscription: null }),
    });
    await render(<Vehicles />);
    expect(await screen.findByText(pt('vehicles.noSubscription'))).toBeTruthy();
    expect(screen.queryByLabelText(pt('vehicles.plate'))).toBeNull();
  });
});

describe('vehicles tab (redesign)', () => {
  it('each vehicle card shows its QR thumbnail; „Was passiert beim Scannen?“ is on the tab', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [vehicle()] }),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
    });
    await render(<Vehicles />);
    expect(await screen.findByTestId('decal-image')).toBeTruthy();
    expect(screen.getByText(pt('portal.howTitle'))).toBeTruthy();
  });

  it('no vehicles yet: a friendly empty state', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [] }),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
    });
    await render(<Vehicles />);
    expect(await screen.findByText(t('emptyVehiclesTitle'))).toBeTruthy();
  });

  it('without a plan the notice leads to the plans', async () => {
    api({
      'GET /v1/vehicles': () => json({ vehicles: [] }),
      'GET /v1/billing/subscription': () => json({ subscription: null }),
    });
    await render(<Vehicles />);
    await screen.findByText(pt('vehicles.noSubscription'));
    await fireEvent.press(screen.getByLabelText(t('homeNoPlanCta')));
    expect(mockPush).toHaveBeenCalledWith('/tarif');
  });
});

describe('vehicle detail', () => {
  const routes = (over: Record<string, Handler> = {}) =>
    api({
      [`GET /v1/vehicles/${VEHICLE}`]: () => json(vehicle()),
      [`GET /v1/vehicles/${VEHICLE}/print-options`]: () =>
        json({
          selfPrint: { priceCents: 0 },
          shipped: { priceCents: 300, free: false, welcomePrint: false },
        }),
      [`GET /v1/vehicles/${VEHICLE}/mode`]: () => json({ mode: null }),
      [`GET /v1/vehicles/${VEHICLE}/protection`]: () =>
        json({ active: false, source: null, activeUntil: null }),
      ...over,
    });

  it('shows the QR code with the saved design, loaded with the session', async () => {
    routes();
    await render(<VehicleDetail />);
    const [hero] = await screen.findAllByTestId('decal-image');
    expect(hero!.props.children).toBe(
      `https://api.test/v1/vehicles/${VEHICLE}/decal.svg?template=classic&cta=Bitte+scannen+bei+Problemen&k=t1|Bearer ${SESSION}|${pt('portal.qrAlt', { nickname: 'Der Blaue' })}`,
    );
    expect(screen.getByText(pt('decalTest.never'))).toBeTruthy();
  });

  it('QR first with print and share; the guide is folded; the design is its own screen (P10)', async () => {
    routes();
    await render(<VehicleDetail />);
    expect(await screen.findAllByTestId('decal-image')).toHaveLength(1); // one preview only
    expect(screen.getByTestId('decal-print')).toBeTruthy();
    expect(screen.getByTestId('decal-share')).toBeTruthy();
    expect(screen.queryByText(t('decalGuideStep1'), { exact: false })).toBeNull();
    await fireEvent.press(screen.getByTestId('decal-guide'));
    expect(screen.getByText(`1. ${t('decalGuideStep1')}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('design-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/fahrzeug/design/[id]',
      params: { id: VEHICLE },
    });
  });

  it('„Aufkleber testen" opens the test window and the scan page', async () => {
    routes({
      [`POST /v1/vehicles/${VEHICLE}/test-window`]: () =>
        json({ until: '2026-11-19T12:10:00Z', scanUrl: 'https://pkshd.de/s/K3Q9ABCDEFGH' }),
    });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<VehicleDetail />);
    await fireEvent.press(await screen.findByLabelText(pt('decalTest.button')));
    await fireEvent.press(await screen.findByLabelText(pt('decalTest.openHere')));
    expect(open).toHaveBeenCalledWith('https://pkshd.de/s/K3Q9ABCDEFGH');
  });

  it('„Sperren“ explains what happens, revokes the code and creates NO new one', async () => {
    let current = vehicle();
    routes({
      [`GET /v1/vehicles/${VEHICLE}`]: () => json(current),
      [`POST /v1/vehicles/${VEHICLE}/tokens/revoke`]: () => {
        current = vehicle({ decal: null });
        return json(current);
      },
    });
    const ask = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await render(<VehicleDetail />);
    await fireEvent.press(await screen.findByTestId('revoke'));
    const [title, message] = ask.mock.calls[0]!;
    expect(title).toBe(t('revokeConfirmTitle'));
    for (const line of [
      t('revokeConfirm1'),
      t('revokeConfirm2'),
      t('revokeConfirm3'),
      t('revokeConfirm4', { price: euro(300, 'de') }),
    ]) {
      expect(message).toContain(line);
    }
    expect(await screen.findByText(t('noCodeTitle'))).toBeTruthy();
    expect(screen.getByText(t('revokeDone'))).toBeTruthy();
    expect(sent('POST', '/tokens/revoke')).toEqual({ confirm: true, reason: 'leaked' });
    // No new code was requested: only the explicit button does that.
    const posts = (global.fetch as jest.Mock).mock.calls
      .filter(([, i]: [string, RequestInit | undefined]) => i?.method === 'POST')
      .map(([u]: [string]) => u.replace('https://api.test', ''));
    expect(posts).not.toContain(`/v1/vehicles/${VEHICLE}/tokens`);
    expect(screen.queryAllByTestId('decal-image')).toHaveLength(0);
  });

  it('without a code: „Neuen Code erstellen“ (free) brings the QR code back', async () => {
    let current = vehicle({ decal: null });
    routes({
      [`GET /v1/vehicles/${VEHICLE}`]: () => json(current),
      [`POST /v1/vehicles/${VEHICLE}/tokens`]: () => {
        current = vehicle();
        return json(current);
      },
    });
    await render(<VehicleDetail />);
    await fireEvent.press(await screen.findByTestId('new-code'));
    expect(await screen.findByText(t('newCodeDone'))).toBeTruthy();
    expect(screen.getAllByTestId('decal-image')).toHaveLength(1);
    expect(screen.queryByTestId('no-code')).toBeNull();
  });

  it('leads to the print options', async () => {
    routes();
    await render(<VehicleDetail />);
    await fireEvent.press(await screen.findByTestId('print-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/fahrzeug/drucken/[id]',
      params: { id: VEHICLE },
    });
  });

  it('deleting the vehicle asks first', async () => {
    routes({ [`DELETE /v1/vehicles/${VEHICLE}`]: () => json({ ok: true }) });
    const ask = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await render(<VehicleDetail />);
    await fireEvent.press((await screen.findAllByLabelText(pt('vehicles.delete'))).at(-1)!);
    expect(ask).toHaveBeenCalledWith(
      pt('vehicles.delete'),
      pt('vehicles.deleteConfirm'),
      expect.any(Array),
    );
    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some(
          ([, i]: [string, RequestInit | undefined]) => i?.method === 'DELETE',
        ),
      ).toBe(true),
    );
  });
});

describe('print PDF', () => {
  it('is downloaded with the session, shared, and the temporary file is deleted', async () => {
    api({ [`GET /v1/vehicles/${VEHICLE}/decal.pdf`]: () => json({}) });
    await shareDecalPdf(VEHICLE);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.authorization).toBe(`Bearer ${SESSION}`);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(mockFiles[0]!.uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    });
    expect(mockFiles[0]!.deleted).toBe(true);
  });
});

describe('subscription and checkout in the app', () => {
  const texts = {
    immediateStart: { version: 3, text: 'Ich verlange ausdrücklich den sofortigen Beginn.' },
    terms: { version: 2, text: 'Es gelten unsere AGB.' },
    renewalRule: 'Danach monatlich kündbar.',
  };

  it('pays on Stripe inside the app, returns through /app/zurueck and confirms at once', async () => {
    let active = false;
    api({
      'GET /v1/me': () => json(me),
      'GET /v1/billing/subscription': () =>
        json({ subscription: active ? subscription() : null, hadSubscription: false }),
      'GET /v1/billing/invoices': () => json({ invoices: [] }),
      'GET /v1/billing/credit-notes': () => json({ creditNotes: [] }),
      'GET /v1/legal/checkout-texts': () => json(texts),
      'POST /v1/billing/checkout': () =>
        json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
      'POST /v1/billing/checkout/confirm': () => {
        active = true;
        return json({ status: 'active' });
      },
    });
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: 'exp://192.168.178.25:8082/--/zurueck?to=checkout&result=success&session_id=cs_test_1',
    });
    await render(<Plans />);
    const pay = await screen.findByLabelText(t('payButton', { price: euro(2000, 'de') }));
    expect(pay.props.accessibilityState.disabled).toBe(true); // § 312j: only after the declaration
    // Price, term and renewal stay visible next to the button (§ 312j BGB).
    expect(screen.getByTestId('price-line').props.children).toBe(
      `ParkShield · ${t('planPriceLine', { price: euro(2000, 'de') })}`,
    );
    expect(screen.getByText(texts.renewalRule, { exact: false })).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(texts.immediateStart.text));
    await fireEvent.press(screen.getByTestId('pay'));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({ pathname: '/erfolg', params: { kind: 'paid' } }),
    );
    expect(sent('POST', '/v1/billing/checkout')).toEqual({
      plan: 'standard',
      immediateStart: true,
      immediateStartVersion: 3,
      termsVersion: 2,
      appReturn: 'exp://192.168.178.25:8082/--/zurueck',
    });
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_test_1',
      'exp://192.168.178.25:8082/--/zurueck',
    );
    expect(sent('POST', '/v1/billing/checkout/confirm')).toEqual({ sessionId: 'cs_test_1' });
  });

  it('a paying customer sees contract, invoices, summary e-mail and the way to cancel', async () => {
    api({
      'GET /v1/me': () => json(me),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
      'GET /v1/billing/invoices': () =>
        json({
          invoices: [
            {
              id: 'i1',
              number: 'RE-2026-1',
              createdAt: '2026-11-19T12:00:00Z',
              totalCents: 1000,
              pdfUrl: 'https://pay.stripe.com/invoice/x',
            },
          ],
        }),
      'GET /v1/billing/credit-notes': () => json({ creditNotes: [] }),
      'PATCH /v1/me': () => json({ ok: true }),
    });
    await render(<Account />);
    expect(
      await screen.findByText(pt('account.contractNo', { contractNo: 'PS-7K3Q9X2M' })),
    ).toBeTruthy();
    expect(screen.getByText('PS-2026-000042')).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText(
        pt('account.invoiceLink', { number: 'RE-2026-1', date: new Date('2026-11-19T12:00:00Z') }),
      ),
    );
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://pay.stripe.com/invoice/x');
    await fireEvent.press(screen.getByLabelText(pt('summarySettings.weekly')));
    await waitFor(() => expect(sent('PATCH', '/v1/me')).toEqual({ summaryFrequency: 'weekly' }));
    await fireEvent.press(screen.getByLabelText(t('cancelButton')));
    expect(mockPush).toHaveBeenCalledWith('/kuendigen');
    // After the withdrawal period: only the cancel part of the „Vertrag“ card.
    expect(screen.queryByTestId('withdraw')).toBeNull();
  });

  it('Konto: the plan card comes first; the language is a segmented choice', async () => {
    api({
      'GET /v1/me': () => json(me),
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
      'GET /v1/billing/invoices': () => json({ invoices: [] }),
      'GET /v1/billing/credit-notes': () => json({ creditNotes: [] }),
      'PATCH /v1/me': () => json({ ok: true }),
    });
    await render(<Account />);
    await screen.findByText(t('planName'));
    expect(screen.getAllByRole('header')[0]!.props.children).toBe(pt('account.subscription'));
    // One plan: „ParkShield · Aktiv“ with what it includes; no upgrade, no Plus/Premium.
    expect(screen.getByText(pt('account.statusActive'))).toBeTruthy();
    expect(screen.getByText(t('planIncludes'))).toBeTruthy();
    expect(screen.getByText(t('planF4'))).toBeTruthy();
    expect(screen.queryByText(/Premium|Plus\b|Upgrade/)).toBeNull();
    expect(screen.getByLabelText(pt('account.paymentMethod'))).toBeTruthy();
    const english = screen.getByLabelText('English');
    expect(english.props.accessibilityRole).toBe('radio');
    await fireEvent.press(english);
    await waitFor(() => expect(sent('PATCH', '/v1/me')).toEqual({ preferredLang: 'en' }));
    // The same choice switches the app and is kept on this device (2026-11-22).
    await waitFor(() => expect(lang()).toBe('en'));
    await saveLang('de');
  });

  it('without a plan the subscription screen leads to the plans', async () => {
    api({
      'GET /v1/me': () => json(me),
      'GET /v1/billing/subscription': () => json({ subscription: null, hadSubscription: false }),
      'GET /v1/billing/invoices': () => json({ invoices: [] }),
      'GET /v1/billing/credit-notes': () => json({ creditNotes: [] }),
    });
    await render(<Account />);
    await fireEvent.press(await screen.findByLabelText(t('homeNoPlanCta')));
    expect(mockPush).toHaveBeenCalledWith('/tarif');
  });

  it('the paywall: one plan, 20 € a year, everything included, no choice; legal details folded (P7)', async () => {
    api({
      'GET /v1/billing/subscription': () => json({ subscription: null, hadSubscription: false }),
      'GET /v1/legal/checkout-texts': () => json(texts),
    });
    await render(<Plans />);
    await screen.findByLabelText(t('payButton', { price: euro(2000, 'de') }));
    expect(t('payButton', { price: euro(2000, 'de') })).toBe(
      `Zahlungspflichtig bestellen – ${euro(2000, 'de')} / Jahr`,
    );
    expect(screen.getByTestId('plan-card')).toBeTruthy();
    for (const k of [
      'planF1',
      'planF2',
      'planF3',
      'planF4',
      'planF5',
      'planF6',
      'planF7',
    ] as const) {
      expect(screen.getByText(t(k))).toBeTruthy();
    }
    expect(screen.queryByText(/Premium|Plus\b/)).toBeNull();
    expect(screen.getByText(t('paySecure'))).toBeTruthy();
    // The immediate-start declaration (§ 356 BGB) is kept.
    expect(screen.getByLabelText(texts.immediateStart.text)).toBeTruthy();
    expect(screen.queryByText(pt('checkout.withdrawalLink'))).toBeNull();
    await fireEvent.press(screen.getByTestId('pay-details'));
    expect(screen.getByText(pt('checkout.withdrawalLink'))).toBeTruthy();
  });

  it('a cancelled or closed payment page never says „Danke“ (P3)', async () => {
    let confirms = 0;
    api({
      'GET /v1/billing/subscription': () => json({ subscription: null, hadSubscription: false }),
      'GET /v1/legal/checkout-texts': () => json(texts),
      'POST /v1/billing/checkout': () =>
        json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
      'POST /v1/billing/checkout/confirm': () => {
        confirms += 1;
        return json({ status: 'pending' });
      },
    });
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: 'exp://192.168.178.25:8082/--/zurueck?to=checkout&result=canceled',
    });
    await render(<Plans />);
    await fireEvent.press(await screen.findByLabelText(texts.immediateStart.text));
    await fireEvent.press(screen.getByTestId('pay'));
    expect(await screen.findByText(t('payCanceled'))).toBeTruthy();
    expect(confirms).toBe(0);

    // Closed by hand: one quiet check, then the same neutral message.
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({ type: 'cancel' });
    await fireEvent.press(screen.getByTestId('pay'));
    await waitFor(() => expect(confirms).toBe(1));
    expect(screen.getByText(t('payCanceled'))).toBeTruthy();
    expect(screen.queryByText(pt('account.checkoutSuccess'), { exact: false })).toBeNull();
    expect(screen.queryByText(t('payChecking'))).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('§ 312k: cancelling in the app shows the receipt', async () => {
    api({
      'GET /v1/billing/subscription': () => json({ subscription: subscription() }),
      'POST /v1/portal/cancellations': () =>
        json({ receivedAt: '2026-11-19T12:00:00Z', endsAt: '2027-11-19T12:00:00Z' }),
    });
    await render(<Cancel />);
    expect(
      await screen.findByText(pt('cancel.signedInHint', { contractNo: 'PS-7K3Q9X2M' })),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(pt('cancel.submit')));
    expect(await screen.findByText(pt('cancel.receivedTitle'))).toBeTruthy();
    expect(sent('POST', '/v1/portal/cancellations')).toEqual({
      type: 'ordinary',
      effective: 'next',
    });
  });
});

describe('my data', () => {
  it('export needs a fresh sign-in; deletion needs the confirmation', async () => {
    api({
      'GET /v1/portal/documents': () => json({ welcomeLetter: false }),
      'POST /v1/me/export': () => json({ error: 'reauth_required', minutes: 15 }, 403),
      'DELETE /v1/me': () => json({ deletionDueAt: '2026-11-20T12:00:00Z' }),
    });
    await render(<Privacy />);
    await fireEvent.press(await screen.findByLabelText(pt('privacy.exportJson')));
    expect(await screen.findByText(pt('privacy.reauth', { minutes: 15 }))).toBeTruthy();

    const del = screen.getByLabelText(pt('privacy.deleteButton'));
    expect(del.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText(pt('privacy.deleteConfirm')));
    await fireEvent.press(screen.getByLabelText(pt('privacy.deleteButton')));
    expect(
      await screen.findByText(
        pt('privacy.deleteRequested', { date: new Date('2026-11-20T12:00:00Z') }),
      ),
    ).toBeTruthy();
  });
});

describe('history', () => {
  it('blocks a sender with a reason', async () => {
    api({
      'GET /v1/alerts': () =>
        json({
          alerts: [
            {
              id: 'a1',
              vehicle: { id: VEHICLE, nickname: 'Der Blaue' },
              type: { code: 'custom', de: 'Eigene Nachricht', en: 'Custom message' },
              severity: 'normal',
              isTest: false,
              status: 'delivered',
              ownerReply: null,
              createdAt: '2026-11-19T12:00:00Z',
              message: 'Bitte Auto umparken',
              muted: null,
              deliveries: [],
              reported: false,
              canBlock: true,
              hiddenContent: false,
              verifiedSender: false,
            },
          ],
        }),
      'POST /v1/alerts/a1/report': () =>
        json({ blocked: true, phoneBanned: false, protectedMode: false }),
    });
    await render(<History />);
    expect(
      await screen.findByText(pt('history.message', { message: 'Bitte Auto umparken' })),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(pt('history.report')));
    await fireEvent.press(screen.getByLabelText(pt('history.reason_spam')));
    await fireEvent.press(screen.getByLabelText(pt('history.reportSend')));
    expect(
      await screen.findByText(pt('history.reportedBlocked', { nickname: 'Der Blaue' })),
    ).toBeTruthy();
    expect(sent('POST', '/v1/alerts/a1/report')).toEqual({ reason: 'spam' });
  });
});

describe('„Vertrag“ card (§ 356a BGB)', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const show = (over: Partial<SubscriptionSummary>) => {
    const onWithdraw = jest.fn();
    const onCancel = jest.fn();
    return {
      onWithdraw,
      onCancel,
      view: render(
        <ContractCard
          sub={subscription(over)}
          onWithdraw={onWithdraw}
          onCancel={onCancel}
          now={now}
        />,
      ),
    };
  };

  it('during the withdrawal period: withdrawal with its date and button, then the cancel part', async () => {
    const { onWithdraw, onCancel, view } = show({ withdrawalOpenUntil: '2026-12-03T12:00:00Z' });
    await view;
    expect(
      screen.getByText(t('withdrawUntil', { date: longDate('2026-12-03T12:00:00Z', 'de') })),
    ).toBeTruthy();
    // As visible as „Vertrag hier kündigen“: same button style.
    const withdraw = screen.getByTestId('withdraw');
    const cancel = screen.getByTestId('cancel');
    expect(withdraw.props.accessibilityLabel).toBe(t('withdrawButton'));
    expect(withdraw.props.style).toEqual(cancel.props.style);
    await fireEvent.press(withdraw);
    expect(onWithdraw).toHaveBeenCalled();
    await fireEvent.press(cancel);
    expect(onCancel).toHaveBeenCalled();
    expect(screen.getByText(t('contractTitle'))).toBeTruthy();
  });

  it('after the period only „Kündigen“ remains (also when the date has just passed)', async () => {
    await show({ withdrawalOpenUntil: null }).view;
    expect(screen.queryByTestId('withdraw')).toBeNull();
    expect(screen.getByTestId('cancel')).toBeTruthy();
    await show({ withdrawalOpenUntil: '2026-11-20T12:00:00Z' }).view;
    expect(screen.queryByTestId('withdraw')).toBeNull();
  });
});

describe('store subscriptions (App Store / Google Play)', () => {
  const now = new Date('2026-11-25T12:00:00Z');

  it('„Vertrag hier kündigen“ opens the store management, „Vertrag widerrufen“ stays', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const onCancel = jest.fn();
    const onWithdraw = jest.fn();
    await render(
      <ContractCard
        sub={subscription({
          provider: 'app_store',
          managementUrl: null,
          refundRoute: 'apple',
          withdrawalOpenUntil: '2026-12-03T12:00:00Z',
        })}
        onWithdraw={onWithdraw}
        onCancel={onCancel}
        now={now}
      />,
    );
    expect(screen.getByText(t('storeManageText', { store: 'Apple' }))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('cancel'));
    expect(open).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
    expect(onCancel).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('withdraw'));
    expect(onWithdraw).toHaveBeenCalled();
    open.mockRestore();
  });

  it('the paywall shows the sticker value and notice, and no purchase while a subscription is live', async () => {
    api({
      'GET /v1/me': () => json(me),
      'GET /v1/billing/subscription': () =>
        json({ subscription: subscription({ provider: 'play_store' }), hadSubscription: false }),
      'GET /v1/legal/checkout-texts': () =>
        json({
          immediateStart: { version: 3, text: 'Ich verlange ausdrücklich den sofortigen Beginn.' },
          terms: { version: 2, text: 'Es gelten unsere AGB.' },
          renewalRule: 'Jährlich.',
        }),
    });
    await render(<Plans />);
    expect(await screen.findByTestId('already-subscribed')).toBeTruthy();
    expect(screen.getByText(t('providerPlayStore'))).toBeTruthy();
    expect(screen.queryByTestId('pay')).toBeNull();
  });

  it('a Google Play subscription on pause: „In Google Play fortsetzen“ instead of a purchase', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    api({
      'GET /v1/me': () => json(me),
      'GET /v1/billing/subscription': () =>
        json({
          subscription: null,
          hadSubscription: true,
          paused: {
            provider: 'play_store',
            pausedUntil: '2027-01-15T00:00:00Z',
            contractNo: 'PS-ABCD1234',
            managementUrl: 'https://play.google.com/store/account/subscriptions',
          },
        }),
      'GET /v1/legal/checkout-texts': () =>
        json({
          immediateStart: { version: 3, text: 'Ich verlange ausdrücklich den sofortigen Beginn.' },
          terms: { version: 2, text: 'Es gelten unsere AGB.' },
          renewalRule: 'Jährlich.',
        }),
    });
    await render(<Plans />);
    expect(await screen.findByTestId('subscription-paused')).toBeTruthy();
    expect(screen.getByText(pt('account.pausedTitle'))).toBeTruthy();
    expect(screen.queryByTestId('pay')).toBeNull();
    await fireEvent.press(screen.getByText(pt('account.pausedResume')));
    expect(open).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');
    open.mockRestore();
  });

  it('the Stripe fallback paywall shows the price breakdown and the sticker notice', async () => {
    api({
      'GET /v1/me': () => json(me),
      'GET /v1/billing/subscription': () => json({ subscription: null, hadSubscription: false }),
      'GET /v1/legal/checkout-texts': () =>
        json({
          immediateStart: { version: 3, text: 'Ich verlange ausdrücklich den sofortigen Beginn.' },
          terms: { version: 2, text: 'Es gelten unsere AGB.' },
          renewalRule: 'Jährlich.',
        }),
    });
    await render(<Plans />);
    expect(
      await screen.findByText(
        'Im Preis enthalten: personalisierter Aufkleber inkl. Versand im Wert von 3,00 €.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Hinweis: Der personalisierte Aufkleber wird nach Ihren Angaben gefertigt. Für ihn besteht kein Widerrufsrecht (§ 312g Abs. 2 Nr. 1 BGB). Ihr Widerrufsrecht für das Abo bleibt bestehen.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('restore')).toBeNull(); // no store in tests (no key)
  });
});

describe('print options', () => {
  const order = {
    id: 'o1',
    status: 'paid',
    included: true,
    trackingNumber: null,
    createdAt: '2026-11-19T12:00:00Z',
    product: 'uv_vinyl_sticker',
    vehicleId: VEHICLE,
    nickname: 'Der Blaue',
  };
  const routes = (shipped: object, over: Record<string, Handler> = {}, extra: object = {}) =>
    api({
      [`GET /v1/vehicles/${VEHICLE}`]: () => json(vehicle()),
      [`GET /v1/vehicles/${VEHICLE}/print-options`]: () =>
        json({
          selfPrint: { priceCents: 0 },
          shipped,
          personalization: { label: 'Der Blaue', labelValid: true, template: 'classic', cta: 'x' },
          addressPrefill: null,
          ...extra,
        }),
      'GET /v1/orders': () => json({ orders: [] }),
      ...over,
    });
  /** „Weiter zur Bestätigung“, then the address in the one confirmation step (B1). */
  const address = async () => {
    await fireEvent.press(await screen.findByTestId('ship-start'));
    await fireEvent.changeText(await screen.findByLabelText(pt('order.name')), 'Kim Muster');
    await fireEvent.changeText(screen.getByLabelText(pt('order.line1')), 'Hauptstraße 1');
    await fireEvent.changeText(screen.getByLabelText(pt('order.postalCode')), '50667');
    await fireEvent.changeText(screen.getByLabelText(pt('order.city')), 'Köln');
  };

  it('shows the price on each option: self-print free, the welcome print free', async () => {
    routes({ priceCents: 0, free: true, welcomePrint: true });
    await render(<PrintScreen />);
    expect(await screen.findByText(t('printSelfTitle'))).toBeTruthy();
    expect(t('printSelfTitle')).toBe('Selbst drucken – kostenlos');
    expect(screen.getByText(t('printPaper'))).toBeTruthy();
    expect(screen.getByText(t('printShipTitle'))).toBeTruthy();
    expect(screen.getByText('kostenlos (Willkommensdruck)')).toBeTruthy();
    // Nothing is ordered before the confirmation step.
    expect(screen.queryByLabelText(t('printConfirmFree'))).toBeNull();
    await fireEvent.press(screen.getByTestId('ship-start'));
    expect(await screen.findByLabelText(t('printConfirmFree'))).toBeTruthy();
    expect(screen.getByText(t('printConfirmLabel', { label: 'Der Blaue' }))).toBeTruthy();
    expect(screen.getByText(t('printPersonalNotice'))).toBeTruthy();
    expect(t('printPersonalNotice')).toBe(
      'Ihr Aufkleber wird nach Ihren Angaben individuell gedruckt. Für individuell angefertigte Waren besteht kein Widerrufsrecht.',
    );
    expect(screen.getByTestId('ship-design')).toBeTruthy();
  });

  it('prefills the address and blocks the order while the vehicle label cannot be printed', async () => {
    routes(
      { priceCents: 0, free: true, welcomePrint: true },
      {},
      {
        personalization: { label: 'X', labelValid: false, template: 'classic', cta: 'x' },
        addressPrefill: {
          name: 'Kim Muster',
          line1: 'Hauptstraße 1',
          postalCode: '50667',
          city: 'Köln',
          country: 'DE',
        },
      },
    );
    await render(<PrintScreen />);
    await fireEvent.press(await screen.findByTestId('ship-start'));
    expect(await screen.findByDisplayValue('Kim Muster')).toBeTruthy();
    expect(screen.getByText(t('printLabelInvalid', { label: 'X' }))).toBeTruthy();
    expect(screen.getByTestId('ship-edit-name')).toBeTruthy();
    expect(screen.getByTestId('address-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('the free welcome print is ordered without a payment page', async () => {
    routes(
      { priceCents: 0, free: true, welcomePrint: true },
      {
        [`POST /v1/vehicles/${VEHICLE}/order-print`]: () =>
          json({ id: 'o1', url: 'https://park-shield.de/konto', free: true }),
      },
    );
    await render(<PrintScreen />);
    await address();
    await fireEvent.press(screen.getByLabelText(t('printConfirmFree')));
    expect(await screen.findByText(t('printShipDone'))).toBeTruthy();
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
    expect(sent('POST', '/order-print')).toEqual({
      address: {
        name: 'Kim Muster',
        line1: 'Hauptstraße 1',
        postalCode: '50667',
        city: 'Köln',
        country: 'DE',
      },
      personalizationConfirmed: true,
      appReturn: 'exp://192.168.178.25:8082/--/zurueck',
    });
  });

  it('after the welcome print: 3 € one-time, paid on Stripe inside the app', async () => {
    routes(
      { priceCents: 300, free: false, welcomePrint: false },
      {
        [`POST /v1/vehicles/${VEHICLE}/order-print`]: () =>
          json({ url: 'https://checkout.stripe.com/c/pay/cs_print', free: false }),
        'GET /v1/orders': () => json({ orders: [order] }),
      },
    );
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: 'exp://192.168.178.25:8082/--/zurueck?to=order&result=success',
    });
    await render(<PrintScreen />);
    const price = euro(300, 'de');
    expect(await screen.findByText(t('printShipPrice', { price }))).toBeTruthy();
    expect(t('printShipPrice', { price })).toBe(`${price} einmalig inkl. MwSt.`);
    await address();
    await fireEvent.press(screen.getByLabelText(t('printConfirmPaid', { price: '3 €' })));
    expect(t('printConfirmPaid', { price: '3 €' })).toBe('3 € bezahlen und zusenden');
    expect(await screen.findByText(t('printShipDone'))).toBeTruthy();
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_print',
      'exp://192.168.178.25:8082/--/zurueck',
    );
  });

  it('self-print files (PNG) are downloaded with the session and shared', async () => {
    routes(
      { priceCents: 300, free: false, welcomePrint: false },
      { [`GET /v1/vehicles/${VEHICLE}/decal.png`]: () => json({}) },
    );
    await render(<PrintScreen />);
    await fireEvent.press(await screen.findByTestId('self-png'));
    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith(mockFiles[0]!.uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
      }),
    );
    expect(mockFiles[0]!.deleted).toBe(true);
  });

  it('without a code: nothing to print until a new code exists', async () => {
    routes(
      { priceCents: 300, free: false, welcomePrint: false },
      { [`GET /v1/vehicles/${VEHICLE}`]: () => json(vehicle({ decal: null })) },
    );
    await render(<PrintScreen />);
    expect(await screen.findByText(t('noCodeTitle'))).toBeTruthy();
    expect(screen.queryByTestId('self-print')).toBeNull();
    expect(screen.queryByText(t('printShipTitle'))).toBeNull();
  });
});

describe('notification settings', () => {
  const channels = (over: object = {}) => ({
    order: ['native_push', 'webpush', 'email', 'sms'],
    email: { address: 'kim@example.de' },
    push: { publicKey: 'x', devices: [] },
    app: {
      devices: [
        { id: 'd1', platform: 'ios', appVersion: '1.0.0', lastSeenAt: '2026-11-20T12:00:00Z' },
      ],
    },
    sms: { phone: '+49 ••• 4567', verifiedAt: '2026-11-19T12:00:00Z', enabled: true },
    available: { sms: true },
    ...over,
  });
  const routes = (c: object, usage: object = { sms: { used: 2, limit: 20, capReached: false } }) =>
    api({
      'GET /v1/channels': () => json(c),
      'GET /v1/me/usage': () => json(usage),
      'GET /v1/quiet-hours': () => json({ timezone: 'Europe/Berlin', rules: [] }),
    });

  it('only push, the verified number and quiet hours; no e-mail, browser push or channel order', async () => {
    routes(channels());
    await render(<Notifications />);
    expect(await screen.findByText('+49 ••• 4567')).toBeTruthy();
    expect(screen.getByText(t('phoneVerified'))).toBeTruthy();
    expect(screen.getByText(t('phoneSmsRule'))).toBeTruthy();
    expect(screen.getByText(t('appPushTitle'))).toBeTruthy();
    expect(screen.getByText(pt('quiet.title'))).toBeTruthy();
    expect(screen.getByText(t('quietSmsNote'))).toBeTruthy();
    expect(screen.queryByText(/Reihenfolge|Browser|E-Mail-Adresse|kim@example\.de/)).toBeNull();
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
    // The system settings are always one tap away.
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByTestId('open-settings'));
    expect(open).toHaveBeenCalled();
  });

  it('no device registered: the warning about the SMS after 30 minutes', async () => {
    routes(channels({ app: { devices: [] } }));
    await render(<Notifications />);
    expect(await screen.findByText(t('pushOffWarning'))).toBeTruthy();
  });

  it('the number can be changed (new code), never removed; the SMS cap is shown', async () => {
    routes(channels(), { sms: { used: 20, limit: 20, capReached: true } });
    await render(<Notifications />);
    expect(await screen.findByTestId('sms-cap')).toBeTruthy();
    expect(screen.queryByText(/entfernen/i)).toBeNull();
    await fireEvent.press(screen.getByTestId('phone-change'));
    expect(screen.getByText(t('phoneChangeHint'))).toBeTruthy();
    expect(screen.getByTestId('phone')).toBeTruthy();
    expect(
      (global.fetch as jest.Mock).mock.calls.some(
        ([, i]: [string, RequestInit | undefined]) => i?.method === 'DELETE',
      ),
    ).toBe(false);
  });
});
