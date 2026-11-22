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

/** Fallback for an older server without `unseenCount`: unopened alerts of the loaded page. */
export const unseenOf = (alerts: AlertListItem[]): number =>
  alerts.filter((a) => !a.seenAt && !a.acknowledged && !a.resolved).length;

/** Open = the owner has not answered „Ich komme“ and it has not expired (seen alone is still open). */
export const openAlertCount = (alerts: AlertListItem[]): number =>
  alerts.filter((a) => !a.acknowledged && a.status !== 'expired').length;

interface AlertsState {
  data: AlertList | null;
  error: boolean;
  reload: () => Promise<void>;
  open: number;
  /**
   * The badge (2026-11-22): alerts not opened yet, from the server. 0 hides the tab badge and the
   * app icon badge.
   */
  unseen: number;
  /** Opening an alert: the badge goes down at once, then the server's count is taken. */
  markSeen: (alertId: string, serverCount?: number) => void;
  /**
   * After „Absender blockieren“ / „Blockierung aufheben“: shows the new state on that card at once
   * (optimistic), then reloads, because only the server knows which other alerts share the sender
   * (`senderBlocked` per alert). `version` goes up so other views (history, detail) reload too.
   */
  senderChanged: (alertId: string, blocked: boolean, until?: string | null) => Promise<void>;
  version: number;
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
  const [version, setVersion] = useState(0);

  const markSeen = useCallback((alertId: string, serverCount?: number) => {
    setData((d) => {
      if (!d) return d;
      const hit = d.alerts.find((a) => a.id === alertId);
      const wasUnseen = Boolean(hit && !hit.seenAt && !hit.acknowledged && !hit.resolved);
      const before = d.unseenCount ?? unseenOf(d.alerts);
      return {
        ...d,
        alerts: d.alerts.map((a) =>
          a.id === alertId && !a.seenAt ? { ...a, seenAt: new Date().toISOString() } : a,
        ),
        unseenCount: serverCount ?? Math.max(0, before - (wasUnseen ? 1 : 0)),
      };
    });
  }, []);

  const reload = useCallback(async () => {
    try {
      setData(await api<AlertList>('/v1/app/alerts'));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  const senderChanged = useCallback(
    async (alertId: string, blocked: boolean, until: string | null = null) => {
      setData((d) =>
        d
          ? {
              ...d,
              alerts: d.alerts.map((a) =>
                a.id === alertId ? { ...a, senderBlocked: blocked, blockedUntil: until } : a,
              ),
            }
          : d,
      );
      await reload();
      setVersion((v) => v + 1);
    },
    [reload],
  );

  useEffect(() => {
    if (!signedIn) {
      setData(null);
      setError(false);
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

  const unseen = data ? (data.unseenCount ?? unseenOf(data.alerts)) : 0;
  // The phone's app icon shows the same number; 0 removes it (also after sign-out).
  useEffect(() => {
    void Notifications.setBadgeCountAsync(signedIn ? unseen : 0).catch(() => false);
  }, [unseen, signedIn]);

  const value = useMemo(
    () => ({
      data,
      error,
      reload,
      open: data ? openAlertCount(data.alerts) : 0,
      unseen,
      markSeen,
      senderChanged,
      version,
    }),
    [data, error, reload, unseen, markSeen, senderChanged, version],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAlerts(): AlertsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAlerts outside AlertsProvider');
  return v;
}

const NO_SYNC = { senderChanged: async () => undefined, version: 0, markSeen: () => undefined };

/**
 * Block / unblock sync for screens that may render outside the tabs (a detail opened from a
 * notification, tests): the shared store when there is one, else a no-op.
 */
export function useAlertSync(): Pick<AlertsState, 'senderChanged' | 'version' | 'markSeen'> {
  return useContext(Ctx) ?? NO_SYNC;
}
