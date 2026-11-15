import { redirect } from 'next/navigation';
import { opsServer, type Overview, type StaffMe } from '@/lib/server';
import { Dashboard } from './dashboard';

export const dynamic = 'force-dynamic';

export default async function OpsHome() {
  const me = await opsServer<StaffMe>('/ops/v1/me');
  if (me.status === 401 || !me.data) redirect('/anmelden');
  const overview = await opsServer<Overview>('/ops/v1/overview');
  return <Dashboard me={me.data} overview={overview.data} />;
}
