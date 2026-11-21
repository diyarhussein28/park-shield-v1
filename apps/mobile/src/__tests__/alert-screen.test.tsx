import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
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
  escalation: {
    stage: 'none',
    reminderAt: '2026-11-19T12:10:00Z',
    remindedAt: null,
    smsDueAt: '2026-11-19T12:30:00Z',
    smsSentAt: null,
    stoppedAt: null,
    stopReason: null,
  },
  vehicle: { id: 'v1', nickname: 'Der Blaue' },
  contentHidden: false,
  revealed: true,
  message: 'Bitte Auto wegfahren',
  photos: [],
  photoCount: 0,
  photosGone: null,
  reported: false,
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

it('no chat for blocked senders', async () => {
  const blocked = detail({
    acknowledgedBy: { kind: 'owner', name: null },
    reply: 'coming',
    chat: { ...detail().chat!, canOpen: false, senderBlocked: true },
  });
  global.fetch = jest.fn(() => respond(blocked)) as unknown as typeof fetch;
  await render(<AlertScreen />);
  expect(await screen.findByText(t('comingDone'))).toBeTruthy();
  expect(screen.getByText('Ein Chat ist mit diesem Absender nicht möglich.')).toBeTruthy();
  expect(screen.queryByTestId('open-chat')).toBeNull();
});

describe('owner escalation (reminder after 10 min, one SMS after 30 min)', () => {
  const at = (iso: string) =>
    new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  it('an open alert says when the reminder and the SMS will come; no trusted contacts', async () => {
    global.fetch = jest.fn(() => respond(detail())) as unknown as typeof fetch;
    await render(<AlertScreen />);
    expect(
      await screen.findByText(
        t('escPlanned', { reminder: at('2026-11-19T12:10:00Z'), sms: at('2026-11-19T12:30:00Z') }),
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Vertrauensperson|Notfallkontakt/)).toBeNull();
  });

  it('shows the reminder and the SMS that went out', async () => {
    global.fetch = jest.fn(() =>
      respond(
        detail({
          escalation: {
            stage: 'sms_sent',
            reminderAt: null,
            remindedAt: '2026-11-19T12:10:00Z',
            smsDueAt: null,
            smsSentAt: '2026-11-19T12:30:00Z',
            stoppedAt: null,
            stopReason: null,
          },
        }),
      ),
    ) as unknown as typeof fetch;
    await render(<AlertScreen />);
    expect(
      await screen.findByText(t('escReminderSent', { time: at('2026-11-19T12:10:00Z') })),
    ).toBeTruthy();
    expect(screen.getByText(t('escSmsSent', { time: at('2026-11-19T12:30:00Z') }))).toBeTruthy();
  });

  it('„Erledigt“ calls /resolve, which stops the reminder and the SMS', async () => {
    let current = detail();
    const calls: string[] = [];
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.test', '')}`);
      if (url.endsWith('/resolve')) {
        current = detail({
          escalation: {
            ...detail().escalation,
            reminderAt: null,
            smsDueAt: null,
            stoppedAt: '2026-11-19T12:03:00Z',
            stopReason: 'resolved',
          },
        });
        return respond({ resolvedAt: '2026-11-19T12:03:00Z' });
      }
      return respond(current);
    }) as unknown as typeof fetch;
    await render(<AlertScreen />);
    fireEvent.press(await screen.findByTestId('resolve'));
    expect(await screen.findByText(`${t('escStopped')} ${t('escStop_resolved')}`)).toBeTruthy();
    expect(calls).toContain(`POST /v1/app/alerts/${ALERT}/resolve`);
    // Done: no „Ich komme“ and no „Erledigt“ any more, the status chip says so.
    expect(screen.queryByTestId('ack')).toBeNull();
    expect(screen.queryByTestId('resolve')).toBeNull();
    expect(screen.getByText(t('acknowledged'))).toBeTruthy();
  });
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

it('„Missbrauch melden“ under the photos asks once more, deletes them and says so', async () => {
  const photos = [
    { id: 'm1', position: 1, width: 1600, height: 1200 },
    { id: 'm2', position: 2, width: 1600, height: 1200 },
  ];
  let current = detail({ photos, photoCount: 2 });
  const calls: string[] = [];
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.test', '')}`);
    if (url.endsWith('/report-abuse')) {
      current = detail({ photosGone: 'abuse_report', reported: true, message: null });
      return respond({ deleted: 2, blocked: true });
    }
    if (url.endsWith('/seen')) return respond({ seenAt: '2026-11-19T12:02:00Z' });
    return respond(current);
  }) as unknown as typeof fetch;

  await render(<AlertScreen />);
  fireEvent.press(await screen.findByTestId('report-abuse'));
  expect(
    await screen.findByText(
      'Die Fotos und die Nachricht werden sofort gelöscht, und der Absender kann Ihr Fahrzeug nicht mehr benachrichtigen. Fortfahren?',
    ),
  ).toBeTruthy();
  // Nothing is deleted on the first tap.
  expect(calls.some((c) => c.includes('report-abuse'))).toBe(false);
  fireEvent.press(screen.getByTestId('report-abuse-confirm'));
  expect(
    await screen.findByText(
      'Danke. Die Fotos wurden gelöscht und der Absender wurde für dieses Fahrzeug gesperrt.',
    ),
  ).toBeTruthy();
  expect(calls).toContain(`POST /v1/portal/alerts/${ALERT}/report-abuse`);
  await waitFor(() => expect(screen.queryByTestId('report-abuse')).toBeNull());
});

it('cancelling the report deletes nothing; deleted photos say why they are gone', async () => {
  const calls: string[] = [];
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return respond(
      detail({ photos: [{ id: 'm1', position: 1, width: 4, height: 3 }], photoCount: 1 }),
    );
  }) as unknown as typeof fetch;
  await render(<AlertScreen />);
  fireEvent.press(await screen.findByTestId('report-abuse'));
  fireEvent.press(await screen.findByLabelText('Abbrechen'));
  expect(await screen.findByTestId('report-abuse')).toBeTruthy();
  expect(calls.some((c) => c.includes('report-abuse'))).toBe(false);

  global.fetch = jest.fn(() =>
    respond(detail({ photosGone: 'retention' })),
  ) as unknown as typeof fetch;
  await render(<AlertScreen />);
  expect(
    await screen.findByText('Die Fotos zu diesem Alarm wurden nach 30 Tagen automatisch gelöscht.'),
  ).toBeTruthy();
  expect(screen.queryByTestId('report-abuse')).toBeNull();
});

it('„In ca. 30 Min“ and „Bin nicht in der Nähe“ confirm what the person at the vehicle now sees', async () => {
  let current = detail();
  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/ack')) {
      const { reply } = JSON.parse(String(init?.body)) as { reply: 'in_30_min' | 'not_nearby' };
      current = detail({ reply });
      return respond({ reply, escalating: reply === 'not_nearby' });
    }
    if (url.endsWith('/seen')) return respond({ seenAt: '2026-11-19T12:02:00Z' });
    return respond(current);
  }) as unknown as typeof fetch;

  await render(<AlertScreen />);
  fireEvent.press(await screen.findByLabelText(t('in30')));
  expect(
    await screen.findByText('Danke! Die Person sieht, dass Sie in etwa 30 Minuten da sind.'),
  ).toBeTruthy();
  // „Ich komme“ is still possible afterwards.
  expect(screen.getByTestId('ack')).toBeTruthy();

  fireEvent.press(screen.getByLabelText(t('notNearby')));
  expect(await screen.findByText(pt('reply.doneNotNearby'))).toBeTruthy();
});
