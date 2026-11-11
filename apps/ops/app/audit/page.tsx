import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { AuditView, type AuditData } from './audit-log';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; before?: string; reads?: string }>;
}) {
  const me = await requireStaff();
  const q = await searchParams;
  const params = new URLSearchParams();
  if (q.action) params.set('action', q.action.slice(0, 64));
  if (q.before && /^\d+$/.test(q.before)) params.set('before', q.before);
  if (q.reads === 'false') params.set('reads', 'false');
  const res = await opsServer<AuditData>(`/ops/v1/audit?${params}`);
  return (
    <AuditView me={me} data={res.data} action={q.action ?? ''} hideReads={q.reads === 'false'} />
  );
}
