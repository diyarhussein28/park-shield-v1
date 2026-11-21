import * as Notifications from 'expo-notifications';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { useAuth } from './auth';
import type { AlertList, AlertListItem } from './types';

/** Open = the owner has not answered „Ich komme“ and it has not expired (seen alone is still open). */
export const openAlertCount = (alerts: AlertListItem[]): number =>
  alerts.filter((a) => !a.acknowledged && a.status !== 'expired').length;

interface AlertsState {
  data: AlertList | null;
  error: boolean;
  reload: () => Promise<void>;
  open: number;
  /**
   * Alerts whose sender was blocked in this session (the list has no flag for it), so their cards
   * stop offering „Absender blockieren“. Memory only; cleared on sign-out.
   */
  blocked: ReadonlySet<string>;
  markBlocked: (alertId: string) => void;
}

const Ctx = createContext<AlertsState | null>(null);

/**
 * The alert list, shared by the Warnungen tab (the feed) and the tab bar (the badge). It loads by
 * itself while signed in, again when the app comes back to the foreground or a push arrives, and is
 * cleared at once on sign-out, so the next account never sees the previous owner's alerts.
 */
export function AlertsProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useAuth();
  const [data, setData] = useState<AlertList | null>(null);
  const [error, setError] = useState(false);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
  const markBlocked = useCallback((id: string) => setBlocked((b) => new Set([...b, id])), []);

  const reload = useCallback(async () => {
    try {
      setData(await api<AlertList>('/v1/app/alerts'));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      setData(null);
      setError(false);
      setBlocked(new Set());
      return;
    }
    void reload();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    const push = Notifications.addNotificationReceivedListener(() => void reload());
    return () => {
      app.remove();
      push.remove();
    };
  }, [signedIn, reload]);

  const value = useMemo(
    () => ({
      data,
      error,
      reload,
      open: data ? openAlertCount(data.alerts) : 0,
      blocked,
      markBlocked,
    }),
    [data, error, reload, blocked, markBlocked],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAlerts(): AlertsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAlerts outside AlertsProvider');
  return v;
}
