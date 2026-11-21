import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AlertsProvider } from '@/lib/alerts-store';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
import { setSession } from '@/lib/session';
import type { AlertListItem } from '@/lib/types';
import Home from '@/app/(tabs)/index';

const mockPush = jest.fn();
const mockNavigate = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
    back: jest.fn(),
    replace: jest.fn(),
  }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cb, []);
  },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signedIn: true }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

const alert = (over: Partial<AlertListItem> = {}): AlertListItem => ({
  id: 'a1',
  type: { code: 'blocking', de: 'Fahrzeug versperrt Ausfahrt', en: 'Vehicle blocks exit' },
  severity: 'urgent',
  status: 'delivered',
  isTest: false,
  createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
  seenAt: null,
  acknowledged: false,
  acknowledgedBy: null,
  escalationStage: 'none',
  vehicle: { id: 'v1', nickname: 'Blue' },
  photoCount: 0,
  chatStatus: null,
  ...over,
});
const subscription = (over: object = {}) => ({
  plan: 'standard',
  status: 'active',
  contractNo: 'PS-1',
  currentPeriodEnd: '2027-11-19T12:00:00Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  ...over,
});
const decal = {
  tokenId: 't1',
  codeHint: 'K3Q9',
  status: 'assigned',
  cta: 'Bitte scannen',
  template: 'classic',
  activatedAt: null,
  lastTestAt: null,
  testWindowUntil: null,
};
const vehicle = {
  id: 'v1',
  nickname: 'Blue',
  plate: 'K-AB 1',
  makeModel: null,
  color: null,
  createdAt: '',
  decal: decal as object | null,
};

const calls: { path: string; body?: unknown }[] = [];
function api({
  alerts = [] as AlertListItem[] | 'down',
  sub = subscription() as object | null,
  done = true,
  vehicles = [vehicle] as object[],
  pushReady = true,
}: {
  alerts?: AlertListItem[] | 'down';
  sub?: object | null;
  done?: boolean;
  vehicles?: object[];
  pushReady?: boolean;
}) {
  calls.length = 0;
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    const path = url.replace('https://api.test', '');
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    const body =
      path === '/v1/app/alerts'
        ? alerts === 'down'
          ? null
          : { alerts, next: null, pushReady }
        : path === '/v1/billing/subscription'
          ? { subscription: sub }
          : path === '/v1/me/protection'
            ? {
                percent: done ? 100 : 50,
                steps: { email: true, channel: true, phone: true, decal: done },
              }
            : path === '/v1/vehicles'
              ? { vehicles }
              : path === '/v1/vehicles/v1/tokens'
                ? { ...vehicle, decal }
                : {};
    if (body === null) throw new Error('offline');
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

const show = () =>
  render(
    <AlertsProvider>
      <Home />
    </AlertsProvider>,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await setSession('session-token-0000000000000000000001');
});

describe('Start (Home)', () => {
  it('open alerts come first, with how long ago and „Ich komme“ right on the card (P1)', async () => {
    api({ alerts: [alert(), alert({ id: 'a2', acknowledged: true })] });
    await show();
    const cards = await screen.findAllByTestId('open-alert');
    expect(cards).toHaveLength(1);
    expect(screen.getByText('„Blue“ · vor 2 Min.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('home-coming'));
    await waitFor(() =>
      expect(calls).toContainEqual({ path: '/v1/app/alerts/a1/ack', body: { reply: 'coming' } }),
    );
    // QA: the card does not just vanish; the owner sees that „Ich komme“ was sent.
    expect(await screen.findByTestId('coming-sent')).toBeTruthy();
  });

  it('without a plan: the car and one button to the plans, no three-step explainer (P9)', async () => {
    api({ sub: null });
    await show();
    expect(await screen.findByText(t('homeNoPlanTitle'))).toBeTruthy();
    expect(screen.queryByText(pt('portal.startTitle'))).toBeNull();
    await fireEvent.press(screen.getByLabelText(t('homeNoPlanCta')));
    expect(mockPush).toHaveBeenCalledWith('/tarif');
  });

  it('protected: the car with „Geschützt“ and „Alles ruhig“', async () => {
    api({});
    await show();
    expect(await screen.findByText(t('homeProtectedTitle', { nickname: 'Blue' }))).toBeTruthy();
    expect(screen.getByText(t('homeProtected'))).toBeTruthy();
    expect(screen.getByText(t('homeAllQuiet'))).toBeTruthy();
    expect(screen.queryByTestId('setup-strip')).toBeNull();
  });

  it('one step left: one compact strip with one primary button for the next step (P11)', async () => {
    api({ done: false });
    await show();
    expect(await screen.findByText(t('homeStepsLeft', { count: 1 }))).toBeTruthy();
    expect(screen.getByTestId('setup-strip')).toBeTruthy();
    expect(screen.getByText(pt('protection.stepDecal'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-go'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/fahrzeug/[id]', params: { id: 'v1' } });
  });

  it('a failed payment is shown on Home too', async () => {
    api({ sub: subscription({ status: 'past_due' }) });
    await show();
    expect(await screen.findByText(pt('account.pastDueNotice'))).toBeTruthy();
  });

  it('the development notice is a small footer note, not a banner on top (P18)', async () => {
    api({});
    await show();
    expect(await screen.findByTestId('dev-note')).toBeTruthy();
  });

  it('never opens the notification permission by itself (P6)', async () => {
    api({});
    await show();
    await screen.findByText(t('homeAllQuiet'));
    expect(mockPush).not.toHaveBeenCalledWith('/push-erlauben');
  });

  it('push off or no device: the persistent warning about the SMS after 30 minutes', async () => {
    api({ pushReady: false });
    await show();
    expect(await screen.findByTestId('push-off')).toBeTruthy();
    expect(screen.getByText(t('pushOffWarning'))).toBeTruthy();
    // Never asked by itself (P6): only the banner's button would ask.
    expect(mockPush).not.toHaveBeenCalledWith('/push-erlauben');
  });

  it('no warning while this phone gets alerts', async () => {
    api({});
    await show();
    await screen.findByText(t('homeAllQuiet'));
    expect(screen.queryByTestId('push-off')).toBeNull();
  });

  it('a vehicle without an active code: the warning and „Neuen Code erstellen“ (free)', async () => {
    api({ vehicles: [{ ...vehicle, decal: null }], done: false });
    await show();
    expect(await screen.findByText(t('noCodeTitle'))).toBeTruthy();
    expect(screen.queryByTestId('home-status')).toBeNull();
    await fireEvent.press(screen.getByTestId('new-code'));
    await waitFor(() => expect(calls).toContainEqual({ path: '/v1/vehicles/v1/tokens', body: {} }));
  });

  it('when the API is unreachable it says so and the screen stays usable', async () => {
    api({ alerts: 'down' });
    await show();
    expect(await screen.findByText(t('offline'))).toBeTruthy();
  });
});
