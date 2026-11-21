import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Linking } from 'react-native';
import { shareDecalPdf } from '@/lib/decal';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
import type { PortalVehicle, SubscriptionSummary } from '@/lib/portal';
import { setSession } from '@/lib/session';
import Privacy from '@/app/daten';
import VehicleDetail from '@/app/fahrzeug/[id]';
import Vehicles from '@/app/(tabs)/fahrzeuge';
import { HistoryList as History } from '@/components/history-list';
import Cancel from '@/app/kuendigen';
import Account, { ContractCard } from '@/app/abo';
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
      `https://api.test/v1/vehicles/${VEHICLE}/decal.svg?template=classic&cta=Bitte+scannen+bei+Problemen|Bearer ${SESSION}|${pt('portal.qrAlt', { nickname: 'Der Blaue' })}`,
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
    routes({
      [`POST /v1/vehicles/${VEHICLE}/tokens/revoke`]: () => json(vehicle({ decal: null })),
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
      t('revokeConfirm4', { price: '3,00 €' }),
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
    const pay = await screen.findByLabelText(t('payButton', { price: '20,00 €' }));
    expect(pay.props.accessibilityState.disabled).toBe(true); // § 312j: only after the declaration
    // Price, term and renewal stay visible next to the button (§ 312j BGB).
    expect(screen.getByTestId('price-line').props.children).toBe(
      `ParkShield · ${t('planPriceLine', { price: '20,00 €' })}`,
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

  it('Konto: the plan card comes first; the e-mail language is a segmented choice', async () => {
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
    await screen.findByLabelText(t('payButton', { price: '20,00 €' }));
    expect(t('payButton', { price: '20,00 €' })).toBe(
      'Zahlungspflichtig bestellen – 20,00 € / Jahr',
    );
    expect(screen.getByTestId('plan-card')).toBeTruthy();
    for (const k of ['planF1', 'planF2', 'planF3', 'planF4', 'planF5', 'planF6', 'planF7'] as const) {
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
