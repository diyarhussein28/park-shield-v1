import { StyleSheet, Text, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { BrandTabBar } from '@/components/tab-bar';
import { AlertsProvider, useAlerts } from '@/lib/alerts-store';
import { t } from '@/lib/i18n';
import { setSession } from '@/lib/session';
import { dark } from '@/theme/tokens';
import { stackOptions } from '@/theme/navigation';

let mockSignedIn: boolean | undefined = true;
// Only the root layout module's exports are read; the real router needs an ESM-only package in Jest.
jest.mock('expo-router', () => ({
  Stack: Object.assign(() => null, { Screen: () => null }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSegments: () => [],
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signedIn: mockSignedIn }) }));

const list = (n: number) => ({
  alerts: Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    type: { code: 'lights_on', de: 'Licht', en: 'Lights' },
    severity: 'normal',
    status: 'delivered',
    isTest: false,
    createdAt: '2026-11-19T12:00:00Z',
    seenAt: null,
    acknowledged: false,
    acknowledgedBy: null,
    escalationStep: 0,
    vehicle: { id: 'v', nickname: 'Blue' },
    photoCount: 0,
    chatStatus: null,
  })),
  next: null,
  pushReady: true,
});

function Count() {
  const { data, open } = useAlerts();
  return <Text testID="count">{data ? String(open) : 'none'}</Text>;
}

beforeEach(async () => {
  mockSignedIn = true;
  await setSession('session-token-0000000000000000000001');
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => list(2),
  })) as unknown as typeof fetch;
});

it('a cold-start deep link opens the alert with the tabs beneath it', () => {
  const root = require('@/app/_layout') as { unstable_settings?: { initialRouteName?: string } };
  expect(root.unstable_settings?.initialRouteName).toBe('(tabs)');
});

it('pushed screens get the theme colours in dark mode (header, title, tint, background)', () => {
  const o = stackOptions(dark);
  expect(o.headerStyle).toEqual({ backgroundColor: dark.bg });
  expect(o.headerTintColor).toBe(dark.primary);
  expect(o.headerTitleStyle).toEqual({ color: dark.fg });
  expect(o.contentStyle).toEqual({ backgroundColor: dark.bg });
});

it('tab labels and the badge cap their text growth; the badge has no fixed height', async () => {
  const routes = ['index', 'fahrzeuge', 'konto', 'mehr'].map((name) => ({ key: name, name }));
  await render(
    <BrandTabBar
      state={{ index: 0, routes }}
      emitter={{ emit: () => ({ defaultPrevented: false }) }}
      navigateToTab={() => {}}
      insets={{ bottom: 0 }}
      badges={{ index: 120 }}
    />,
  );
  const label = screen.getByText(t('tabVehicles'));
  expect(label.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
  const badge = screen.getByText('99+');
  expect(badge.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
  const box = StyleSheet.flatten(screen.getByTestId('tab-badge').props.style) as Record<
    string,
    unknown
  >;
  expect(box.height).toBeUndefined();
  expect(box.minHeight).toBeGreaterThanOrEqual(20);
});

describe('the alerts store', () => {
  it('loads on its own, without the feed asking', async () => {
    await render(
      <AlertsProvider>
        <Count />
      </AlertsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('2'));
  });

  it('forgets the previous account’s alerts on sign-out', async () => {
    const { rerender } = await render(
      <AlertsProvider>
        <Count />
      </AlertsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('2'));
    mockSignedIn = false;
    await rerender(
      <AlertsProvider>
        <Count />
      </AlertsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('none'));
  });

  it('refreshes the badge when the app comes back to the foreground or a push arrives', async () => {
    const listeners: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, fn) => {
      listeners.push(fn as (s: string) => void);
      return { remove: jest.fn() } as never;
    });
    await render(
      <AlertsProvider>
        <Count />
      </AlertsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('2'));
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => list(5),
    })) as unknown as typeof fetch;
    await act(async () => listeners.forEach((fn) => fn('active')));
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('5'));

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => list(7),
    })) as unknown as typeof fetch;
    const received = (Notifications.addNotificationReceivedListener as jest.Mock).mock.calls.at(
      -1,
    )![0];
    await act(async () => received({}));
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('7'));
  });
});
