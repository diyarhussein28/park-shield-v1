import type { ReactNode } from 'react';
import { KontoAccessProvider } from '@/components/konto-access';
import { serverApi, type SubscriptionSummary } from '@/lib/api-server';

/**
 * Loads the subscription once for every /konto page, so the menu and the sections that need a
 * subscription (vehicles, phone, contacts, history) can stay closed until the payment has arrived.
 */
export default async function KontoLayout({ children }: { children: ReactNode }) {
  const sub = await serverApi<{ subscription: SubscriptionSummary | null }>(
    '/v1/billing/subscription',
  );
  const subscribed = sub.status === 200 ? Boolean(sub.data?.subscription) : null;
  return <KontoAccessProvider subscribed={subscribed}>{children}</KontoAccessProvider>;
}
