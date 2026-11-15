import { redirect } from 'next/navigation';
import {
  serverApi,
  type ChannelsOverview,
  type EmergencyContactList,
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
  searchParams: Promise<{ checkout?: string }>;
}) {
  const me = await serverApi<Me>('/v1/me');
  if (me.status === 401 || !me.data) redirect('/anmelden');
  const [sub, vehicles, channels, contacts, protection] = await Promise.all([
    serverApi<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
    serverApi<{ vehicles: Vehicle[] }>('/v1/vehicles'),
    serverApi<ChannelsOverview>('/v1/channels'),
    serverApi<EmergencyContactList>('/v1/emergency-contacts'),
    serverApi<Protection>('/v1/me/protection'),
  ]);
  const { checkout } = await searchParams;
  return (
    <AccountView
      me={me.data}
      subscription={sub.data?.subscription ?? null}
      vehicles={vehicles.data?.vehicles ?? []}
      channels={{
        push: channels.data?.push.devices.length ?? 0,
        whatsapp: Boolean(channels.data?.whatsapp),
      }}
      contactCount={
        contacts.data?.contacts.filter((c) => c.status === 'pending' || c.status === 'confirmed')
          .length ?? 0
      }
      protection={protection.data}
      checkout={checkout === 'success' || checkout === 'canceled' ? checkout : undefined}
    />
  );
}
