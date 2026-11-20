import { renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useChat } from './chat';
import { setSession } from './session';

/** A stand-in for the Socket.io client: records connect/disconnect and the options it got. */
const fake = {
  connected: true,
  connect: jest.fn(() => {
    fake.connected = true;
  }),
  disconnect: jest.fn(() => {
    fake.connected = false;
  }),
  on: jest.fn(),
};
const mockIo = jest.fn((..._args: unknown[]) => fake);
jest.mock('socket.io-client', () => ({ io: (...args: unknown[]) => mockIo(...args) }));

let onAppState: ((s: AppStateStatus) => void) | undefined;
beforeEach(async () => {
  jest.clearAllMocks();
  fake.connected = true;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    onAppState = handler as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  await setSession('session-token-0000000000000000000001');
});

it('closes the chat connection in the background, so new messages arrive as a push', async () => {
  await renderHook(() => useChat('3f1e6a3c-1b2d-4c5e-8f90-1a2b3c4d5e6f', true));
  await waitFor(() => expect(mockIo).toHaveBeenCalled());
  const opts = mockIo.mock.calls[0]![1] as { transports: string[]; auth: { role: string } };
  expect(opts.transports).toEqual(['websocket', 'polling']);
  expect(opts.auth.role).toBe('owner');

  onAppState!('inactive'); // Control Centre, an incoming call: stays connected
  expect(fake.disconnect).not.toHaveBeenCalled();
  onAppState!('background');
  expect(fake.disconnect).toHaveBeenCalledTimes(1);
  onAppState!('active');
  expect(fake.connect).toHaveBeenCalledTimes(1);
});
