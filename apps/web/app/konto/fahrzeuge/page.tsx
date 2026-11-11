import { redirect } from 'next/navigation';
import { serverApi, type SubscriptionSummary, type Vehicle } from '@/lib/api-server';
import { VehiclesView } from './vehicles-view';

export const metadata = { title: 'Fahrzeuge', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function VehiclesPage() {
  const [vehicles, sub] = await Promise.all([
    serverApi<{ vehicles: Vehicle[] }>('/v1/vehicles'),
    serverApi<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
  ]);
  if (vehicles.status === 401) redirect('/anmelden');
  return (
    <VehiclesView
      initial={vehicles.data?.vehicles ?? []}
      subscribed={Boolean(sub.data?.subscription)}
    />
  );
}
