import { redirect } from 'next/navigation';
import {
  serverApi,
  type ChannelsOverview,
  type Me,
  type Protection,
  type SubscriptionSummary,
  type Vehicle,
} from '@/lib/api-server';
import { AccountView } from './account-view';

export const metadata = { title: 'Mein Konto', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const me = await serverApi<Me>('/v1/me');
  if (me.status === 401 || !me.data) redirect('/anmelden');
  const [sub, vehicles, channels, protection] = await Promise.all([
    serverApi<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
    serverApi<{ vehicles: Vehicle[] }>('/v1/vehicles'),
    serverApi<ChannelsOverview>('/v1/channels'),
    serverApi<Protection>('/v1/me/protection'),
  ]);
  const { checkout, session_id: sessionId } = await searchParams;
  return (
    <AccountView
      me={me.data}
      subscription={sub.data?.subscription ?? null}
      vehicles={vehicles.data?.vehicles ?? []}
      channels={channels.data}
      protection={protection.data}
      checkout={checkout === 'success' || checkout === 'canceled' ? checkout : undefined}
      sessionId={sessionId && /^cs_[A-Za-z0-9_-]{8,200}$/.test(sessionId) ? sessionId : undefined}
    />
  );
}
