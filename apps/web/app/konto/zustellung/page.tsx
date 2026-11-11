import { redirect } from 'next/navigation';
import { serverApi, type DeliveryHelp } from '@/lib/api-server';
import { DeliveryHelpView } from './delivery-help';

export const metadata = { title: 'Warnung nicht bekommen?', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function DeliveryHelpPage() {
  const res = await serverApi<DeliveryHelp>('/v1/me/deliveries');
  if (res.status === 401 || !res.data) redirect('/anmelden');
  return <DeliveryHelpView data={res.data} />;
}
