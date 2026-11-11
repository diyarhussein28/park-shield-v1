import { redirect } from 'next/navigation';
import {
  serverApi,
  type EmergencyContactList,
  type SubscriptionSummary,
  type Vehicle,
} from '@/lib/api-server';
import { ContactsView } from './contacts-view';

export const metadata = { title: 'Notfallkontakte', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const [contacts, vehicles, sub] = await Promise.all([
    serverApi<EmergencyContactList>('/v1/emergency-contacts'),
    serverApi<{ vehicles: Vehicle[] }>('/v1/vehicles'),
    serverApi<{ subscription: SubscriptionSummary | null }>('/v1/billing/subscription'),
  ]);
  if (contacts.status === 401 || !contacts.data) redirect('/anmelden');
  return (
    <ContactsView
      initial={contacts.data}
      vehicles={(vehicles.data?.vehicles ?? []).map((v) => ({ id: v.id, nickname: v.nickname }))}
      plan={sub.data?.subscription?.plan ?? null}
    />
  );
}
