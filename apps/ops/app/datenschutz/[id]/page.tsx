import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/page';
import { opsServer } from '@/lib/server';
import { DsrDetail, type DsrData } from './detail';

export const dynamic = 'force-dynamic';

export default async function DsrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  const { id } = await params;
  const res = await opsServer<DsrData>(`/ops/v1/dsr/${encodeURIComponent(id)}`);
  if (!res.data) notFound();
  return <DsrDetail me={me} initial={res.data} />;
}
