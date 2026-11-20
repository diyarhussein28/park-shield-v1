import { fireEvent, render, screen } from '@testing-library/react-native';
import { AlertsProvider } from '@/lib/alerts-store';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
import { setSession } from '@/lib/session';
import type { AlertListItem } from '@/lib/types';
import Alerts from '@/app/(tabs)/index';

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
  createdAt: '2026-11-19T12:00:00Z',
  seenAt: null,
  acknowledged: false,
  acknowledgedBy: null,
  escalationStep: 0,
  vehicle: { id: 'v1', nickname: 'Blue' },
  photoCount: 0,
  chatStatus: null,
  ...over,
});
const subscription = (over: object = {}) => ({
  plan: 'plus',
  status: 'active',
  contractNo: 'PS-1',
  currentPeriodEnd: '2027-11-19T12:00:00Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  ...over,
});
const vehicle = {
  id: 'v1',
  nickname: 'Blue',
  plate: 'K-AB 1',
  makeModel: null,
  color: null,
  createdAt: '',
  decal: null,
};

function api({
  alerts = [] as AlertListItem[] | 'down',
  sub = subscription() as object | null,
  percent = 100,
}) {
  global.fetch = jest.fn(async (url: string) => {
    const path = url.replace('https://api.test', '');
    const body =
      path === '/v1/app/alerts'
        ? alerts === 'down'
          ? null
          : { alerts, next: null, pushReady: true }
        : path === '/v1/billing/subscription'
          ? { subscription: sub }
          : path === '/v1/me/protection'
            ? {
                percent,
                steps: {
                  email: true,
                  channel: percent >= 50,
                  contact: null,
                  decal: percent === 100,
                },
              }
            : path === '/v1/vehicles'
              ? { vehicles: [vehicle] }
              : {};
    if (body === null) throw new Error('offline');
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

const show = () =>
  render(
    <AlertsProvider>
      <Alerts />
    </AlertsProvider>,
  );

beforeEach(async () => {
  jest.clearAllMocks();
  await setSession('session-token-0000000000000000000001');
});

it('without a plan it leads to the checkout, not to „no alerts“', async () => {
  api({ sub: null });
  await show();
  expect(await screen.findByText(pt('portal.startTitle'))).toBeTruthy();
  expect(screen.queryByText(t('emptyAlertsTitle'))).toBeNull();
  await fireEvent.press(screen.getByLabelText(pt('portal.start1Go')));
  expect(mockNavigate).toHaveBeenCalledWith('/konto');
});

it('with a plan and no alerts: a friendly empty state that leads to testing the decal', async () => {
  api({});
  await show();
  expect(await screen.findByText(t('emptyAlertsTitle'))).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(t('emptyAlertsAction')));
  expect(mockNavigate).toHaveBeenCalledWith('/fahrzeuge');
});

it('shows the set-up guide while protection is incomplete', async () => {
  api({ percent: 50 });
  await show();
  expect(await screen.findByText(pt('protection.percent', { percent: 50 }))).toBeTruthy();
});

it('a failed payment is shown on the alerts tab too', async () => {
  api({ sub: subscription({ status: 'past_due' }) });
  await show();
  expect(await screen.findByText(pt('account.pastDueNotice'))).toBeTruthy();
});

it('urgent alerts carry the stripe; test alerts a „Test“ chip', async () => {
  api({ alerts: [alert(), alert({ id: 'a2', severity: 'normal', isTest: true })] });
  await show();
  expect(await screen.findAllByLabelText(/^Fahrzeug versperrt Ausfahrt, Blue,/)).toHaveLength(2);
  expect(screen.getAllByTestId('urgent-stripe')).toHaveLength(1);
  expect(screen.getByText(t('test'))).toBeTruthy();
});

it('when the API is unreachable it says so and the screen stays usable', async () => {
  api({ alerts: 'down' });
  await show();
  expect(await screen.findByText(t('offline'))).toBeTruthy();
});
