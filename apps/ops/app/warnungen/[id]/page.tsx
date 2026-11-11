import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { Trace, type TraceData } from './trace';

export const dynamic = 'force-dynamic';

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  const res = await opsServer<TraceData>(`/ops/v1/alerts/${encodeURIComponent(id)}/trace`);
  if (!res.data) notFound();
  return <Trace me={me} data={res.data} />;
}
