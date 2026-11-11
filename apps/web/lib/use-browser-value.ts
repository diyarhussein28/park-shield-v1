'use client';

import { useEffect, useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

/**
 * Reads a browser-only value (cookie presence, WebAuthn support, URL parameters) without a hydration
 * mismatch: the server render and first client render use `serverValue`, then React switches to the real one.
 */
export function useBrowserValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverValue);
}

const captured = new Map<string, string | null>();

/**
 * One-time secret from the URL fragment (`#t=…`). The fragment is never sent to a server; after reading
 * it we remove it from the address bar and history so it cannot leak through screenshots or shared URLs.
 */
export function useFragmentSecret(name: string): string | null | undefined {
  const value = useBrowserValue<string | null | undefined>(() => {
    if (!captured.has(name))
      captured.set(name, new URLSearchParams(window.location.hash.slice(1)).get(name));
    return captured.get(name);
  }, undefined);

  // The capture lives until the next full page load (links from e-mails always open one), so it survives
  // StrictMode's double effect run after the fragment has already been removed.
  useEffect(() => {
    if (value) history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [value]);

  return value;
}
