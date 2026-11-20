import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
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
