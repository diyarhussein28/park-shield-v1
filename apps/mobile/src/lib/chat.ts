import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from './config';
import { getSession } from './session';
import type { ChatMessage, ChatState } from './types';

export type ChatError =
  'filtered' | 'limit_reached' | 'too_long' | 'chat_not_active' | 'rate_limited' | 'failed';

interface Live {
  state: ChatState | null;
  messages: ChatMessage[];
  typing: boolean;
  connected: boolean;
  /** The last reason the connection failed (Socket.io connect_error), until it connects. */
  connectError: string | null;
  error: ChatError | null;
  readAt: string | null;
}

/**
 * The owner's side of the live chat (Socket.io namespace /chat, path /v1/socket.io). The session goes
 * in the handshake's auth payload, never in the URL. Reconnects when the app comes back to the
 * foreground; the server stays the source of truth (state is re-sent on every connect).
 */
export function useChat(alertId: string, enabled: boolean) {
  const [live, setLive] = useState<Live>({
    state: null,
    messages: [],
    typing: false,
    connected: false,
    connectError: null,
    error: null,
    readAt: null,
  });
  const socket = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let s: Socket | null = null;
    void (async () => {
      const session = await getSession();
      if (cancelled || !session) return;
      s = io(`${API_URL}/chat`, {
        path: '/v1/socket.io',
        addTrailingSlash: false,
        auth: { role: 'owner', alertId, session },
        // WebSocket first; if it does not come up on this network or device, long polling over plain
        // HTTPS (the session stays in the handshake payload either way, never in the URL).
        transports: ['websocket', 'polling'],
        tryAllTransports: true,
        reconnection: true,
        reconnectionDelayMax: 10_000,
      });
      socket.current = s;
      s.on('connect', () => setLive((l) => ({ ...l, connected: true, connectError: null })));
      // Shown next to „Keine Verbindung“, so a screenshot says why (e.g. unauthorized, timeout).
      s.on('connect_error', (e: Error) =>
        setLive((l) => ({ ...l, connectError: e.message || 'error' })),
      );
      s.on('disconnect', () => setLive((l) => ({ ...l, connected: false })));
      s.on('chat:state', (st: ChatState) =>
        setLive((l) => ({ ...l, state: st, messages: st.messages, readAt: st.readByOther })),
      );
      s.on('chat:message', (m: ChatMessage) =>
        setLive((l) =>
          l.messages.some((x) => x.id === m.id)
            ? l
            : {
                ...l,
                messages: [...l.messages, m],
                typing: m.from === 'scanner' ? false : l.typing,
              },
        ),
      );
      s.on('chat:typing', (x: { from: string; typing: boolean }) => {
        if (x.from === 'scanner') setLive((l) => ({ ...l, typing: x.typing }));
      });
      s.on('chat:seen', (x: { by: string; at: string }) => {
        if (x.by === 'scanner') setLive((l) => ({ ...l, readAt: x.at }));
      });
      s.on('chat:presence', (p: { online: boolean; lastSeenAt: string }) =>
        setLive((l) =>
          l.state
            ? {
                ...l,
                state: { ...l.state, scanner: { online: p.online, lastSeenAt: p.lastSeenAt } },
              }
            : l,
        ),
      );
      s.on('chat:opened', () =>
        setLive((l) => (l.state ? { ...l, state: { ...l.state, status: 'active' } } : l)),
      );
      s.on('chat:closed', () =>
        setLive((l) => (l.state ? { ...l, state: { ...l.state, status: 'closed' } } : l)),
      );
      s.on('chat:error', (e: { error: ChatError }) => setLive((l) => ({ ...l, error: e.error })));
    })();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' && socket.current && !socket.current.connected) socket.current.connect();
    });
    return () => {
      cancelled = true;
      sub.remove();
      s?.disconnect();
      socket.current = null;
    };
  }, [alertId, enabled]);

  const send = useCallback(
    (text: string) =>
      new Promise<{ ok: boolean; error?: ChatError }>((resolve) => {
        const s = socket.current;
        if (!s?.connected) return resolve({ ok: false, error: 'failed' });
        setLive((l) => ({ ...l, error: null }));
        s.timeout(10_000).emit(
          'chat:message',
          { text },
          (err: Error | null, r?: { ok: boolean; error?: ChatError }) =>
            resolve(err ? { ok: false, error: 'failed' } : (r ?? { ok: false, error: 'failed' })),
        );
      }),
    [],
  );
  const setTyping = useCallback(
    (on: boolean) => socket.current?.emit('chat:typing', { typing: on }),
    [],
  );
  const seen = useCallback(() => socket.current?.emit('chat:seen'), []);

  return { ...live, send, setTyping, seen };
}

/** "zuletzt vor X Min." */
export function minutesSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}
