import { redirect } from 'next/navigation';
import { serverApi, type HistoryAlert } from '@/lib/api-server';
import { HistoryView } from './history-view';

export const metadata = { title: 'Verlauf', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const res = await serverApi<{ alerts: HistoryAlert[] }>('/v1/alerts');
  if (res.status === 401 || !res.data) redirect('/anmelden');
  return <HistoryView initial={res.data.alerts} />;
}
