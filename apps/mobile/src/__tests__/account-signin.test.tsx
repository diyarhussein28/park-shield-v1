import { fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
import { setSession } from '@/lib/session';
import SignIn from '@/app/anmelden';
import More from '@/app/(tabs)/mehr';

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
        : url.endsWith('/v1/emergency-contacts')
          ? { contacts: [] }
          : {},
  })) as unknown as typeof fetch;
});

it('„Mehr“ leads to every other portal screen, then sign-out and the app version', async () => {
  await render(<More />);
  const rows: [string, string][] = [
    [pt('portal.notifications'), '/benachrichtigungen'],
    [pt('portal.contacts'), '/einstellungen'],
    [pt('portal.history'), '/verlauf'],
    [pt('deliveryHelp.link'), '/zustellung'],
    [pt('portal.data'), '/daten'],
    [t('help'), '/hilfe'],
  ];
  for (const [title, route] of rows) {
    await fireEvent.press(
      await screen.findByLabelText(new RegExp(`^${title.replace(/[?]/g, '\\?')}`)),
    );
    expect(mockPush).toHaveBeenLastCalledWith(route);
  }
  expect(screen.getByText(t('appVersion', { version: '1.0.0' }))).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(t('signOut')));
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
  expect(screen.getByLabelText('ParkShield')).toBeTruthy();
  expect(screen.getByLabelText(t('sendCode'))).toBeTruthy();
});
