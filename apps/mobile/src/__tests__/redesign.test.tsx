import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppState, Text } from 'react-native';
import { ago } from '@/lib/ago';
import { t } from '@/lib/i18n';
import { allowedWhileLocked, LockProvider, shouldLock, useLock } from '@/lib/lock';
import { pt } from '@/lib/portal-i18n';
import { getFlag, setFlag } from '@/lib/prefs';
import type { PortalVehicle, Protection } from '@/lib/portal';
import { setupSteps, setupSummary } from '@/lib/setup';
import { asciiDigits } from '@/lib/text';
import { gateTarget } from '@/app/_layout';
import ProfileScreen from '@/app/profil';
import Welcome from '@/app/willkommen';

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};
let mockSignedIn: boolean | undefined = true;
const mockSave = jest.fn();
const mockReload = jest.fn(async () => undefined);
let mockProfileData: Record<string, unknown> = { complete: false, profile: null, phone: null };

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: mockBack }),
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signedIn: mockSignedIn }) }));
jest.mock('@/lib/profile', () => ({
  useProfile: () => ({ data: mockProfileData, save: mockSave, reload: mockReload }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSignedIn = true;
  mockProfileData = { complete: false, profile: null, phone: null };
  global.fetch = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith('/v1/channels/phone')
        ? { phone: '+49 ••• 4567', via: 'sms' }
        : url.endsWith('/v1/channels/phone/verify')
          ? { ok: true }
          : { lockAfterSeconds: 300 },
  })) as unknown as typeof fetch;
});

describe('app lock: timer', () => {
  it('locks only after app.lock_after_seconds in the background', () => {
    const left = 1_000_000;
    expect(shouldLock(null, left + 999_999, 300)).toBe(false); // never in the background
    expect(shouldLock(left, left + 299_000, 300)).toBe(false); // back after 4:59
    expect(shouldLock(left, left + 300_000, 300)).toBe(true); // 5 minutes
    expect(shouldLock(left, left + 1_000, 0)).toBe(true); // 0 = every time
  });
});

describe('app lock: the alert exception', () => {
  const A = 'alert-1';
  it('only the alert opened from its notification (and its chat) shows while locked', () => {
    expect(allowedWhileLocked(`/alerts/${A}`, A)).toBe(true);
    expect(allowedWhileLocked(`/chat/${A}`, A)).toBe(true);
    expect(allowedWhileLocked(`/app/alerts/${A}`, A)).toBe(true);
    expect(allowedWhileLocked('/alerts/other', A)).toBe(false);
    expect(allowedWhileLocked('/', A)).toBe(false);
    expect(allowedWhileLocked('/fahrzeuge', A)).toBe(false);
    expect(allowedWhileLocked(`/alerts/${A}`, null)).toBe(false);
  });
});

