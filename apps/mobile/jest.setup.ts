// Native modules are replaced by small in-memory fakes; fetch is mocked per test.

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 5 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => ({})),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: '1.0.0', extra: { apiUrl: 'https://api.test', firebase: false } },
  },
}));

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'de' }] }));

// react-native-svg draws natively; in tests its elements are plain host components with their props,
// so a test can find a logo path by its `d` or a fill colour.
jest.mock('react-native-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(name, props, children);
  const parts = [
    'Svg',
    'Path',
    'Rect',
    'Circle',
    'G',
    'Defs',
    'LinearGradient',
    'Stop',
    'Ellipse',
    'Line',
  ];
  return {
    __esModule: true,
    default: host('Svg'),
    ...Object.fromEntries(parts.map((p) => [p, host(p)])),
  };
});
