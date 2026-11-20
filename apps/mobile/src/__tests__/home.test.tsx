import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AlertsProvider } from '@/lib/alerts-store';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
import { setSession } from '@/lib/session';
import Alerts from '@/app/(tabs)/alerts';

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

const OLD = '3f1e6a3c-1b2d-4c5e-8f90-1a2b3c4d5e6f';
const NEW = '9a1e6a3c-1b2d-4c5e-8f90-1a2b3c4d5e6f';
const item = (id: string, acknowledged: boolean, de: string) => ({
  id,
  type: { code: 'lights_on', de, en: de },
  severity: 'normal',
  status: 'delivered',
  isTest: false,
  createdAt: '2026-11-19T12:00:00Z',
  seenAt: null,
  acknowledged,
  acknowledgedBy: null,
  escalationStep: 0,
  vehicle: { id: 'v1', nickname: 'Blue' },
  photoCount: 0,
  chatStatus: null,
});

function api(alerts: object[]) {
  global.fetch = jest.fn(async (url: string) => {
    const path = url.replace('https://api.test', '');
    const body =
      path === '/v1/app/alerts'
        ? { alerts, next: null, pushReady: true }
        : path === '/v1/alerts'
          ? { alerts: [] }
          : {};
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

describe('the Warnungen tab', () => {
  it('lists open alerts first; a tap opens the alert', async () => {
    api([item(OLD, true, 'Licht brennt noch'), item(NEW, false, 'Fenster offen')]);
    await show();
    const cards = await screen.findAllByLabelText(/, Blue,/);
    expect(cards[0]!.props.accessibilityLabel).toMatch(/^Fenster offen/);
    await fireEvent.press(screen.getByLabelText(/^Licht brennt noch, Blue,/));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/alerts/[id]', params: { id: OLD } });
  });

  it('empty: a friendly state that leads to testing the decal', async () => {
    api([]);
    await show();
    expect(await screen.findByText(t('emptyAlertsTitle'))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t('emptyAlertsAction')));
    expect(mockNavigate).toHaveBeenCalledWith('/fahrzeuge');
  });

  it('the 90-day history (the former „Verlauf“) is in the same tab', async () => {
    api([]);
    await show();
    await fireEvent.press(await screen.findByLabelText(t('alertsHistory')));
    expect(await screen.findByText(pt('history.intro'))).toBeTruthy();
    expect(await screen.findByText(pt('history.none'))).toBeTruthy();
  });
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
