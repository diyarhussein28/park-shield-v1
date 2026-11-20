import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AuthProvider } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { clearSession, getSession } from '@/lib/session';
import Callback from '@/app/auth/callback';
import SignIn from '@/app/anmelden';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `exp://192.168.178.25:8082/--/${path}`,
  useURL: () => null,
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));

type Route = (body: Record<string, unknown>) => { status?: number; body: unknown };
const calls: { path: string; body: Record<string, unknown> }[] = [];
function api(routes: Record<string, Route>) {
  calls.length = 0;
  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://api.test', '');
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ path, body });
    const r = routes[path]?.(body) ?? { body: {} };
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
}

/** Lets pending requests finish inside act (no overlapping act scopes between tests). */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

const show = (el: React.ReactElement) => render(<AuthProvider>{el}</AuthProvider>);

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = {};
  await clearSession();
});

describe('sign-in with the 6-digit code', () => {
  const ask = async () => {
    await show(<SignIn />);
    await fireEvent.changeText(screen.getByLabelText(t('email')), 'kim@example.de');
    await fireEvent.press(screen.getByLabelText(t('sendCode')));
    await screen.findByText(t('codeTitle'));
  };

  it('asks for the code right after the e-mail, with the app’s return address', async () => {
    api({ '/v1/auth/email/request': () => ({ status: 202, body: { ok: true } }) });
    await ask();
    expect(calls.find((c) => c.path === '/v1/auth/email/request')!.body).toEqual({
      email: 'kim@example.de',
      locale: 'de',
      redirectUri: 'exp://192.168.178.25:8082/--/auth/callback',
    });
  });

  it('the right code signs in and keeps the session in the Keychain', async () => {
    api({
      '/v1/auth/email/request': () => ({ status: 202, body: { ok: true } }),
      '/v1/auth/email/verify-code': () => ({
        body: { token: 'session-token-0000000000000000000009' },
      }),
    });
    await ask();
    await fireEvent.changeText(screen.getByLabelText(t('codeLabel')), '482913');
    await fireEvent.press(screen.getByLabelText(t('codeSubmit')));
    await settle();
    expect(await getSession()).toBe('session-token-0000000000000000000009');
    expect(calls.find((c) => c.path === '/v1/auth/email/verify-code')!.body).toMatchObject({
      email: 'kim@example.de',
      code: '482913',
    });
  });

  it('a wrong code says so; an expired one offers a new code', async () => {
    let answer: Route = () => ({ status: 400, body: { error: 'code_invalid' } });
    api({
      '/v1/auth/email/request': () => ({ status: 202, body: { ok: true } }),
      '/v1/auth/email/verify-code': (b) => answer(b),
    });
    await ask();
    await fireEvent.changeText(screen.getByLabelText(t('codeLabel')), '000000');
    await fireEvent.press(screen.getByLabelText(t('codeSubmit')));
    expect(await screen.findByText(t('codeInvalid'))).toBeTruthy();

    answer = () => ({ status: 400, body: { error: 'code_expired' } });
    await fireEvent.press(screen.getByLabelText(t('codeSubmit')));
    expect(await screen.findByText(t('codeExpired'))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t('codeNew')));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/v1/auth/email/request')).toHaveLength(2),
    );
  });

  it('„Code erneut senden“ waits 60 seconds', async () => {
    api({ '/v1/auth/email/request': () => ({ status: 202, body: { ok: true } }) });
    await ask();
    const resend = screen.getByLabelText(new RegExp(`^${t('codeResend')}`));
    expect(resend.props.accessibilityState.disabled).toBe(true);
  });
});

describe('the link from the bridge page (auth/callback)', () => {
  it('redeems the token once, even if the link arrives twice, then opens the app', async () => {
    api({
      '/v1/auth/email/verify-link': () => ({
        body: { token: 'session-token-0000000000000000000010' },
      }),
    });
    mockParams = { token: 'LinkToken_000000000000000000000000001' };
    // The same link arriving twice at once (cold start and the already running app).
    await show(
      <>
        <Callback />
        <Callback />
      </>,
    );
    await settle();
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(await getSession()).toBe('session-token-0000000000000000000010');
    expect(calls.filter((c) => c.path === '/v1/auth/email/verify-link')).toHaveLength(1);
  });

  it('a used or broken link explains itself and leads back to the code screen', async () => {
    api({
      '/v1/auth/email/verify-link': () => ({
        status: 401,
        body: { error: 'link_invalid_or_used' },
      }),
    });
    mockParams = { token: 'LinkToken_000000000000000000000000002' };
    await show(<Callback />);
    expect(await screen.findByText(t('linkInvalid'))).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t('signInTitle')));
    expect(mockReplace).toHaveBeenCalledWith('/anmelden');
  });
});
