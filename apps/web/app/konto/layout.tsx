import type { ReactNode } from 'react';
import { KontoAccessProvider } from '@/components/konto-access';
import { serverApi, type ProfileSummary, type SubscriptionSummary } from '@/lib/api-server';

/**
 * Loads the subscription and the profile once for every /konto page, so the menu and the sections that
 * need a subscription (vehicles, notifications, history) can stay closed until the payment has arrived,
 * and accounts without a verified mobile number are asked to complete it.
 */
export default async function KontoLayout({ children }: { children: ReactNode }) {
  const [sub, profile] = await Promise.all([
    serverApi<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
    serverApi<ProfileSummary>('/v1/me/profile'),
  ]);
  const subscribed = sub.status === 200 ? Boolean(sub.data?.subscription) : null;
  const phoneVerified = profile.data ? profile.data.phoneVerified : null;
  return (
    <KontoAccessProvider subscribed={subscribed} phoneVerified={phoneVerified}>
      {children}
    </KontoAccessProvider>
  );
}
