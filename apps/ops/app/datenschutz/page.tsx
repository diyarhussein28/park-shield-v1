import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { DsrQueue, type DsrList } from './queue';

export const dynamic = 'force-dynamic';

export default async function DsrPage() {
  const me = await requireStaff();
  const res = await opsServer<DsrList>('/ops/v1/dsr');
  return <DsrQueue me={me} initial={res.data} />;
}
