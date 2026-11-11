import { redirect } from 'next/navigation';
import { opsServer, type StaffMe } from '@/lib/server';
import { StaffView, type StaffList } from './staff-view';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const [me, list] = await Promise.all([
    opsServer<StaffMe>('/ops/v1/me'),
    opsServer<StaffList>('/ops/v1/staff'),
  ]);
  if (me.status === 401 || !me.data) redirect('/anmelden');
  return <StaffView me={me.data} list={list.data} />;
}
