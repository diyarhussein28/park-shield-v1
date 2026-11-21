import type * as React from 'react';
import type * as RN from 'react-native';
import type * as ChatModule from '@/lib/chat';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { AlertsProvider } from '@/lib/alerts-store';
import { onDecalChange } from '@/lib/decal';
import { t } from '@/lib/i18n';
import { setSession } from '@/lib/session';
import type { AlertDetail, AlertListItem } from '@/lib/types';
import Alerts from '@/app/(tabs)/alerts';
import Vehicles from '@/app/(tabs)/fahrzeuge';
import AlertScreen from '@/app/alerts/[id]';
import Chat from '@/app/chat/[id]';
import DecalDesign from '@/app/fahrzeug/design/[id]';
import { decalChanged } from '@/lib/decal';

const ALERT = '3f1e6a3c-1b2d-4c5e-8f90-1a2b3c4d5e6f';
const VEHICLE = '7c2e1f40-5b6a-4d3e-9f10-2a3b4c5d6e7f';
let mockParams: Record<string, string> = { id: ALERT };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof React>('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cb, []);
  },
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signedIn: true }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));
jest.mock('expo-image', () => {
  const { Text } = jest.requireActual<typeof RN>('react-native');
  return {
    Image: (p: { testID?: string; source: { uri: string } }) => (
      <Text testID={p.testID ?? 'image'}>{p.source.uri}</Text>
    ),
  };
});
jest.mock('expo-media-library', () => ({}));
// The live chat: an active chat; the block arrives as „closed“ from the server.
const mockChatState = { status: 'active' as string, closeReason: null as string | null };
jest.mock('@/lib/chat', () => ({
  ...jest.requireActual<typeof ChatModule>('@/lib/chat'),
  useChat: () => ({
    state: {
      status: mockChatState.status,
      closeReason: mockChatState.closeReason,
      limits: { maxChars: 500, maxPerSide: 20, inactivityMinutes: 20, maxMinutes: 180 },
      quickReplies: [],
      scanner: { online: true, lastSeenAt: null },
    },
    messages: [],
    typing: false,
    connected: true,
    error: null,
    readAt: null,
    seen: jest.fn(),
    send: jest.fn(),
    setTyping: jest.fn(),
  }),
}));

const respond = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 300, status, json: async () => body } as Response);
const calls = () =>
  (global.fetch as jest.Mock).mock.calls.map(
    ([u, i]: [string, RequestInit | undefined]) =>
      `${i?.method ?? 'GET'} ${u.replace('https://api.test', '')}`,
  );
/** The confirmation dialog: checks its text, then presses „Blockieren“. */
const confirmBlock = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    expect(title).toBe(t('blockConfirmTitle'));
    for (const k of ['blockConfirm1', 'blockConfirm2', 'blockConfirm3'] as const)
      expect(message).toContain(t(k));
    buttons?.[1]?.onPress?.();
  });
const BLOCKED = { blocked: true, chatClosed: true, phoneBanned: false, protectedMode: false };

const item = (over: Partial<AlertListItem>): AlertListItem => ({
  id: ALERT,
  type: { code: 'lights_on', de: 'Licht brennt noch', en: 'Lights are on' },
  severity: 'normal',
  status: 'delivered',
  isTest: false,
  createdAt: '2026-11-19T12:00:00Z',
  seenAt: null,
  acknowledged: false,
  acknowledgedBy: null,
  escalationStage: 'none',
  vehicle: { id: VEHICLE, nickname: 'Blue' },
  photoCount: 0,
  chatStatus: 'active',
  ...over,
});

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
  escalation: {
    stage: 'none',
    reminderAt: null,
    remindedAt: null,
    smsDueAt: null,
    smsSentAt: null,
    stoppedAt: null,
    stopReason: null,
  },
  vehicle: { id: VEHICLE, nickname: 'Blue' },
  contentHidden: false,
  revealed: true,
  message: null,
  photos: [],
  photoCount: 0,
  photosGone: null,
  reported: false,
  chat: {
    status: 'active',
    openedAt: '2026-11-19T12:01:00Z',
    closedAt: null,
    closeReason: null,
    purged: false,
    remaining: null,
    limits: { maxChars: 500, maxPerSide: 20, inactivityMinutes: 20, maxMinutes: 180 },
    scanner: { online: true, lastSeenAt: null },
    readByOther: null,
    messages: [],
    canOpen: false,
    senderBlocked: false,
  },
  ...over,
});
const blockedDetail = () =>
  detail({
    escalation: {
      ...detail().escalation,
      stoppedAt: '2026-11-19T12:05:00Z',
      stopReason: 'blocked',
    },
    chat: {
      ...detail().chat!,
      status: 'closed',
      closeReason: 'blocked',
      closedAt: '2026-11-19T12:05:00Z',
      senderBlocked: true,
    },
  });

beforeEach(async () => {
  jest.restoreAllMocks();
  mockParams = { id: ALERT };
  mockChatState.status = 'active';
  mockChatState.closeReason = null;
  await setSession('session-token-0000000000000000000001');
});