describe('app lock: provider', () => {
  function Probe() {
    const l = useLock();
    return (
      <>
        <Text testID="state">{`${l.locked}|${l.enabled}`}</Text>
        <Text testID="unlock" onPress={() => void l.unlock()}>
          unlock
        </Text>
      </>
    );
  }

  it('a cold start with a stored session and the lock on starts locked; Face ID opens it', async () => {
    await setFlag('lockEnabled', true);
    await render(
      <LockProvider>
        <Probe />
      </LockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('state').props.children).toBe('true|true'));
    await fireEvent.press(screen.getByTestId('unlock'));
    await waitFor(() => expect(screen.getByTestId('state').props.children).toBe('false|true'));
    // The device code is the fallback (owner decision): never disabled.
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
    await setFlag('lockEnabled', false);
  });

  it('back from the background: under the timeout open, after it locked', async () => {
    await setFlag('lockEnabled', true);
    const listeners: ((s: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, cb) => {
      listeners.push(cb as (s: string) => void);
      return {
        remove: () => listeners.splice(listeners.indexOf(cb as (s: string) => void), 1),
      } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    let clock = 10_000_000;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    const emit = (state: string) =>
      act(async () => {
        [...listeners].forEach((l) => l(state));
      });
    try {
      await render(
        <LockProvider>
          <Probe />
        </LockProvider>,
      );
      await waitFor(() => expect(screen.getByTestId('state').props.children).toBe('true|true'));
      await fireEvent.press(screen.getByTestId('unlock'));
      await waitFor(() => expect(screen.getByTestId('state').props.children).toBe('false|true'));

      await emit('background');
      clock += 60_000; // back after one minute: still open
      await emit('active');
      expect(screen.getByTestId('state').props.children).toBe('false|true');

      await emit('background');
      clock += 301_000; // back after more than 5 minutes: locked
      await emit('active');
      expect(screen.getByTestId('state').props.children).toBe('true|true');
    } finally {
      spy.mockRestore();
      now.mockRestore();
      await setFlag('lockEnabled', false);
    }
  });
});

describe('routing gate', () => {
  const base = {
    signedIn: true,
    first: '(tabs)',
    onboarded: true,
    profileComplete: true,
    lockEnabled: true,
  };
  it('first launch → onboarding; later → sign-in', () => {
    expect(gateTarget({ ...base, signedIn: false, onboarded: false })).toBe('/willkommen');
    expect(gateTarget({ ...base, signedIn: false })).toBe('/anmelden');
    expect(gateTarget({ ...base, signedIn: false, first: 'registrieren' })).toBeNull();
  });
  it('a new sign-up continues with its profile steps; an old account must complete it first', () => {
    expect(gateTarget({ ...base, profileComplete: false, first: 'registrieren' })).toEqual({
      pathname: '/profil',
      params: { flow: 'signup' },
    });
    expect(gateTarget({ ...base, profileComplete: false })).toEqual({
      pathname: '/profil',
      params: { flow: 'complete' },
    });
    // Reopened mid sign-up (app killed): still the sign-up steps, from the API's newAccount.
    expect(gateTarget({ ...base, profileComplete: false, newAccount: true })).toEqual({
      pathname: '/profil',
      params: { flow: 'signup' },
    });
    // Alerts are never blocked by the profile.
    expect(gateTarget({ ...base, profileComplete: false, first: 'alerts' })).toBeNull();
  });
  it('a verified mobile number is required: without it the account must be completed', () => {
    const noPhone = { ...base, phoneVerified: false };
    expect(gateTarget(noPhone)).toEqual({ pathname: '/profil', params: { flow: 'complete' } });
    expect(gateTarget({ ...noPhone, first: 'tarif' })).toEqual({
      pathname: '/profil',
      params: { flow: 'complete' },
    });
    expect(gateTarget({ ...noPhone, newAccount: true })).toEqual({
      pathname: '/profil',
      params: { flow: 'signup' },
    });
    // Never blocked: alerts, their detail and chat, and the phone step itself.
    for (const first of ['alerts', 'chat', 'app', 'profil']) {
      expect(gateTarget({ ...noPhone, first })).toBeNull();
    }
    // Signed in without a number: not past the sign-in screen to Start.
    expect(gateTarget({ ...noPhone, first: 'anmelden' })).toEqual({
      pathname: '/profil',
      params: { flow: 'complete' },
    });
    // Unknown (offline, older server): never blocks.
    expect(gateTarget({ ...base, phoneVerified: undefined })).toBeNull();
    expect(gateTarget({ ...base, phoneVerified: true })).toBeNull();
  });
  it('after signing in: the Face ID offer while the lock is off, else Start', () => {
    expect(gateTarget({ ...base, first: 'anmelden', lockEnabled: false })).toEqual({
      pathname: '/app-sperre',
      params: { next: 'home' },
    });
    expect(gateTarget({ ...base, first: 'anmelden' })).toBe('/');
    expect(gateTarget({ ...base, profileComplete: undefined })).toBeNull();
  });
});

describe('onboarding', () => {
  it('three scenes with dots, skippable, then „Los geht’s“ or „Ich habe schon ein Konto“', async () => {
    await render(<Welcome />);
    expect(screen.getByText(t('ob1Title'))).toBeTruthy();
    expect(screen.queryByText(t('ob2Title'))).toBeNull(); // other pages hidden from VoiceOver
    expect(screen.getByLabelText(t('obPage', { n: 1 }))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ob-next'));
    expect(screen.getByLabelText(t('obPage', { n: 2 }))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t('obSkip')));
    expect(screen.getByLabelText(t('obPage', { n: 3 }))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ob-start'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/registrieren'));
    expect(await getFlag('onboarded')).toBe(true);
  });
});

