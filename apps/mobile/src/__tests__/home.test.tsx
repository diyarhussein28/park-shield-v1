import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AlertsProvider } from '@/lib/alerts-store';
import { setSession } from '@/lib/session';
import Alerts from '@/app/(tabs)/index';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
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

const ALERT = '3f1e6a3c-1b2d-4c5e-8f90-1a2b3c4d5e6f';

beforeEach(async () => {
  jest.clearAllMocks();
  await setSession('session-token-0000000000000000000001');
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      alerts: [
        {
          id: ALERT,
          type: { code: 'lights_on', de: 'Licht brennt noch', en: 'Lights are on' },
          severity: 'normal',
          status: 'delivered',
          isTest: true,
          createdAt: '2026-11-19T12:00:00Z',
          seenAt: null,
          acknowledged: false,
          acknowledgedBy: null,
          escalationStep: 0,
          vehicle: { id: 'v1', nickname: 'Blue' },
          photoCount: 0,
          chatStatus: null,
        },
      ],
      next: null,
      pushReady: true,
    }),
  })) as unknown as typeof fetch;
});

it('a tap on an alert opens it', async () => {
  await render(
    <AlertsProvider>
      <Alerts />
    </AlertsProvider>,
  );
  await fireEvent.press(await screen.findByLabelText(/^Licht brennt noch, Blue,/));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/alerts/[id]', params: { id: ALERT } });
});

/**
 * <Link asChild> passes its child through expo-router's Slot, which throws a render error for a
 * Pressable with a style array (seen on the iPhone). The mocked router in these tests cannot show it,
 * so the pattern is kept out of the app: navigate with router.push in onPress instead.
 */
it('the app does not use <Link asChild>', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(name) && !p.includes('__tests__')) files.push(p);
    }
  };
  walk(join(__dirname, '..'));
  const offenders = files.filter((f) => /<Link[^>]*\basChild\b/.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
