'use client';

import { useMemo } from 'react';
import { useBrowserValue } from './use-browser-value';

const KEY = 'ps_pending_claim';
const MAX_AGE_MS = 7 * 86_400_000;

/** A pre-printed partner decal (AD-07) waiting to be set up after sign-in and payment. */
export interface PendingClaim {
  code: string;
  partner: string | null;
  promoCode: string | null;
  at: number;
}

export function savePendingClaim(c: Omit<PendingClaim, 'at'>) {
  localStorage.setItem(KEY, JSON.stringify({ ...c, at: Date.now() }));
}

export function clearPendingClaim() {
  localStorage.removeItem(KEY);
}

/** The sign-in link may open in another tab, so this lives in localStorage, not sessionStorage. */
export function usePendingClaim(): PendingClaim | null {
  const raw = useBrowserValue(() => localStorage.getItem(KEY), null);
  return useMemo(() => {
    try {
      const c = raw ? (JSON.parse(raw) as PendingClaim) : null;
      return c && Date.now() - c.at < MAX_AGE_MS ? c : null;
    } catch {
      return null;
    }
  }, [raw]);
}