describe('sign-up profile steps', () => {
  it('asks for name, then address (German postcode = 5 digits), saves, then the required phone', async () => {
    mockParams = { flow: 'signup' };
    mockSave.mockResolvedValue({ complete: true, phoneVerified: false });
    await render(<ProfileScreen />);
    expect(screen.getByLabelText(t('signUpStep', { step: 2, total: 5 }))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('name-next'));
    expect(screen.getAllByText(pt('profile.required'))).toHaveLength(2);

    await fireEvent.changeText(screen.getByLabelText(pt('profile.firstName')), 'Erika');
    await fireEvent.changeText(screen.getByLabelText(pt('profile.lastName')), 'Mustermann');
    await fireEvent.press(screen.getByTestId('name-next'));
    expect(screen.getByLabelText(t('signUpStep', { step: 3, total: 5 }))).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText(pt('profile.street')), 'Musterstraße 12');
    await fireEvent.changeText(screen.getByLabelText(pt('profile.postalCode')), '٥٠٦٦'); // Arabic digits
    await fireEvent.changeText(screen.getByLabelText(pt('profile.city')), 'Köln');
    await fireEvent.press(screen.getByTestId('address-next'));
    expect(screen.getByText(pt('profile.postalCodeInvalid'))).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText(pt('profile.postalCode')), '50667');
    await fireEvent.press(screen.getByTestId('address-next'));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        firstName: 'Erika',
        lastName: 'Mustermann',
        street: 'Musterstraße 12',
        postalCode: '50667',
        city: 'Köln',
        country: 'DE',
      }),
    );
    expect(await screen.findByText(t('phoneTitle'))).toBeTruthy();
    expect(screen.getByLabelText(t('signUpStep', { step: 4, total: 5 }))).toBeTruthy();
    // Required: no „Überspringen“; the privacy note names the purpose.
    expect(screen.queryByTestId('phone-skip')).toBeNull();
    expect(screen.queryByText(t('skip'))).toBeNull();
    expect(screen.getByText(t('phonePrivacy'))).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('phone'), '+49 170 1234567');
    await fireEvent.press(screen.getByTestId('phone-send'));
    expect(await screen.findByText(t('phoneCodeSent', { phone: '+49 ••• 4567' }))).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(t('signUpPhoneCode')), '123456');
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/app-sperre',
        params: { next: 'tarif' },
      }),
    );
    // The gate must know about the number before the next screen.
    expect(mockReload).toHaveBeenCalled();
    const bodies = (global.fetch as jest.Mock).mock.calls
      .filter(([u]: [string]) => u.includes('/v1/channels/phone'))
      .map(([u, i]: [string, RequestInit]) => [
        u.replace('https://api.test', ''),
        JSON.parse(String(i.body)),
      ]);
    expect(bodies).toEqual([
      ['/v1/channels/phone', { phone: '+49 170 1234567', channels: ['sms'], consent: true }],
      ['/v1/channels/phone/verify', { code: '123456' }],
    ]);
  });

  it('phone errors in plain words: not a mobile number, wrong country, wrong code', async () => {
    mockParams = {};
    mockProfileData = {
      complete: true,
      phoneVerified: false,
      phone: null,
      profile: {
        firstName: 'Erika',
        lastName: 'Mustermann',
        street: 'Musterstraße 12',
        postalCode: '50667',
        city: 'Köln',
        country: 'DE',
        source: 'signup',
        completedAt: '',
      },
    };
    const answers: [number, unknown][] = [
      [400, { error: 'phone_not_mobile' }],
      [400, { error: 'phone_country' }],
      [200, { phone: '+49 ••• 4567' }],
      [400, { error: 'code_wrong', attemptsLeft: 2 }],
    ];
    global.fetch = jest.fn(async () => {
      const [status, body] = answers.shift()!;
      return { ok: status < 300, status, json: async () => body };
    }) as unknown as typeof fetch;
    await render(<ProfileScreen />);
    await fireEvent.changeText(await screen.findByTestId('phone'), '030 1234567');
    await fireEvent.press(screen.getByTestId('phone-send'));
    expect(await screen.findByText(t('phoneNotMobile'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('phone-send'));
    expect(await screen.findByText(t('phoneCountry'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('phone-send'));
    await fireEvent.changeText(await screen.findByLabelText(t('signUpPhoneCode')), '000000');
    expect(await screen.findByText(t('phoneCodeWrong', { left: 2 }))).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('an old account with name and address but no number sees only the blocking phone step', async () => {
    mockParams = { flow: 'complete' };
    mockProfileData = {
      complete: true,
      phoneVerified: false,
      phone: null,
      profile: {
        firstName: 'Erika',
        lastName: 'Mustermann',
        street: 'Musterstraße 12',
        postalCode: '50667',
        city: 'Köln',
        country: 'DE',
        source: 'signup',
        completedAt: '',
      },
    };
    await render(<ProfileScreen />);
    expect(await screen.findByText(t('phoneCompleteIntro'))).toBeTruthy();
    expect(screen.queryByLabelText(pt('profile.firstName'))).toBeNull();
    expect(screen.queryByTestId('phone-skip')).toBeNull();
  });

  it('an old account sees „Konto vervollständigen“ and cannot go back', async () => {
    mockParams = {};
    await render(<ProfileScreen />);
    expect(screen.getByText(pt('profile.completeIntro'))).toBeTruthy();
    expect(screen.getByLabelText(t('signUpStep', { step: 1, total: 3 }))).toBeTruthy();
  });
});

describe('helpers', () => {
  it('converts Arabic-Indic and Persian digits', () => {
    expect(asciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(asciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(asciiDigits('K-AB 12')).toBe('K-AB 12');
  });

  it('relative times for the alert cards', () => {
    const now = Date.parse('2026-11-20T12:00:00Z');
    expect(ago('2026-11-20T11:59:40Z', now)).toBe(t('agoNow'));
    expect(ago('2026-11-20T11:58:00Z', now)).toBe('vor 2 Min.');
    expect(ago('2026-11-20T09:00:00Z', now)).toBe('vor 3 Std.');
    expect(ago('2026-11-18T12:00:00Z', now)).toBe('vor 2 Tagen');
  });

  it('counts set-up steps the same way everywhere: app, verified number, tested decal', () => {
    const protection: Protection = {
      percent: 75,
      steps: { email: true, channel: true, phone: false, decal: false },
    };
    const v = { id: 'v1', nickname: 'Blue' } as PortalVehicle;
    const sum = setupSummary(setupSteps(protection, [v]));
    expect(sum).toMatchObject({ done: 2, total: 4, left: 2, complete: false });
    expect(sum.next?.key).toBe('phone');
    expect(sum.next?.href).toBe('/benachrichtigungen');
    const phone = { ...protection, steps: { ...protection.steps, phone: true } };
    expect(setupSummary(setupSteps(phone, [v])).next?.key).toBe('decal');
    const done = setupSummary(
      setupSteps({ ...protection, steps: { ...protection.steps, phone: true, decal: true } }, [v]),
    );
    expect(done).toMatchObject({ left: 0, complete: true });
  });
});
