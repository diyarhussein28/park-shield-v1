import type * as React from 'react';
import type * as RN from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { t } from '@/lib/i18n';
import { setSession } from '@/lib/session';
import { vehiclePhoto } from '@/lib/vehicle-photo';
import CarPhotoScreen from '@/app/fahrzeug/foto/[id]';
import Home from '@/app/(tabs)/index';
import { AlertsProvider } from '@/lib/alerts-store';

const VEHICLE = '7c2e1f40-5b6a-4d3e-9f10-2a3b4c5d6e7f';
const PICKED = 'file:///cache/ImagePicker/1F2E3D.jpg';

/** An in-memory file system: what the app copies into the document directory survives „restarts“. */
const mockDisk = new Map<string, string>();
jest.mock('expo-file-system', () => {
  const DOCS = 'file:///docs/';
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('');
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    create() {
      mockDisk.set(this.uri, '');
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
    async copy(target: File) {
      if (!mockDisk.has(this.uri)) throw new Error('missing');
      mockDisk.set(target.uri, mockDisk.get(this.uri)!);
    }
  }
  return { File, Paths: { document: { uri: DOCS }, cache: { uri: 'file:///cache/' } } };
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image', () => {
  const { Text } = jest.requireActual<typeof RN>('react-native');
  return {
    Image: (p: { testID?: string; source: { uri: string } }) => (
      <Text testID={p.testID}>{p.source.uri}</Text>
    ),
  };
});
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '7c2e1f40-5b6a-4d3e-9f10-2a3b4c5d6e7f', nickname: 'Blue' }),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual<typeof React>('react');
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cb, []);
  },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signedIn: true }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

const vehicle = {
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
    cta: 'Bitte scannen',
    template: 'classic',
    activatedAt: null,
    lastTestAt: null,
    testWindowUntil: null,
  },
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockDisk.clear();
  mockDisk.set(PICKED, 'jpeg-bytes');
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: PICKED, width: 800, height: 600 }],
  });
  await setSession('session-token-0000000000000000000001');
  global.fetch = jest.fn(async (url: string) => {
    const path = url.replace('https://api.test', '');
    const body =
      path === '/v1/app/alerts'
        ? { alerts: [], next: null, pushReady: true }
        : path === '/v1/billing/subscription'
          ? {
              subscription: {
                plan: 'standard',
                status: 'active',
                contractNo: 'PS-1',
                currentPeriodEnd: '2027-11-19T12:00:00Z',
                cancelAtPeriodEnd: false,
              },
            }
          : path === '/v1/me/protection'
            ? { percent: 100, steps: { email: true, channel: true, phone: true, decal: true } }
            : path === '/v1/vehicles'
              ? { vehicles: [vehicle] }
              : {};
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
});

/** Nothing about the photo (its path or its bytes) may ever reach the API. */
const expectNeverUploaded = () => {
  for (const [url, init] of (global.fetch as jest.Mock).mock.calls as [string, RequestInit?][]) {
    expect(url).not.toMatch(/file:|vehicle-7c2e|ImagePicker/);
    expect(String(init?.body ?? '')).not.toMatch(/file:|vehicle-7c2e|jpeg-bytes/);
  }
};

describe('vehicle photo (on this device only)', () => {
  it('is copied into the document directory, remembered per vehicle, and shown at once', async () => {
    await render(<CarPhotoScreen />);
    expect(screen.getByText(t('carPhotoNote'))).toBeTruthy();
    expect(screen.getByTestId('art-car', { includeHiddenElements: true })).toBeTruthy(); // the illustration by default
    await fireEvent.press(screen.getByTestId('photo-pick'));

    const shown = await screen.findByTestId('car-photo');
    const stored = shown.props.children as string;
    // Persistent storage, not the picker's temporary cache file.
    expect(stored).toMatch(
      /^file:\/\/\/docs\/vehicle-7c2e1f40-5b6a-4d3e-9f10-2a3b4c5d6e7f-\d+\.jpg$/,
    );
    expect(stored).not.toBe(PICKED);
    expect(mockDisk.get(stored)).toBe('jpeg-bytes');
    expect(JSON.parse(mockDisk.get('file:///docs/vehicle-photos.json')!)).toEqual({
      [VEHICLE]: stored.replace('file:///docs/', ''),
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], exif: false }),
    );
    expectNeverUploaded();
  });

  it('survives a restart (read back from the document directory) and shows on Start', async () => {
    // What an earlier session left in the document directory.
    const stored = `file:///docs/vehicle-${VEHICLE}-1700000000000.jpg`;
    mockDisk.set(stored, 'jpeg-bytes');
    mockDisk.set(
      'file:///docs/vehicle-photos.json',
      JSON.stringify({ [VEHICLE]: `vehicle-${VEHICLE}-1700000000000.jpg` }),
    );
    expect(vehiclePhoto(VEHICLE)).toBe(stored);
    await render(
      <AlertsProvider>
        <Home />
      </AlertsProvider>,
    );
    expect((await screen.findByTestId('car-photo')).props.children).toBe(stored);
    expectNeverUploaded();
  });

  it('a new photo replaces the old file (new name = cache-busting key); removing it brings back the car', async () => {
    await render(<CarPhotoScreen />);
    await fireEvent.press(screen.getByTestId('photo-pick'));
    const first = (await screen.findByTestId('car-photo')).props.children as string;
    jest.spyOn(Date, 'now').mockReturnValueOnce(Date.parse('2030-01-01T00:00:00Z'));
    await fireEvent.press(screen.getByTestId('photo-pick'));
    await waitFor(() => expect(screen.getByTestId('car-photo').props.children).not.toBe(first));
    expect(mockDisk.has(first)).toBe(false);

    await fireEvent.press(screen.getByTestId('photo-remove'));
    expect(screen.getByTestId('art-car', { includeHiddenElements: true })).toBeTruthy();
    expect(vehiclePhoto(VEHICLE)).toBeNull();
    expect([...mockDisk.keys()].filter((k) => k.includes('vehicle-7c2e'))).toEqual([]);
  });

  it('a missing file (new phone, reinstall) falls back to the illustration', () => {
    mockDisk.set('file:///docs/vehicle-photos.json', JSON.stringify({ [VEHICLE]: 'gone.jpg' }));
    expect(vehiclePhoto(VEHICLE)).toBeNull();
  });

  it('cancelling the picker changes nothing', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true });
    await render(<CarPhotoScreen />);
    await fireEvent.press(screen.getByTestId('photo-pick'));
    await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(screen.getByTestId('art-car', { includeHiddenElements: true })).toBeTruthy();
    expect(mockDisk.has('file:///docs/vehicle-photos.json')).toBe(false);
  });
});
