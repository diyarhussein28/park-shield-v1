import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import { useAuth } from './auth';

/** The sign-up data (GET/PUT /v1/me/profile). The phone is the verified SMS number, masked. */
export interface ProfileData {
  firstName: string;
  lastName: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface ProfileResponse {
  email: string;
  complete: boolean;
  profile: (ProfileData & { source: 'signup' | 'completed_later'; completedAt: string }) | null;
  phone: string | null;
}

interface ProfileState {
  /** undefined while loading (or signed out). */
  data: ProfileResponse | null | undefined;
  complete: boolean | undefined;
  reload: () => Promise<void>;
  save: (input: ProfileData) => Promise<ProfileResponse>;
}

const Ctx = createContext<ProfileState | null>(null);

/**
 * Whether the signed-in account has its name and address (owner decision 2026-11-20: every account
 * needs them; old accounts complete them on the first open after the update, blocking).
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useAuth();
  const [data, setData] = useState<ProfileResponse | null | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      setData(await api<ProfileResponse>('/v1/me/profile'));
    } catch {
      // Offline: do not block the app (alerts must stay reachable); retried on the next load.
      setData(null);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setData(undefined);
      return;
    }
    void reload();
  }, [signedIn, reload]);

  const save = useCallback(async (input: ProfileData) => {
    const r = await api<ProfileResponse>('/v1/me/profile', { method: 'PUT', body: input });
    setData(r);
    return r;
  }, []);

  const value = useMemo(
    () => ({
      data,
      complete: data === undefined ? undefined : (data?.complete ?? true),
      reload,
      save,
    }),
    [data, reload, save],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProfile(): ProfileState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProfile outside ProfileProvider');
  return v;
}
