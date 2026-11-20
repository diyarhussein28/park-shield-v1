import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { api, setUnauthorizedHandler } from './api';
import { lang } from './i18n';
import { registerDevice, unregisterDevice } from './push';
import { clearSession, getSession, setSession } from './session';

interface Auth {
  /** undefined while the Keychain/Keystore is read. */
  signedIn: boolean | undefined;
  /** Sends the sign-in e-mail (6-digit code + link to the bridge page) with the app's return address. */
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  /** Redeems a link token from the bridge page (auth/callback); the same token only once. */
  consumeLink: (token: string) => Promise<void>;
  /** Legacy links of older e-mails (/app/anmelden#t=…). */
  consume: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

const PLATFORM = Platform.OS === 'ios' ? 'ios' : 'android';
/**
 * Link tokens redeemed in this app run (memory only). A token that arrives again gets the first
 * attempt's outcome, success or failure, instead of a second request.
 */
const redeemed = new Map<string, Promise<void>>();

/** The one-time token from a sign-in link (fragment `#t=…` of /app/anmelden or parkshield://anmelden). */
export function tokenFromLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /[#?&]t=([A-Za-z0-9_-]{20,100})(?:&|$)/.exec(url);
  return m?.[1] ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void getSession().then((s) => setSignedIn(Boolean(s)));
    setUnauthorizedHandler(() => {
      void clearSession().then(() => setSignedIn(false));
    });
  }, []);

  const start = useCallback(async (token: string) => {
    await setSession(token);
    setSignedIn(true);
    await registerDevice().catch(() => false);
  }, []);

  const requestCode = useCallback(async (email: string) => {
    await api('/v1/auth/email/request', {
      body: {
        email: email.trim(),
        locale: lang(),
        redirectUri: Linking.createURL('auth/callback'),
      },
      auth: false,
    });
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      const r = await api<{ token: string }>('/v1/auth/email/verify-code', {
        body: { email: email.trim(), code, platform: PLATFORM },
        auth: false,
      });
      await start(r.token);
    },
    [start],
  );

  const consumeLink = useCallback(
    async (token: string) => {
      // A link can arrive twice (cold start and the running app, or a double tap): redeem it once.
      let attempt = redeemed.get(token);
      if (!attempt) {
        attempt = api<{ token: string }>('/v1/auth/email/verify-link', {
          body: { token, platform: PLATFORM },
          auth: false,
        }).then((r) => start(r.token));
        redeemed.set(token, attempt);
      }
      return attempt;
    },
    [start],
  );

  const consume = useCallback(
    async (token: string) => {
      const r = await api<{ token: string }>('/v1/app/auth/consume', {
        body: { token, platform: PLATFORM },
        auth: false,
      });
      await start(r.token);
    },
    [start],
  );

  const signOut = useCallback(async () => {
    await unregisterDevice();
    await api('/v1/auth/logout', { body: {} }).catch(() => undefined);
    await clearSession();
    setSignedIn(false);
  }, []);

  const value = useMemo(
    () => ({ signedIn, requestCode, verifyCode, consumeLink, consume, signOut }),
    [signedIn, requestCode, verifyCode, consumeLink, consume, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const a = useContext(Ctx);
  if (!a) throw new Error('useAuth outside AuthProvider');
  return a;
}
