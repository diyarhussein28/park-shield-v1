import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { useAuth } from './auth';
import { unlock as authenticate } from './biometrics';
import { getFlag, setFlag } from './prefs';

/** Default of the setting `app.lock_after_seconds`; the API's value replaces it after sign-in. */
export const LOCK_AFTER_SECONDS_DEFAULT = 300;

/**
 * Lock again after a time in the background (owner decision 2026-11-20: 5 minutes, from
 * `app.lock_after_seconds`). Coming back sooner keeps the app open.
 */
export function shouldLock(backgroundAt: number | null, now: number, afterSeconds: number) {
  if (backgroundAt === null) return false;
  return now - backgroundAt >= Math.max(0, afterSeconds) * 1000;
}

/**
 * The one exception to the lock: an alert opened from its notification shows at once, with its chat,
 * so the owner can answer „Ich komme“ immediately. Every other screen asks for Face ID first.
 */
export function allowedWhileLocked(pathname: string, pass: string | null): boolean {
  if (!pass) return false;
  return [`/alerts/${pass}`, `/chat/${pass}`, `/app/alerts/${pass}`].includes(pathname);
}

interface LockState {
  enabled: boolean | undefined;
  locked: boolean;
  /** The alert opened from a notification while locked. */
  pass: string | null;
  lockAfterSeconds: number;
  /** Face ID / fingerprint / device code; true when the app is open again. */
  unlock: () => Promise<boolean>;
  /** Switching on asks for Face ID once, so nobody locks themselves out by accident. */
  setEnabled: (on: boolean) => Promise<boolean>;
  allowAlert: (alertId: string) => void;
}

const Ctx = createContext<LockState | null>(null);

export function LockProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useAuth();
  const [enabled, setEnabledState] = useState<boolean | undefined>(undefined);
  const [locked, setLocked] = useState(false);
  const [pass, setPass] = useState<string | null>(null);
  const [lockAfterSeconds, setAfter] = useState(LOCK_AFTER_SECONDS_DEFAULT);
  const backgroundAt = useRef<number | null>(null);
  const started = useRef(false);

  // Cold start with a stored session: locked until Face ID (when the owner switched the lock on).
  useEffect(() => {
    if (signedIn === undefined) return;
    void getFlag('lockEnabled').then((on) => {
      setEnabledState(on);
      if (!started.current) {
        started.current = true;
        if (signedIn && on) setLocked(true);
      }
    });
    if (!signedIn) {
      setLocked(false);
      setPass(null);
      return;
    }
    void api<{ lockAfterSeconds: number }>('/v1/app/config')
      .then((c) => setAfter(c.lockAfterSeconds))
      .catch(() => undefined);
  }, [signedIn]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active') {
        if (enabled && signedIn && shouldLock(backgroundAt.current, Date.now(), lockAfterSeconds)) {
          setLocked(true);
          setPass(null);
        }
        backgroundAt.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled, signedIn, lockAfterSeconds]);

  const unlock = useCallback(async () => {
    const ok = await authenticate();
    if (ok) {
      setLocked(false);
      setPass(null);
    }
    return ok;
  }, []);

  const setEnabled = useCallback(async (on: boolean) => {
    if (on && !(await authenticate())) return false;
    await setFlag('lockEnabled', on);
    setEnabledState(on);
    return true;
  }, []);

  const allowAlert = useCallback((alertId: string) => setPass(alertId), []);

  const value = useMemo(
    () => ({ enabled, locked, pass, lockAfterSeconds, unlock, setEnabled, allowAlert }),
    [enabled, locked, pass, lockAfterSeconds, unlock, setEnabled, allowAlert],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLock(): LockState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLock outside LockProvider');
  return v;
}
