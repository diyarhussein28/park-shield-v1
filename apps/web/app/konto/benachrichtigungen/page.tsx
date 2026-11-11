import { redirect } from 'next/navigation';
import { serverApi, type ChannelsOverview, type QuietHours, type Usage } from '@/lib/api-server';
import { NotificationsView } from './notifications-view';

export const metadata = { title: 'Benachrichtigungen', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const [res, quiet, usage] = await Promise.all([
    serverApi<ChannelsOverview>('/v1/channels'),
    serverApi<QuietHours>('/v1/quiet-hours'),
    serverApi<Usage>('/v1/me/usage'),
  ]);
  if (res.status === 401 || !res.data) redirect('/anmelden');
  return (
    <NotificationsView
      initial={res.data}
      quiet={quiet.data ?? { timezone: 'Europe/Berlin', rules: [] }}
      usage={usage.data ?? { whatsapp: { used: 0, limit: 0 } }}
    />
  );
}
