import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { getFlag, setFlag } from '@/lib/prefs';
import { saveLang } from '@/lib/language';
import { getSession, setDeviceToken, setSession } from '@/lib/session';

const mockDisk = new Map<string, string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('');
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    textSync() {
      return mockDisk.get(this.uri) ?? '';
    }
    writeSync(content: string) {
      mockDisk.set(this.uri, content);
    }
    delete() {
      mockDisk.delete(this.uri);
    }
  }
  return { File, Paths: { document: { uri: 'file:///docs/' } } };
});
jest.mock('expo-linking', () => ({ createURL: (p: string) => `parkshield://${p}` }));

let auth: ReturnType<typeof useAuth> | null = null;
function Probe() {
  auth = useAuth();
  return <Text>{String(auth.signedIn)}</Text>;
}

/**
 * „Abmelden“ (2026-11-22): server first (push token removed, session revoked), then everything
 * personal leaves the phone; only the language stays.
 */
it('revokes on the server and leaves only the language on the phone', async () => {
  const store = (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store;
  await setSession('session-token-0000000000000000000001');
  await setDeviceToken('fcm-token-0001');
  await setFlag('onboarded', true);
  await setFlag('lockEnabled', true);
  await setFlag('pushAsked', true);
  await saveLang('en');
  mockDisk.set('file:///docs/vehicle-photos.json', JSON.stringify({ v1: 'vehicle-v1-1.jpg' }));
  mockDisk.set('file:///docs/vehicle-v1-1.jpg', 'jpeg');
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  })) as unknown as typeof fetch;

  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(auth?.signedIn).toBe(true));
  await act(() => auth!.signOut());

  const calls = (global.fetch as jest.Mock).mock.calls.map(
    ([u, i]: [string, RequestInit | undefined]) => `${i?.method ?? 'GET'} ${u}`,
  );
  expect(calls.some((c) => c.startsWith('DELETE') && c.includes('/v1/app/devices/'))).toBe(true);
  expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/v1/auth/logout'))).toBe(true);
  expect(auth!.signedIn).toBe(false);
  expect(await getSession()).toBeNull();
  for (const f of ['onboarded', 'lockEnabled', 'pushAsked'] as const) {
    expect(await getFlag(f)).toBe(false);
  }
  // Nothing personal on the phone any more: no session, no push token, no car photo.
  expect([...store.keys()]).toEqual(['ps.lang']);
  expect(store.get('ps.lang')).toBe('en');
  expect(mockDisk.size).toBe(0);
  await saveLang('de');
});
