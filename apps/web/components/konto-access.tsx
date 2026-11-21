'use client';

import { createContext, use, type ReactNode } from 'react';

interface Access {
  /** Whether the signed-in owner has a live subscription; null: unknown (nothing is locked then). */
  subscribed: boolean | null;
  /** Whether the required mobile number is verified; null: unknown. */
  phoneVerified: boolean | null;
}

/** Loaded once in /konto/layout. */
const AccessContext = createContext<Access>({ subscribed: null, phoneVerified: null });

export function KontoAccessProvider({
  subscribed,
  phoneVerified = null,
  children,
}: {
  subscribed: boolean | null;
  phoneVerified?: boolean | null;
  children: ReactNode;
}) {
  return <AccessContext value={{ subscribed, phoneVerified }}>{children}</AccessContext>;
}

/** null: unknown (not signed in, or the API did not answer): nothing is locked then. */
export const useSubscribed = () => use(AccessContext).subscribed;

/**
 * Accounts from before 2026-11-21 may have no verified mobile number: they must complete the account
 * („Konto vervollständigen“ on /konto). Alerts and their history are never blocked.
 */
export const useNeedsPhone = () => {
  const { subscribed, phoneVerified } = use(AccessContext);
  return subscribed === true && phoneVerified === false;
};

/** Portal sections that only make sense with a subscription: vehicles, notifications, history. */
export const LOCKED_SECTIONS = [
  '/konto/fahrzeuge',
  '/konto/benachrichtigungen',
  '/konto/verlauf',
  '/konto/zustellung',
];

export const isLockedSection = (path: string) =>
  LOCKED_SECTIONS.some((s) => path === s || path.startsWith(`${s}/`));
