'use client';

import { createContext, use, type ReactNode } from 'react';

/** Whether the signed-in owner has a live subscription (loaded once in /konto/layout). */
const SubscribedContext = createContext<boolean | null>(null);

export function KontoAccessProvider({
  subscribed,
  children,
}: {
  subscribed: boolean | null;
  children: ReactNode;
}) {
  return <SubscribedContext value={subscribed}>{children}</SubscribedContext>;
}

/** null: unknown (not signed in, or the API did not answer): nothing is locked then. */
export const useSubscribed = () => use(SubscribedContext);

/** Portal sections that only make sense with a subscription: vehicles, phone, contacts, history. */
export const LOCKED_SECTIONS = [
  '/konto/fahrzeuge',
  '/konto/benachrichtigungen',
  '/konto/notfallkontakte',
  '/konto/verlauf',
  '/konto/zustellung',
];

export const isLockedSection = (path: string) =>
  LOCKED_SECTIONS.some((s) => path === s || path.startsWith(`${s}/`));
