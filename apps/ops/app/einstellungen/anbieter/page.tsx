import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { HealthView, type Health } from './health';

export const dynamic = 'force-dynamic';

export default async function ProviderHealthPage() {
  const me = await requireStaff();
  const res = await opsServer<Health>('/ops/v1/providers/health');
  return <HealthView me={me} data={res.data} />;
}
