import { fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
import { setSession } from '@/lib/session';
import SignIn from '@/app/anmelden';
import Account from '@/app/(tabs)/konto';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSignOut = jest.fn(async () => undefined);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cb, []);
  },
}));
jest.mock('expo-linking', () => ({ useURL: () => null, getInitialURL: async () => null }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ signOut: mockSignOut, requestLink: jest.fn(), consume: jest.fn() }),
  tokenFromLink: () => null,
}));
const mockSetEnabled = jest.fn(async () => true);
jest.mock('@/lib/lock', () => ({
  useLock: () => ({ enabled: false, lockAfterSeconds: 300, setEnabled: mockSetEnabled }),
}));
jest.mock('@/lib/profile', () => ({
  useProfile: () => ({
    data: {
      email: 'kim@example.de',
      complete: true,
      phone: null,
      profile: {
        firstName: 'Kim',
        lastName: 'Muster',
        street: 'Ring 1',
        postalCode: '50667',
        city: 'Köln',
        country: 'DE',
        source: 'signup',
        completedAt: '',
      },
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

/** All props objects in the rendered tree (RNTL 14 has no UNSAFE_ prop queries). */
type Node = { props?: Record<string, unknown>; children?: (Node | string)[] | null };
const allProps = (node: Node | Node[] | null): Record<string, unknown>[] => {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(allProps);
  const kids = (node.children ?? []).filter((k): k is Node => typeof k !== 'string');
  return [node.props ?? {}, ...kids.flatMap(allProps)];
};

beforeEach(async () => {
  jest.clearAllMocks();
  await setSession('session-token-0000000000000000000001');
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith('/v1/channels')
        ? {
            order: [],
            email: { address: 'kim@example.de' },
            push: { publicKey: '', devices: [] },
            app: { devices: [] },
            sms: null,
            available: { sms: true },
          }
        : url.endsWith('/v1/billing/subscription')
          ? {
              subscription: {
                plan: 'standard',
                status: 'active',
                contractNo: 'PS-1',
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
              },
            }
          : {},
  })) as unknown as typeof fetch;
});

it('Konto has every former „Mehr“ item, the lock switch, and sign-out as the last row (P12)', async () => {
  await render(<Account />);
  expect(await screen.findByText('Kim Muster')).toBeTruthy();
  // One plan, no Plus/Premium; no trusted contacts any more (2026-11-21).
  expect(await screen.findByText(`ParkShield · ${pt('account.statusActive')}`)).toBeTruthy();
  expect(screen.queryByTestId('row-contacts')).toBeNull();
  expect(screen.queryByText(/Plus|Premium|Notfallkontakt|Vertrauensperson/)).toBeNull();
  // No app device and no number yet: the row says so.
  expect(screen.getByText(`${t('notifPushOff')} · ${t('notifNoPhone')}`)).toBeTruthy();
  const rows: [string, unknown][] = [
    ['row-plan', '/abo'],
    ['row-notifications', '/benachrichtigungen'],
    ['row-profile', { pathname: '/profil', params: { flow: 'edit' } }],
    ['row-delivery', '/zustellung'],
    ['row-data', '/daten'],
    ['row-help', '/hilfe'],
  ];
  for (const [id, route] of rows) {
    await fireEvent.press(screen.getByTestId(id));
    expect(mockPush).toHaveBeenLastCalledWith(route);
  }
  // A native switch, not a checkbox (P14); switching on asks for Face ID inside setEnabled.
  const lock = screen.getByTestId('lock-switch');
  expect(lock.props.accessibilityLabel).toBe(t('lockSetting', { method: 'Face ID' }));
  await fireEvent(lock, 'valueChange', true);
  expect(mockSetEnabled).toHaveBeenCalledWith(true);

  expect(screen.getByText(t('appVersion', { version: '1.0.0' }))).toBeTruthy();
  await fireEvent.press(screen.getByTestId('sign-out'));
  expect(mockSignOut).toHaveBeenCalled();
});

it('sign-in shows the website logo and wordmark', async () => {
  await render(<SignIn />);
  const props = allProps(screen.toJSON() as Node);
  expect(
    props.some(
      (p) => p.d === 'M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z',
    ),
  ).toBe(true);
  // Text and button both speak of a code (P4); a way to a new account (P2).
  expect(screen.getByText(t('signInIntro'))).toBeTruthy();
  expect(t('signInIntro')).toMatch(/Code/);
  expect(screen.getByLabelText(t('sendCode'))).toBeTruthy();
  await fireEvent.press(screen.getByTestId('to-signup'));
  expect(mockReplace).toHaveBeenCalledWith('/registrieren');
});