describe('„Absender blockieren“ (Stage 3)', () => {
  it('on the alert card: confirms, calls /block, then the card says so; never on test alerts', async () => {
    global.fetch = jest.fn((url: string) =>
      url.endsWith('/block')
        ? respond(BLOCKED)
        : url.endsWith('/v1/app/alerts')
          ? respond({
              alerts: [item({}), item({ id: 'test-1', isTest: true })],
              next: null,
              pushReady: true,
            })
          : respond({ alerts: [] }),
    ) as unknown as typeof fetch;
    const ask = confirmBlock();
    await render(
      <AlertsProvider>
        <Alerts />
      </AlertsProvider>,
    );
    expect(screen.queryByTestId('block-test-1')).toBeNull();
    await fireEvent.press(await screen.findByTestId(`block-${ALERT}`));
    expect(ask).toHaveBeenCalled();
    expect(await screen.findByText(t('blocked'))).toBeTruthy();
    expect(calls()).toContain(`POST /v1/app/alerts/${ALERT}/block`);
    expect(screen.queryByTestId(`block-${ALERT}`)).toBeNull();
  });

  it('cancelling the dialog blocks nothing', async () => {
    global.fetch = jest.fn(() =>
      respond({ alerts: [item({})], next: null, pushReady: true }),
    ) as unknown as typeof fetch;
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[0]?.onPress?.());
    await render(
      <AlertsProvider>
        <Alerts />
      </AlertsProvider>,
    );
    await fireEvent.press(await screen.findByTestId(`block-${ALERT}`));
    expect(calls().some((c) => c.endsWith('/block'))).toBe(false);
  });

  it('in the alert detail: the chat ends and the escalation stops', async () => {
    let current = detail();
    global.fetch = jest.fn((url: string) => {
      if (url.endsWith('/block')) {
        current = blockedDetail();
        return respond(BLOCKED);
      }
      return respond(current);
    }) as unknown as typeof fetch;
    confirmBlock();
    await render(<AlertScreen />);
    await fireEvent.press(await screen.findByTestId('block-sender'));
    expect(await screen.findByTestId('blocked')).toBeTruthy();
    expect(screen.getByText(t('blocked'))).toBeTruthy();
    expect(screen.getByText(`${t('escStopped')} ${t('escStop_blocked')}`)).toBeTruthy();
    expect(screen.queryByTestId('block-sender')).toBeNull();
    expect(screen.queryByLabelText(t('chatContinue'))).toBeNull();
    expect(calls()).toContain(`POST /v1/app/alerts/${ALERT}/block`);
  });

  it('not offered for a test alert', async () => {
    global.fetch = jest.fn(() => respond(detail({ isTest: true }))) as unknown as typeof fetch;
    await render(<AlertScreen />);
    await screen.findByText('Eigene Nachricht');
    expect(screen.queryByTestId('block-sender')).toBeNull();
  });

  it('in the live chat: blocking closes it at once, the input disappears', async () => {
    global.fetch = jest.fn((url: string) =>
      url.endsWith('/block') ? respond(BLOCKED) : respond(detail()),
    ) as unknown as typeof fetch;
    confirmBlock();
    await render(<Chat />);
    expect(screen.getByTestId('chat-input')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('block-sender'));
    expect(await screen.findByTestId('chat-blocked')).toBeTruthy();
    expect(screen.queryByTestId('chat-input')).toBeNull();
    expect(calls()).toContain(`POST /v1/app/alerts/${ALERT}/block`);
  });

  it('a chat the server closed by a block says so too', async () => {
    mockChatState.status = 'closed';
    mockChatState.closeReason = 'blocked';
    global.fetch = jest.fn(() => respond(blockedDetail())) as unknown as typeof fetch;
    await render(<Chat />);
    expect(screen.getByText(t('blocked'))).toBeTruthy();
    expect(screen.queryByTestId('block-sender')).toBeNull();
  });
});

describe('design refresh (Stage 4.3)', () => {
  const vehicle = (template: string, cta: string) => ({
    id: VEHICLE,
    nickname: 'Blue',
    plate: 'K-AB 1',
    makeModel: null,
    color: null,
    createdAt: '',
    decal: {
      tokenId: 't1',
      codeHint: 'K3Q9',
      status: 'assigned',
      cta,
      template,
      activatedAt: null,
      lastTestAt: null,
      testWindowUntil: null,
    },
  });

  it('„Design speichern“ tells every screen that shows the decal', async () => {
    mockParams = { id: VEHICLE };
    global.fetch = jest.fn((url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? respond(vehicle('bold', 'Bitte scannen'))
        : respond(vehicle('classic', 'Bitte scannen')),
    ) as unknown as typeof fetch;
    const listener = jest.fn();
    const off = onDecalChange(listener);
    await render(<DecalDesign />);
    await fireEvent.press(await screen.findByTestId('template-bold'));
    await fireEvent.press(screen.getByTestId('design-save'));
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    off();
  });

  it('the Fahrzeuge tab shows the new design at once, without a tab switch', async () => {
    let current = vehicle('classic', 'Bitte scannen');
    global.fetch = jest.fn((url: string) =>
      url.endsWith('/v1/vehicles')
        ? respond({ vehicles: [current] })
        : respond({ subscription: { plan: 'standard', status: 'active' } }),
    ) as unknown as typeof fetch;
    await render(<Vehicles />);
    expect((await screen.findByTestId('image')).props.children).toContain('template=classic');
    current = vehicle('bold', 'Neu');
    await act(async () => decalChanged());
    await waitFor(() =>
      expect(screen.getByTestId('image').props.children).toContain('template=bold&cta=Neu'),
    );
  });
});
