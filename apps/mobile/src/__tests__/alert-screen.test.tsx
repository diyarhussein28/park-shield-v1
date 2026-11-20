import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { t } from '@/lib/i18n';
import { setSession } from '@/lib/session';
import type { AlertDetail } from '@/lib/types';
import AlertScreen from '@/app/alerts/[id]';

const ALERT = '3f1e6a3c-1b2d-4c5e-8f90-1a2b3c4d5e6f';
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '3f1e6a3c-1b2d-4c5e-8f90-1a2b3c4d5e6f' }),
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  // The screen loads on focus; in a test it is focused once, on mount.
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cb, []);
  },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-media-library', () => ({}));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: {} }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

const detail = (over: Partial<AlertDetail> = {}): AlertDetail => ({
  id: ALERT,
  type: { code: 'custom', de: 'Eigene Nachricht', en: 'Custom message' },
  severity: 'normal',
  status: 'delivered',
  isTest: false,
  createdAt: '2026-11-19T12:00:00Z',
  expiresAt: '2026-11-19T14:00:00Z',
  seenAt: null,
  reply: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
  escalation: { applies: true, step: 0, escalatedAt: null, notified: [] },
  vehicle: { id: 'v1', nickname: 'Der Blaue' },
  contentHidden: false,
  revealed: true,
  message: 'Bitte Auto wegfahren',
  photos: [],
  photoCount: 0,
  chat: {
    status: 'locked',
    openedAt: null,
    closedAt: null,
    closeReason: null,
    purged: false,
    remaining: 20,
    limits: { maxChars: 500, maxPerSide: 20, inactivityMinutes: 20, maxMinutes: 180 },
    scanner: { online: true, lastSeenAt: '2026-11-19T12:01:00Z' },
    readByOther: null,
    messages: [],
    canOpen: true,
    senderBlocked: false,
  },
  ...over,
});

const respond = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);

beforeEach(async () => {
  mockPush.mockReset();
  await setSession('session-token-0000000000000000000001');
});

it('shows the alert, marks it seen, and „Ich komme" acknowledges it', async () => {
  let current = detail();
  const calls: string[] = [];
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.test', '')}`);
    if (url.endsWith('/ack')) {
      current = detail({ reply: 'coming', acknowledgedBy: { kind: 'owner', name: null } });
      return respond({ reply: 'coming', escalating: false });
    }
    if (url.endsWith('/seen')) return respond({ seenAt: '2026-11-19T12:02:00Z' });
    return respond(current);
  }) as unknown as typeof fetch;

  await render(<AlertScreen />);
  expect(await screen.findByText('Eigene Nachricht')).toBeTruthy();
  expect(screen.getByText('Bitte Auto wegfahren')).toBeTruthy();
  expect(screen.getByText('Absender ist gerade online')).toBeTruthy();
  expect(calls).toContain(`POST /v1/app/alerts/${ALERT}/seen`);

  fireEvent.press(screen.getByTestId('ack'));
  expect(
    await screen.findByText('Sie haben „Ich komme“ gesendet. Die Person am Fahrzeug sieht das.'),
  ).toBeTruthy();
  expect(calls).toContain(`POST /v1/app/alerts/${ALERT}/ack`);
  expect(screen.queryByTestId('ack')).toBeNull();
});

it('opens the chat only on the owner’s tap, and never for a blocked sender', async () => {
  const calls: string[] = [];
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.test', '')}`);
    return respond(url.endsWith('/chat/open') ? { status: 'active' } : detail());
  }) as unknown as typeof fetch;
  await render(<AlertScreen />);
  fireEvent.press(await screen.findByTestId('open-chat'));
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: ALERT } }),
  );
  expect(calls).toContain(`POST /v1/app/alerts/${ALERT}/chat/open`);
});

it('shows who acknowledged when a trusted contact is on the way; no chat for blocked senders', async () => {
  const blocked = detail({
    acknowledgedBy: { kind: 'contact', name: 'Kim' },
    reply: 'coming',
    chat: { ...detail().chat!, canOpen: false, senderBlocked: true },
  });
  global.fetch = jest.fn(() => respond(blocked)) as unknown as typeof fetch;
  await render(<AlertScreen />);
  expect(await screen.findByText('Kim kümmert sich darum.')).toBeTruthy();
  expect(screen.getByText('Ein Chat ist mit diesem Absender nicht möglich.')).toBeTruthy();
  expect(screen.queryByTestId('open-chat')).toBeNull();
});

it('urgent actions come first, in order: „Ich komme“, the chat, then the two other replies', async () => {
  global.fetch = jest.fn((url: string) =>
    url.endsWith('/seen') ? respond({ seenAt: '2026-11-19T12:02:00Z' }) : respond(detail()),
  ) as jest.Mock;
  await render(<AlertScreen />);
  await screen.findByText('Bitte Auto wegfahren');
  const order = screen
    .getAllByRole('button')
    .map((b) => b.props.accessibilityLabel as string)
    .filter((l) => [t('coming'), t('chatOpen'), t('in30'), t('notNearby')].includes(l));
  expect(order).toEqual([t('coming'), t('chatOpen'), t('in30'), t('notNearby')]);
  const coming = screen.getByLabelText(t('coming'));
  const flat = StyleSheet.flatten(
    typeof coming.props.style === 'function'
      ? coming.props.style({ pressed: false })
      : coming.props.style,
  );
  expect(flat.minHeight).toBe(56);
});
