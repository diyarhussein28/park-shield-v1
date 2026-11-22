import { act, render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Text } from 'react-native';
import { AlertsProvider, unseenOf, useAlerts } from '@/lib/alerts-store';
import { setSession } from '@/lib/session';
import type { AlertListItem } from '@/lib/types';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signedIn: true }) }));

const item = (id: string, over: Partial<AlertListItem> = {}): AlertListItem => ({
  id,
  type: { code: 'lights_on', de: 'Licht brennt noch', en: 'Lights are on' },
  severity: 'normal',
  status: 'delivered',
  isTest: false,
  createdAt: '2026-11-21T22:00:00Z',
  seenAt: null,
  acknowledged: false,
  acknowledgedBy: null,
  escalationStage: 'none',
  vehicle: { id: 'v1', nickname: 'Dodo' },
  photoCount: 0,
  chatStatus: null,
  senderBlocked: false,
  blockedUntil: null,
  ...over,
});

let store: ReturnType<typeof useAlerts> | null = null;
function Probe() {
  store = useAlerts();
  return <Text>{store.unseen}</Text>;
}

const badge = Notifications.setBadgeCountAsync as jest.Mock;

beforeEach(async () => {
  badge.mockClear();
  await setSession('session-token-0000000000000000000001');
});

it('the badge counts alerts not opened yet, from the server; seen or done never count', () => {
  expect(
    unseenOf([
      item('a', { seenAt: '2026-11-21T22:01:00Z' }),
      item('b', { acknowledged: true }),
      item('c', { resolved: true }),
      item('d'),
    ]),
  ).toBe(1);
});

it('opening an alert lowers the tab and app icon badge at once; 0 removes it', async () => {
  let unseenCount = 2;
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      // Both alerts are open (no „Ich komme“), only one is still unopened: the old bug showed 2.
      alerts: [item('a', { seenAt: unseenCount < 2 ? '2026-11-21T22:05:00Z' : null }), item('b')],
      next: null,
      pushReady: true,
      unseenCount,
    }),
  })) as unknown as typeof fetch;
  await render(
    <AlertsProvider>
      <Probe />
    </AlertsProvider>,
  );
  await waitFor(() => expect(store?.unseen).toBe(2));
  expect(badge).toHaveBeenLastCalledWith(2);

  // Optimistic: one less at once …
  await act(() => store!.markSeen('a'));
  expect(store!.unseen).toBe(1);
  // … then the server's answer of POST /seen wins.
  await act(() => store!.markSeen('b', 0));
  expect(store!.unseen).toBe(0);
  await waitFor(() => expect(badge).toHaveBeenLastCalledWith(0));

  // A genuinely new alert brings it back on the next sync (focus, foreground, push).
  unseenCount = 1;
  await act(() => store!.reload());
  expect(store!.unseen).toBe(1);
  expect(badge).toHaveBeenLastCalledWith(1);
});
