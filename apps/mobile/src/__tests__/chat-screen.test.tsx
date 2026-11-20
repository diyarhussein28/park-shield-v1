import { AppState, Keyboard, StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import Chat from '@/app/chat/[id]';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'a1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/lib/chat', () => ({
  useChat: () => ({
    state: {
      status: 'active',
      limits: { maxChars: 500, maxPerSide: 20, inactivityMinutes: 20, maxMinutes: 180 },
      quickReplies: ['Ich bin in 2 Minuten am Fahrzeug.'],
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

it('quick replies are full touch targets and the input has the strong outline', async () => {
  await render(<Chat />);
  const quick = screen.getByRole('button', { name: 'Ich bin in 2 Minuten am Fahrzeug.' });
  const flat = (el: { props: { style?: unknown } }) =>
    StyleSheet.flatten(el.props.style as Parameters<typeof StyleSheet.flatten>[0]) as Record<
      string,
      unknown
    >;
  expect(flat(quick).minHeight).toBeGreaterThanOrEqual(48);
  expect(flat(screen.getByTestId('chat-input')).borderColor).toBe('#64748b');
});

it('the owner has no message limit by default: no „messages left“ counter', async () => {
  await render(<Chat />);
  expect(screen.queryByText(/Noch \d+ Nachrichten/)).toBeNull();
  expect(screen.getByText('0 / 500')).toBeTruthy();
});

it('closes the keyboard in the background and rebuilds the layout on return', async () => {
  let onChange: ((s: string) => void) | undefined;
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, handler) => {
    onChange = handler as (s: string) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  await render(<Chat />);
  await act(async () => onChange!('background'));
  expect(dismiss).toHaveBeenCalled();
  await act(async () => onChange!('active'));
  // Rebuilt, still usable.
  expect(screen.getByTestId('chat-input')).toBeTruthy();
  spy.mockRestore();
});
